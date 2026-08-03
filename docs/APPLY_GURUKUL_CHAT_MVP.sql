-- =============================================================================
-- APPLY_GURUKUL_CHAT_MVP.sql
-- Paste into Supabase SQL Editor as UTF-8. Idempotent.
-- Core MVP (conversations/participants/messages/attachments + groups + RPCs)
-- + SSOT closures (message_read_receipts, list/open/search, create-group aliases).
-- Then apply APPLY_GURUKUL_CHAT_SECURITY.sql for attachment path hardening.
-- =============================================================================

-- ============================================================
-- Gurukul Chat MVP
--   * Tight DM matrix (student/teacher/principal only)
--   * conversations + participants (DM + class/teacher groups)
--   * reply, soft-delete, attachments
--   * school_id tenant, notify, realtime
-- ============================================================

-- ── 1. Tenant column on legacy messages ──────────────────────
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);

UPDATE public.messages m
SET school_id = COALESCE(
  (SELECT p.school_id FROM public.profiles p WHERE p.id = m.sender_id),
  (SELECT p.school_id FROM public.profiles p WHERE p.id = m.receiver_id)
)
WHERE m.school_id IS NULL;

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS thread_id uuid,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS has_attachment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversation_id uuid,
  ADD COLUMN IF NOT EXISTS reply_to_id uuid,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

-- Group messages: receiver may be null when conversation_id is set
DO $$
BEGIN
  ALTER TABLE public.messages ALTER COLUMN receiver_id DROP NOT NULL;
EXCEPTION WHEN others THEN
  NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_school_created
  ON public.messages (school_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_receiver_unread
  ON public.messages (receiver_id, created_at DESC)
  WHERE NOT is_read AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages (conversation_id, created_at ASC)
  WHERE conversation_id IS NOT NULL;

-- ── 2. Conversations + participants + attachments ────────────
CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('dm', 'class_group', 'teacher_group')),
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  title text NOT NULL,
  dm_key text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_conversations_class_group_needs_class
    CHECK (kind <> 'class_group' OR class_id IS NOT NULL),
  CONSTRAINT chat_conversations_dm_needs_key
    CHECK (kind <> 'dm' OR dm_key IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_conversations_class_group_uidx
  ON public.chat_conversations (school_id, class_id)
  WHERE kind = 'class_group';

CREATE UNIQUE INDEX IF NOT EXISTS chat_conversations_teacher_group_uidx
  ON public.chat_conversations (school_id)
  WHERE kind = 'teacher_group';

CREATE UNIQUE INDEX IF NOT EXISTS chat_conversations_dm_uidx
  ON public.chat_conversations (school_id, dm_key)
  WHERE kind = 'dm';

CREATE TABLE IF NOT EXISTS public.chat_participants (
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_participants_user
  ON public.chat_participants (user_id);

CREATE TABLE IF NOT EXISTS public.message_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message
  ON public.message_attachments (message_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_conversation_id_fkey'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_conversation_id_fkey
      FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'messages_reply_to_id_fkey'
  ) THEN
    ALTER TABLE public.messages
      ADD CONSTRAINT messages_reply_to_id_fkey
      FOREIGN KEY (reply_to_id) REFERENCES public.messages(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

-- ── 3. Realtime ──────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_participants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_participants;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'message_attachments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_attachments;
  END IF;
END $$;

-- ── 4. Helpers ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.chat_caller_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ur.role::text
  FROM public.user_roles ur
  WHERE ur.user_id = auth.uid()
  ORDER BY
    CASE ur.role
      WHEN 'admin' THEN 1
      WHEN 'principal' THEN 2
      WHEN 'teacher' THEN 3
      WHEN 'student' THEN 4
      WHEN 'parent' THEN 5
      ELSE 6
    END
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.chat_dm_key(_a uuid, _b uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN _a::text < _b::text THEN _a::text || ':' || _b::text
    ELSE _b::text || ':' || _a::text
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_chat_participant(_conversation_id uuid, _user_id uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_participants cp
    WHERE cp.conversation_id = _conversation_id
      AND cp.user_id = _user_id
  );
$$;

-- ── 5. School-scoped contacts (product DM rules) ─────────────
-- Return type may differ from older overloads — DROP required (42P13).
DROP FUNCTION IF EXISTS public.get_chat_contacts();
CREATE OR REPLACE FUNCTION public.get_chat_contacts()
RETURNS TABLE(user_id uuid, name text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_role text;
  caller_school uuid;
  caller_class uuid;
BEGIN
  IF caller_id IS NULL THEN
    RETURN;
  END IF;

  caller_school := public.get_my_school_id();
  IF caller_school IS NULL THEN
    RETURN;
  END IF;

  caller_role := public.chat_caller_role();
  IF caller_role IS NULL THEN
    RETURN;
  END IF;

  caller_class := public.student_class_id(caller_id);

  RETURN QUERY
  SELECT DISTINCT
    u.id AS user_id,
    COALESCE(p.full_name, u.email, u.phone, 'Unknown') AS name,
    ur.role::text AS role
  FROM auth.users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  JOIN public.profiles p ON p.id = u.id
  WHERE u.id <> caller_id
    AND p.school_id = caller_school
    AND COALESCE(p.is_active, true)
    AND (
      -- Principal: students + teachers (+ other principals)
      (caller_role IN ('principal', 'admin')
        AND ur.role IN ('student', 'teacher', 'principal'))
      -- Teacher: students, teachers, principal
      OR (caller_role = 'teacher'
        AND ur.role IN ('student', 'teacher', 'principal'))
      -- Student: same-class peers + teachers + principal
      OR (caller_role = 'student'
        AND (
          (ur.role = 'student'
            AND caller_class IS NOT NULL
            AND public.student_class_id(u.id) = caller_class)
          OR ur.role IN ('teacher', 'principal')
        ))
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_chat_contacts() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_chat_contacts() TO authenticated;

-- ── 6. Ensure / create groups ────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_ensure_class_group(_class_id uuid)
RETURNS public.chat_conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text := public.chat_caller_role();
  _school uuid := public.get_my_school_id();
  _class_school uuid;
  _title text;
  _row public.chat_conversations;
  _sid uuid;
  _tid uuid;
BEGIN
  IF _uid IS NULL OR _school IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF _role NOT IN ('teacher', 'principal', 'admin') THEN
    RAISE EXCEPTION 'only teachers or principal can create class groups';
  END IF;

  SELECT c.school_id,
         COALESCE(c.name, 'Class') || CASE WHEN NULLIF(c.section, '') IS NOT NULL THEN ' ' || c.section ELSE '' END
    INTO _class_school, _title
  FROM public.classes c
  WHERE c.id = _class_id;

  IF _class_school IS NULL OR _class_school <> _school THEN
    RAISE EXCEPTION 'class not found';
  END IF;

  IF _role = 'teacher' AND NOT public.teacher_teaches_class(_uid, _class_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.teachers t
       WHERE t.user_id = _uid AND t.class_teacher_of = _class_id
     ) THEN
    RAISE EXCEPTION 'teacher not assigned to class';
  END IF;

  INSERT INTO public.chat_conversations (school_id, kind, class_id, title, created_by)
  VALUES (_school, 'class_group', _class_id, _title || ' Group', _uid)
  ON CONFLICT DO NOTHING
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    SELECT * INTO _row
    FROM public.chat_conversations
    WHERE school_id = _school AND kind = 'class_group' AND class_id = _class_id;
  END IF;

  -- Participants: students in class + teachers of class + principal(s)
  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _row.id, s.user_id
  FROM public.students s
  WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _row.id, t.user_id
  FROM public.teachers t
  JOIN public.teacher_classes tc ON tc.teacher_id = t.id
  WHERE tc.class_id = _class_id AND t.user_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _row.id, t.user_id
  FROM public.teachers t
  WHERE t.class_teacher_of = _class_id AND t.user_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _row.id, ur.user_id
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE p.school_id = _school AND ur.role IN ('principal', 'admin')
  ON CONFLICT DO NOTHING;

  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_ensure_class_group(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_ensure_class_group(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_ensure_teacher_group()
RETURNS public.chat_conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role text := public.chat_caller_role();
  _school uuid := public.get_my_school_id();
  _row public.chat_conversations;
BEGIN
  IF _uid IS NULL OR _school IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF _role NOT IN ('teacher', 'principal', 'admin') THEN
    RAISE EXCEPTION 'only teachers or principal can create teacher group';
  END IF;

  INSERT INTO public.chat_conversations (school_id, kind, title, created_by)
  VALUES (_school, 'teacher_group', 'Teacher Group', _uid)
  ON CONFLICT DO NOTHING
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    SELECT * INTO _row
    FROM public.chat_conversations
    WHERE school_id = _school AND kind = 'teacher_group';
  END IF;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _row.id, t.user_id
  FROM public.teachers t
  JOIN public.profiles p ON p.id = t.user_id
  WHERE p.school_id = _school AND t.user_id IS NOT NULL AND COALESCE(p.is_active, true)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _row.id, ur.user_id
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE p.school_id = _school AND ur.role IN ('principal', 'admin')
  ON CONFLICT DO NOTHING;

  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_ensure_teacher_group() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_ensure_teacher_group() TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_ensure_dm(_peer_user_id uuid)
RETURNS public.chat_conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.get_my_school_id();
  _key text;
  _row public.chat_conversations;
  _peer_name text;
BEGIN
  IF _uid IS NULL OR _school IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF _peer_user_id IS NULL OR _peer_user_id = _uid THEN
    RAISE EXCEPTION 'invalid peer';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.get_chat_contacts() c WHERE c.user_id = _peer_user_id) THEN
    RAISE EXCEPTION 'peer not allowed';
  END IF;

  _key := public.chat_dm_key(_uid, _peer_user_id);
  SELECT COALESCE(p.full_name, 'Chat') INTO _peer_name
  FROM public.profiles p WHERE p.id = _peer_user_id;

  INSERT INTO public.chat_conversations (school_id, kind, title, dm_key, created_by)
  VALUES (_school, 'dm', COALESCE(_peer_name, 'Direct message'), _key, _uid)
  ON CONFLICT DO NOTHING
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    SELECT * INTO _row
    FROM public.chat_conversations
    WHERE school_id = _school AND kind = 'dm' AND dm_key = _key;
  END IF;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  VALUES (_row.id, _uid), (_row.id, _peer_user_id)
  ON CONFLICT DO NOTHING;

  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_ensure_dm(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_ensure_dm(uuid) TO authenticated;

-- ── 7. List inbox (DMs + groups) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.get_chat_inbox()
RETURNS TABLE (
  conversation_id uuid,
  kind text,
  title text,
  class_id uuid,
  peer_user_id uuid,
  peer_role text,
  unread integer,
  last_message text,
  last_time timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.get_my_school_id();
BEGIN
  IF _uid IS NULL OR _school IS NULL THEN
    RETURN;
  END IF;

  -- Auto-join existing class group (creation is teacher/principal only)
  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT c.id, _uid
  FROM public.chat_conversations c
  WHERE c.school_id = _school
    AND c.kind = 'class_group'
    AND c.class_id = public.student_class_id(_uid)
    AND public.student_class_id(_uid) IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT c.id, _uid
  FROM public.chat_conversations c
  WHERE c.school_id = _school
    AND c.kind = 'teacher_group'
    AND public.chat_caller_role() IN ('teacher', 'principal', 'admin')
  ON CONFLICT DO NOTHING;

  RETURN QUERY
  WITH my_convs AS (
    SELECT c.*
    FROM public.chat_conversations c
    JOIN public.chat_participants cp ON cp.conversation_id = c.id
    WHERE cp.user_id = _uid AND c.school_id = _school
  ),
  last_msg AS (
    SELECT DISTINCT ON (m.conversation_id)
      m.conversation_id,
      CASE WHEN m.deleted_at IS NOT NULL THEN 'Message deleted' ELSE m.content END AS content,
      m.created_at,
      m.sender_id
    FROM public.messages m
    WHERE m.conversation_id IN (SELECT id FROM my_convs)
    ORDER BY m.conversation_id, m.created_at DESC
  ),
  unread_counts AS (
    SELECT m.conversation_id, COUNT(*)::integer AS n
    FROM public.messages m
    JOIN public.chat_participants cp
      ON cp.conversation_id = m.conversation_id AND cp.user_id = _uid
    WHERE m.conversation_id IN (SELECT id FROM my_convs)
      AND m.sender_id <> _uid
      AND m.deleted_at IS NULL
      AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
    GROUP BY m.conversation_id
  ),
  peers AS (
    SELECT cp.conversation_id, cp.user_id AS peer_id
    FROM public.chat_participants cp
    JOIN my_convs c ON c.id = cp.conversation_id AND c.kind = 'dm'
    WHERE cp.user_id <> _uid
  )
  SELECT
    c.id,
    c.kind,
    CASE
      WHEN c.kind = 'dm' THEN COALESCE(p.full_name, c.title)
      ELSE c.title
    END,
    c.class_id,
    peers.peer_id,
    ur.role::text,
    COALESCE(u.n, 0),
    lm.content,
    lm.created_at
  FROM my_convs c
  LEFT JOIN last_msg lm ON lm.conversation_id = c.id
  LEFT JOIN unread_counts u ON u.conversation_id = c.id
  LEFT JOIN peers ON peers.conversation_id = c.id
  LEFT JOIN public.profiles p ON p.id = peers.peer_id
  LEFT JOIN public.user_roles ur ON ur.user_id = peers.peer_id
  ORDER BY COALESCE(lm.created_at, c.updated_at) DESC NULLS LAST;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_chat_inbox() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_chat_inbox() TO authenticated;

-- ── 8. Send message (DM or group) ────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_send_chat_message(
  _conversation_id uuid DEFAULT NULL,
  _receiver_id uuid DEFAULT NULL,
  _content text DEFAULT '',
  _reply_to_id uuid DEFAULT NULL,
  _attachment_name text DEFAULT NULL,
  _attachment_url text DEFAULT NULL,
  _attachment_mime text DEFAULT NULL,
  _attachment_size bigint DEFAULT NULL
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _sender uuid := auth.uid();
  _school uuid;
  _body text := trim(COALESCE(_content, ''));
  _conv public.chat_conversations;
  _row public.messages;
  _has_att boolean := (_attachment_url IS NOT NULL AND length(trim(_attachment_url)) > 0);
BEGIN
  IF _sender IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  _school := public.get_my_school_id();
  IF _school IS NULL THEN
    RAISE EXCEPTION 'school required';
  END IF;
  IF length(_body) = 0 AND NOT _has_att THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;
  IF length(_body) > 8000 THEN
    RAISE EXCEPTION 'Message too long';
  END IF;

  IF _conversation_id IS NULL AND _receiver_id IS NOT NULL THEN
    _conv := public.rpc_ensure_dm(_receiver_id);
    _conversation_id := _conv.id;
  ELSIF _conversation_id IS NOT NULL THEN
    SELECT * INTO _conv FROM public.chat_conversations WHERE id = _conversation_id;
    IF _conv.id IS NULL OR _conv.school_id <> _school THEN
      RAISE EXCEPTION 'conversation not found';
    END IF;
    IF NOT public.is_chat_participant(_conversation_id, _sender) THEN
      RAISE EXCEPTION 'not a participant';
    END IF;
  ELSE
    RAISE EXCEPTION 'conversation or receiver required';
  END IF;

  IF _reply_to_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = _reply_to_id AND m.conversation_id = _conversation_id
  ) THEN
    RAISE EXCEPTION 'invalid reply target';
  END IF;

  IF _conv.kind = 'dm' THEN
    SELECT cp.user_id INTO _receiver_id
    FROM public.chat_participants cp
    WHERE cp.conversation_id = _conversation_id AND cp.user_id <> _sender
    LIMIT 1;
  ELSE
    _receiver_id := NULL;
  END IF;

  INSERT INTO public.messages (
    sender_id, receiver_id, content, is_read, school_id,
    conversation_id, reply_to_id, has_attachment
  )
  VALUES (
    _sender, _receiver_id,
    CASE WHEN length(_body) = 0 THEN CASE
      WHEN _attachment_mime ILIKE 'image/%' THEN '[Image]'
      ELSE COALESCE(_attachment_name, '[Attachment]')
    END ELSE _body END,
    false, _school, _conversation_id, _reply_to_id, _has_att
  )
  RETURNING * INTO _row;

  IF _has_att THEN
    INSERT INTO public.message_attachments (message_id, name, url, mime_type, size_bytes)
    VALUES (
      _row.id,
      COALESCE(NULLIF(trim(_attachment_name), ''), 'file'),
      trim(_attachment_url),
      _attachment_mime,
      _attachment_size
    );
  END IF;

  UPDATE public.chat_conversations
  SET updated_at = now()
  WHERE id = _conversation_id;

  UPDATE public.chat_participants
  SET last_read_at = now()
  WHERE conversation_id = _conversation_id AND user_id = _sender;

  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_send_chat_message(uuid, uuid, text, uuid, text, text, text, bigint) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_send_chat_message(uuid, uuid, text, uuid, text, text, text, bigint) TO authenticated;

-- Back-compat wrapper used by earlier live-sync service
CREATE OR REPLACE FUNCTION public.rpc_send_direct_message(
  _receiver_id uuid,
  _content text
)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.rpc_send_chat_message(NULL, _receiver_id, _content, NULL, NULL, NULL, NULL, NULL);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_send_direct_message(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_send_direct_message(uuid, text) TO authenticated;

-- ── 9. Mark read / delete / thread ───────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_mark_conversation_read(_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _n integer := 0;
  _peer uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT public.is_chat_participant(_conversation_id, _uid) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;

  UPDATE public.chat_participants
  SET last_read_at = now()
  WHERE conversation_id = _conversation_id AND user_id = _uid;

  SELECT cp.user_id INTO _peer
  FROM public.chat_participants cp
  JOIN public.chat_conversations c ON c.id = cp.conversation_id
  WHERE cp.conversation_id = _conversation_id
    AND cp.user_id <> _uid
    AND c.kind = 'dm'
  LIMIT 1;

  IF _peer IS NOT NULL THEN
    UPDATE public.messages
    SET is_read = true,
        read_at = COALESCE(read_at, now())
    WHERE conversation_id = _conversation_id
      AND sender_id = _peer
      AND receiver_id = _uid
      AND is_read = false;
    GET DIAGNOSTICS _n = ROW_COUNT;
  END IF;

  RETURN _n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_mark_conversation_read(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_mark_conversation_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_mark_messages_read(_peer_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _n integer := 0;
  _conv uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF _peer_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT c.id INTO _conv
  FROM public.chat_conversations c
  WHERE c.school_id = public.get_my_school_id()
    AND c.kind = 'dm'
    AND c.dm_key = public.chat_dm_key(_uid, _peer_user_id);

  IF _conv IS NOT NULL THEN
    RETURN public.rpc_mark_conversation_read(_conv);
  END IF;

  UPDATE public.messages
  SET is_read = true,
      read_at = COALESCE(read_at, now())
  WHERE sender_id = _peer_user_id
    AND receiver_id = _uid
    AND is_read = false;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_mark_messages_read(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_mark_messages_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_delete_chat_message(_message_id uuid)
RETURNS public.messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _row public.messages;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  SELECT * INTO _row FROM public.messages WHERE id = _message_id;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'message not found';
  END IF;
  IF _row.sender_id <> _uid THEN
    RAISE EXCEPTION 'only sender can delete';
  END IF;
  IF _row.conversation_id IS NOT NULL
     AND NOT public.is_chat_participant(_row.conversation_id, _uid) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;

  UPDATE public.messages
  SET deleted_at = now(),
      deleted_by = _uid,
      content = 'Message deleted',
      has_attachment = false
  WHERE id = _message_id
  RETURNING * INTO _row;

  DELETE FROM public.message_attachments WHERE message_id = _message_id;
  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_delete_chat_message(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_delete_chat_message(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_chat_unread_total()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT COUNT(*)::integer
    FROM public.messages m
    JOIN public.chat_participants cp
      ON cp.conversation_id = m.conversation_id AND cp.user_id = auth.uid()
    WHERE m.sender_id <> auth.uid()
      AND m.deleted_at IS NULL
      AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
  ), 0) + COALESCE((
    SELECT COUNT(*)::integer
    FROM public.messages m
    WHERE m.receiver_id = auth.uid()
      AND m.conversation_id IS NULL
      AND m.is_read = false
      AND m.deleted_at IS NULL
  ), 0);
$$;

REVOKE EXECUTE ON FUNCTION public.get_chat_unread_total() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_chat_unread_total() TO authenticated;

-- ── 10. Notify participants on insert ────────────────────────
CREATE OR REPLACE FUNCTION public.trg_messages_notify_receiver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
  _role text;
  _link text;
  _uid uuid;
BEGIN
  SELECT COALESCE(p.full_name, 'Someone') INTO _name
  FROM public.profiles p WHERE p.id = NEW.sender_id;

  IF NEW.conversation_id IS NOT NULL THEN
    FOR _uid IN
      SELECT cp.user_id
      FROM public.chat_participants cp
      WHERE cp.conversation_id = NEW.conversation_id
        AND cp.user_id <> NEW.sender_id
    LOOP
      SELECT ur.role::text INTO _role
      FROM public.user_roles ur
      WHERE ur.user_id = _uid
      ORDER BY
        CASE ur.role
          WHEN 'admin' THEN 1 WHEN 'principal' THEN 2 WHEN 'teacher' THEN 3
          WHEN 'student' THEN 4 WHEN 'parent' THEN 5 ELSE 6
        END
      LIMIT 1;

      _link := CASE _role
        WHEN 'teacher' THEN '/teacher/communication'
        WHEN 'principal' THEN '/principal/messages'
        WHEN 'parent' THEN '/parent/chat'
        ELSE '/student/chat'
      END;

      PERFORM public._notify(
        _uid,
        'message',
        'New message from ' || COALESCE(_name, 'Someone'),
        left(COALESCE(NEW.content, ''), 160),
        'message-square',
        _link
      );
    END LOOP;
  ELSIF NEW.receiver_id IS NOT NULL THEN
    SELECT ur.role::text INTO _role
    FROM public.user_roles ur
    WHERE ur.user_id = NEW.receiver_id
    ORDER BY
      CASE ur.role
        WHEN 'admin' THEN 1 WHEN 'principal' THEN 2 WHEN 'teacher' THEN 3
        WHEN 'student' THEN 4 WHEN 'parent' THEN 5 ELSE 6
      END
    LIMIT 1;

    _link := CASE _role
      WHEN 'teacher' THEN '/teacher/communication'
      WHEN 'principal' THEN '/principal/messages'
      WHEN 'parent' THEN '/parent/chat'
      ELSE '/student/chat'
    END;

    PERFORM public._notify(
      NEW.receiver_id,
      'message',
      'New message from ' || COALESCE(_name, 'Someone'),
      left(COALESCE(NEW.content, ''), 160),
      'message-square',
      _link
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_notify_receiver ON public.messages;
CREATE TRIGGER messages_notify_receiver
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_messages_notify_receiver();

-- ── 11. RLS ──────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users can view own messages" ON public.messages;
DROP POLICY IF EXISTS "Users can send messages" ON public.messages;
DROP POLICY IF EXISTS "Users can mark received messages as read" ON public.messages;
DROP POLICY IF EXISTS "messages send" ON public.messages;
DROP POLICY IF EXISTS "messages read participants" ON public.messages;
DROP POLICY IF EXISTS "messages mark read" ON public.messages;
DROP POLICY IF EXISTS "messages delete own" ON public.messages;

CREATE POLICY "messages read participants" ON public.messages
  FOR SELECT TO authenticated
  USING (
    (
      sender_id = auth.uid()
      OR receiver_id = auth.uid()
      OR (conversation_id IS NOT NULL AND public.is_chat_participant(conversation_id, auth.uid()))
    )
    AND (school_id IS NULL OR school_id = public.get_my_school_id())
  );

CREATE POLICY "messages send" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND school_id = public.get_my_school_id()
    AND (
      (
        receiver_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.profiles rp
          WHERE rp.id = receiver_id AND rp.school_id = public.get_my_school_id()
        )
      )
      OR (
        conversation_id IS NOT NULL
        AND public.is_chat_participant(conversation_id, auth.uid())
      )
    )
  );

CREATE POLICY "messages mark read" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    receiver_id = auth.uid()
    OR sender_id = auth.uid()
    OR (conversation_id IS NOT NULL AND public.is_chat_participant(conversation_id, auth.uid()))
  )
  WITH CHECK (
    receiver_id = auth.uid()
    OR sender_id = auth.uid()
    OR (conversation_id IS NOT NULL AND public.is_chat_participant(conversation_id, auth.uid()))
  );

DROP POLICY IF EXISTS "chat_conversations participant read" ON public.chat_conversations;
CREATE POLICY "chat_conversations participant read" ON public.chat_conversations
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND public.is_chat_participant(id, auth.uid())
  );

DROP POLICY IF EXISTS "chat_participants self read" ON public.chat_participants;
CREATE POLICY "chat_participants self read" ON public.chat_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_chat_participant(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS "chat_participants self update read" ON public.chat_participants;
CREATE POLICY "chat_participants self update read" ON public.chat_participants
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "message_attachments participant read" ON public.message_attachments;
CREATE POLICY "message_attachments participant read" ON public.message_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_id
        AND (
          m.sender_id = auth.uid()
          OR m.receiver_id = auth.uid()
          OR (m.conversation_id IS NOT NULL AND public.is_chat_participant(m.conversation_id, auth.uid()))
        )
    )
  );


-- =============================================================================
-- Gurukul Chat MVP — SSOT closures (read receipts + list/open/search RPCs)
-- Apply after 20260803161000_gurukul_chat_mvp.sql (+ security hardening if used)
-- Idempotent.
-- =============================================================================

-- ── 1. Read receipts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_read_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_message_read_receipts_conv_user
  ON public.message_read_receipts (conversation_id, user_id, read_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_read_receipts_message
  ON public.message_read_receipts (message_id);

ALTER TABLE public.message_read_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "message_read_receipts select" ON public.message_read_receipts;
CREATE POLICY "message_read_receipts select" ON public.message_read_receipts
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND (
      user_id = auth.uid()
      OR (
        conversation_id IS NOT NULL
        AND public.is_chat_participant(conversation_id, auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "message_read_receipts insert self" ON public.message_read_receipts;
CREATE POLICY "message_read_receipts insert self" ON public.message_read_receipts
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND school_id = public.get_my_school_id()
  );

DROP POLICY IF EXISTS "message_read_receipts update self" ON public.message_read_receipts;
CREATE POLICY "message_read_receipts update self" ON public.message_read_receipts
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND school_id = public.get_my_school_id())
  WITH CHECK (user_id = auth.uid());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'message_read_receipts'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_read_receipts;
  END IF;
END $$;

-- Participants: tenant + unread cache columns
ALTER TABLE public.chat_participants
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);

UPDATE public.chat_participants cp
SET school_id = c.school_id
FROM public.chat_conversations c
WHERE c.id = cp.conversation_id
  AND cp.school_id IS NULL;

ALTER TABLE public.chat_participants
  ADD COLUMN IF NOT EXISTS unread_count integer NOT NULL DEFAULT 0;

-- ── 2. Mark read writes receipts ─────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_mark_conversation_read(uuid);
CREATE OR REPLACE FUNCTION public.rpc_mark_conversation_read(_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.get_my_school_id();
  _prev timestamptz;
  _n integer := 0;
  _peer uuid;
BEGIN
  IF _uid IS NULL OR _school IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT public.is_chat_participant(_conversation_id, _uid) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;

  SELECT cp.last_read_at INTO _prev
  FROM public.chat_participants cp
  WHERE cp.conversation_id = _conversation_id AND cp.user_id = _uid;

  INSERT INTO public.message_read_receipts (message_id, conversation_id, school_id, user_id, read_at)
  SELECT m.id, m.conversation_id, COALESCE(m.school_id, _school), _uid, now()
  FROM public.messages m
  WHERE m.conversation_id = _conversation_id
    AND m.school_id = _school
    AND m.sender_id <> _uid
    AND m.deleted_at IS NULL
    AND (_prev IS NULL OR m.created_at > _prev)
  ON CONFLICT (message_id, user_id) DO UPDATE
  SET read_at = EXCLUDED.read_at;

  GET DIAGNOSTICS _n = ROW_COUNT;

  UPDATE public.chat_participants
  SET last_read_at = now(), unread_count = 0, school_id = COALESCE(school_id, _school)
  WHERE conversation_id = _conversation_id AND user_id = _uid;

  SELECT cp.user_id INTO _peer
  FROM public.chat_participants cp
  JOIN public.chat_conversations c ON c.id = cp.conversation_id
  WHERE cp.conversation_id = _conversation_id
    AND cp.user_id <> _uid
    AND c.kind = 'dm'
  LIMIT 1;

  IF _peer IS NOT NULL THEN
    UPDATE public.messages
    SET is_read = true, read_at = COALESCE(read_at, now())
    WHERE conversation_id = _conversation_id
      AND sender_id = _peer
      AND receiver_id = _uid
      AND is_read = false;
  END IF;

  RETURN _n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_mark_conversation_read(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_mark_conversation_read(uuid) TO authenticated;

-- ── 3. List conversations (searchable inbox) ─────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_list_conversations(text, int);
CREATE OR REPLACE FUNCTION public.rpc_list_conversations(
  _search text DEFAULT NULL,
  _limit int DEFAULT 50
)
RETURNS TABLE (
  conversation_id uuid,
  kind text,
  title text,
  class_id uuid,
  peer_user_id uuid,
  peer_role text,
  unread integer,
  last_message text,
  last_time timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _q text := lower(nullif(btrim(coalesce(_search, '')), ''));
  _lim int := least(greatest(coalesce(_limit, 50), 1), 100);
BEGIN
  RETURN QUERY
  SELECT i.*
  FROM public.get_chat_inbox() i
  WHERE (
    _q IS NULL
    OR lower(COALESCE(i.title, '')) LIKE '%' || _q || '%'
    OR lower(COALESCE(i.last_message, '')) LIKE '%' || _q || '%'
  )
  ORDER BY COALESCE(i.last_time, '-infinity'::timestamptz) DESC
  LIMIT _lim;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_list_conversations(text, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_list_conversations(text, int) TO authenticated;

-- ── 4. Open thread (messages + mark read) ────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_open_conversation(uuid, timestamptz, int);
CREATE OR REPLACE FUNCTION public.rpc_open_conversation(
  _conversation_id uuid,
  _before timestamptz DEFAULT NULL,
  _limit int DEFAULT 80
)
RETURNS TABLE (
  message_id uuid,
  conversation_id uuid,
  sender_id uuid,
  sender_name text,
  receiver_id uuid,
  content text,
  message_type text,
  reply_to_id uuid,
  reply_preview text,
  deleted_at timestamptz,
  created_at timestamptz,
  is_read boolean,
  attachment_id uuid,
  attachment_url text,
  attachment_name text,
  attachment_mime text,
  attachment_size bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.get_my_school_id();
  _lim int := least(greatest(coalesce(_limit, 80), 1), 200);
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT public.is_chat_participant(_conversation_id, _uid) THEN
    RAISE EXCEPTION 'not a participant';
  END IF;

  PERFORM public.rpc_mark_conversation_read(_conversation_id);

  RETURN QUERY
  SELECT
    m.id AS message_id,
    m.conversation_id,
    m.sender_id,
    COALESCE(p.full_name, 'User') AS sender_name,
    m.receiver_id,
    CASE WHEN m.deleted_at IS NOT NULL THEN 'Message deleted' ELSE m.content END AS content,
    CASE
      WHEN m.deleted_at IS NOT NULL THEN 'text'
      WHEN EXISTS (
        SELECT 1 FROM public.message_attachments a
        WHERE a.message_id = m.id AND a.mime_type ILIKE 'image/%'
      ) THEN 'image'
      WHEN EXISTS (
        SELECT 1 FROM public.message_attachments a
        WHERE a.message_id = m.id AND a.mime_type = 'application/pdf'
      ) THEN 'pdf'
      ELSE 'text'
    END AS message_type,
    m.reply_to_id,
    CASE
      WHEN rm.id IS NULL THEN NULL
      WHEN rm.deleted_at IS NOT NULL THEN 'Deleted message'
      ELSE left(rm.content, 120)
    END AS reply_preview,
    m.deleted_at,
    m.created_at,
    m.is_read,
    a.id AS attachment_id,
    a.url AS attachment_url,
    a.name AS attachment_name,
    a.mime_type AS attachment_mime,
    a.size_bytes AS attachment_size
  FROM public.messages m
  LEFT JOIN public.profiles p ON p.id = m.sender_id
  LEFT JOIN public.messages rm ON rm.id = m.reply_to_id
  LEFT JOIN LATERAL (
    SELECT * FROM public.message_attachments ma
    WHERE ma.message_id = m.id
    ORDER BY ma.created_at
    LIMIT 1
  ) a ON true
  WHERE m.conversation_id = _conversation_id
    AND m.school_id = _school
    AND (_before IS NULL OR m.created_at < _before)
  ORDER BY m.created_at DESC
  LIMIT _lim;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_open_conversation(uuid, timestamptz, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_open_conversation(uuid, timestamptz, int) TO authenticated;

-- ── 5. Search chats ──────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_search_chat(text, int);
CREATE OR REPLACE FUNCTION public.rpc_search_chat(
  _query text,
  _limit int DEFAULT 40
)
RETURNS TABLE (
  result_kind text,
  conversation_id uuid,
  message_id uuid,
  title text,
  snippet text,
  rank_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.get_my_school_id();
  _q text := lower(nullif(btrim(coalesce(_query, '')), ''));
  _lim int := least(greatest(coalesce(_limit, 40), 1), 80);
BEGIN
  IF _uid IS NULL OR _school IS NULL OR _q IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT * FROM (
    SELECT
      'conversation'::text AS result_kind,
      i.conversation_id,
      NULL::uuid AS message_id,
      i.title,
      COALESCE(i.last_message, '') AS snippet,
      COALESCE(i.last_time, now()) AS rank_at
    FROM public.rpc_list_conversations(_q, _lim) i
    UNION ALL
    SELECT
      'message'::text,
      m.conversation_id,
      m.id,
      COALESCE(c.title, 'Chat'),
      left(m.content, 160),
      m.created_at
    FROM public.messages m
    JOIN public.chat_conversations c ON c.id = m.conversation_id
    JOIN public.chat_participants cp
      ON cp.conversation_id = m.conversation_id AND cp.user_id = _uid
    WHERE m.school_id = _school
      AND m.deleted_at IS NULL
      AND m.conversation_id IS NOT NULL
      AND lower(m.content) LIKE '%' || _q || '%'
  ) s
  ORDER BY s.rank_at DESC NULLS LAST
  LIMIT _lim;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_search_chat(text, int) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_search_chat(text, int) TO authenticated;

-- ── 6. Create-group aliases (product naming) ─────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_create_class_group();
DROP FUNCTION IF EXISTS public.rpc_create_class_group(uuid, text);
DROP FUNCTION IF EXISTS public.rpc_create_teacher_group(text);
CREATE OR REPLACE FUNCTION public.rpc_create_class_group(
  _class_id uuid,
  _title text DEFAULT NULL
)
RETURNS public.chat_conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.chat_conversations;
BEGIN
  _row := public.rpc_ensure_class_group(_class_id);
  IF nullif(btrim(coalesce(_title, '')), '') IS NOT NULL THEN
    UPDATE public.chat_conversations
    SET title = btrim(_title), updated_at = now()
    WHERE id = _row.id
    RETURNING * INTO _row;
  END IF;
  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_create_class_group(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_create_class_group(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_create_teacher_group(_title text DEFAULT NULL)
RETURNS public.chat_conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.chat_conversations;
BEGIN
  _row := public.rpc_ensure_teacher_group();
  IF nullif(btrim(coalesce(_title, '')), '') IS NOT NULL THEN
    UPDATE public.chat_conversations
    SET title = btrim(_title), updated_at = now()
    WHERE id = _row.id
    RETURNING * INTO _row;
  END IF;
  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_create_teacher_group(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_create_teacher_group(text) TO authenticated;

COMMENT ON TABLE public.message_read_receipts IS
  'Per-message read receipts for Gurukul Chat MVP';
COMMENT ON FUNCTION public.rpc_list_conversations(text, int) IS
  'List conversations (inbox) with optional title/preview search';
COMMENT ON FUNCTION public.rpc_open_conversation(uuid, timestamptz, int) IS
  'Open conversation thread (newest-first page) and mark read';
COMMENT ON FUNCTION public.rpc_search_chat(text, int) IS
  'Search conversations and message bodies the caller can access';