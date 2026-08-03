-- =============================================================================
-- APPLY_GURUKUL_CHAT_SECURITY.sql
-- Paste AFTER APPLY_GURUKUL_CHAT_MVP.sql (idempotent).
-- Then paste APPLY_GURUKUL_CHAT_CLOSURES.sql for read receipts / list-open-search RPCs
-- (unless those closures were already included in a newer MVP paste).
--
-- Closes Chat MVP attack paths:
--   A. Cross-school read/write (NULL school_id bypass, foreign tenant contacts)
--   B. Student DM to other classes (INSERT RLS only checked same-school)
--   C. Arbitrary group join (client INSERT on chat_participants)
--   D. Unscoped attachment upload / forged attachment URLs
--   E. Delete/edit others' messages via broad UPDATE RLS
-- =============================================================================

-- ── 1. DM authorisation helper (canonical matrix) ────────────────────────────
CREATE OR REPLACE FUNCTION public.chat_can_dm(_from uuid, _to uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  from_role text;
  to_role text;
  from_school uuid;
  to_school uuid;
  from_class uuid;
  to_class uuid;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _from = _to THEN
    RETURN false;
  END IF;

  SELECT p.school_id INTO from_school FROM public.profiles p WHERE p.id = _from;
  SELECT p.school_id INTO to_school FROM public.profiles p WHERE p.id = _to;
  IF from_school IS NULL OR to_school IS NULL OR from_school <> to_school THEN
    RETURN false;
  END IF;

  SELECT ur.role::text INTO from_role
  FROM public.user_roles ur
  WHERE ur.user_id = _from
  ORDER BY CASE ur.role
    WHEN 'admin' THEN 1 WHEN 'principal' THEN 2 WHEN 'teacher' THEN 3
    WHEN 'student' THEN 4 WHEN 'parent' THEN 5 ELSE 6 END
  LIMIT 1;

  SELECT ur.role::text INTO to_role
  FROM public.user_roles ur
  WHERE ur.user_id = _to
  ORDER BY CASE ur.role
    WHEN 'admin' THEN 1 WHEN 'principal' THEN 2 WHEN 'teacher' THEN 3
    WHEN 'student' THEN 4 WHEN 'parent' THEN 5 ELSE 6 END
  LIMIT 1;

  IF from_role IS NULL OR to_role IS NULL THEN
    RETURN false;
  END IF;

  -- Leadership: anyone in-tenant
  IF from_role IN ('admin', 'principal') THEN
    RETURN to_role IN ('student', 'teacher', 'principal', 'admin', 'parent');
  END IF;
  IF to_role IN ('admin', 'principal') AND from_role IN ('teacher', 'student', 'parent') THEN
    RETURN true;
  END IF;

  -- Teachers: peers + students they teach + parents of those students
  IF from_role = 'teacher' THEN
    IF to_role = 'teacher' THEN
      RETURN true;
    END IF;
    IF to_role = 'student' THEN
      RETURN public.teacher_teaches_class(_from, public.student_class_id(_to))
        OR EXISTS (
          SELECT 1 FROM public.teachers t
          WHERE t.user_id = _from AND t.class_teacher_of = public.student_class_id(_to)
        );
    END IF;
    IF to_role = 'parent' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.parent_user_id = _to
          AND s.class_id IS NOT NULL
          AND (
            public.teacher_teaches_class(_from, s.class_id)
            OR EXISTS (
              SELECT 1 FROM public.teachers t
              WHERE t.user_id = _from AND t.class_teacher_of = s.class_id
            )
          )
      );
    END IF;
    RETURN false;
  END IF;

  -- Students: same-class peers + teachers who cover them + leadership (above)
  IF from_role = 'student' THEN
    from_class := public.student_class_id(_from);
    IF to_role = 'student' THEN
      to_class := public.student_class_id(_to);
      RETURN from_class IS NOT NULL AND to_class IS NOT NULL AND from_class = to_class;
    END IF;
    IF to_role = 'teacher' THEN
      RETURN from_class IS NOT NULL AND (
        public.teacher_teaches_class(_to, from_class)
        OR EXISTS (
          SELECT 1 FROM public.teachers t
          WHERE t.user_id = _to AND t.class_teacher_of = from_class
        )
      );
    END IF;
    RETURN false;
  END IF;

  -- Parents: teachers of linked children + leadership (above)
  IF from_role = 'parent' THEN
    IF to_role = 'teacher' THEN
      RETURN EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.parent_user_id = _from
          AND s.class_id IS NOT NULL
          AND (
            public.teacher_teaches_class(_to, s.class_id)
            OR EXISTS (
              SELECT 1 FROM public.teachers t
              WHERE t.user_id = _to AND t.class_teacher_of = s.class_id
            )
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.parents p
        JOIN public.parent_students ps ON ps.parent_id = p.id
        JOIN public.students s ON s.id = ps.student_id
        WHERE p.user_id = _from
          AND s.class_id IS NOT NULL
          AND (
            public.teacher_teaches_class(_to, s.class_id)
            OR EXISTS (
              SELECT 1 FROM public.teachers t
              WHERE t.user_id = _to AND t.class_teacher_of = s.class_id
            )
          )
      );
    END IF;
    RETURN false;
  END IF;

  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chat_can_dm(uuid, uuid) TO authenticated;

-- ── 2. Contacts RPC — reuse chat_can_dm (no enumeration bypass) ──────────────
DROP FUNCTION IF EXISTS public.get_chat_contacts();
CREATE OR REPLACE FUNCTION public.get_chat_contacts()
RETURNS TABLE(user_id uuid, name text, role text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller_id uuid := auth.uid();
  caller_school uuid;
BEGIN
  IF caller_id IS NULL THEN
    RETURN;
  END IF;
  caller_school := public.get_my_school_id();
  IF caller_school IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT DISTINCT
    ur.user_id,
    COALESCE(NULLIF(p.full_name, ''), p.email, 'User')::text AS name,
    ur.role::text AS role
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE ur.user_id <> caller_id
    AND p.school_id = caller_school
    AND COALESCE(p.is_active, true)
    AND public.chat_can_dm(caller_id, ur.user_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_chat_contacts() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_chat_contacts() TO authenticated;

-- ── 3. Group creation gates (students cannot mint groups) ────────────────────
CREATE OR REPLACE FUNCTION public.chat_can_create_class_group(_uid uuid, _class_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  role text;
  cls_school uuid;
  uid_school uuid;
BEGIN
  IF _uid IS NULL OR _class_id IS NULL THEN
    RETURN false;
  END IF;
  SELECT p.school_id INTO uid_school FROM public.profiles p WHERE p.id = _uid;
  SELECT c.school_id INTO cls_school FROM public.classes c WHERE c.id = _class_id;
  IF uid_school IS NULL OR cls_school IS NULL OR uid_school <> cls_school THEN
    RETURN false;
  END IF;

  SELECT ur.role::text INTO role
  FROM public.user_roles ur
  WHERE ur.user_id = _uid
  ORDER BY CASE ur.role
    WHEN 'admin' THEN 1 WHEN 'principal' THEN 2 WHEN 'teacher' THEN 3
    WHEN 'student' THEN 4 WHEN 'parent' THEN 5 ELSE 6 END
  LIMIT 1;

  IF role IN ('admin', 'principal') THEN
    RETURN true;
  END IF;
  IF role = 'teacher' THEN
    RETURN public.teacher_teaches_class(_uid, _class_id)
      OR EXISTS (
        SELECT 1 FROM public.teachers t
        WHERE t.user_id = _uid AND t.class_teacher_of = _class_id
      );
  END IF;
  RETURN false;
END;
$$;

GRANT EXECUTE ON FUNCTION public.chat_can_create_class_group(uuid, uuid) TO authenticated;

-- Harden ensure RPCs if present
CREATE OR REPLACE FUNCTION public.rpc_ensure_class_group(_class_id uuid)
RETURNS public.chat_conversations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.get_my_school_id();
  _title text;
  _row public.chat_conversations;
BEGIN
  IF _uid IS NULL OR _school IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT public.chat_can_create_class_group(_uid, _class_id) THEN
    RAISE EXCEPTION 'chat_forbidden: cannot create class group';
  END IF;

  SELECT COALESCE(c.name, 'Class')
         || CASE WHEN NULLIF(c.section, '') IS NOT NULL THEN ' ' || c.section ELSE '' END
    INTO _title
  FROM public.classes c
  WHERE c.id = _class_id AND c.school_id = _school;

  IF _title IS NULL THEN
    RAISE EXCEPTION 'class not found';
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

  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _row.id, s.user_id
  FROM public.students s
  WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
    AND COALESCE(s.school_id, _school) = _school
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

-- Inbox auto-join: only own class / own teacher role (no arbitrary conversation ids)
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
  _my_class uuid;
  _role text;
BEGIN
  IF _uid IS NULL OR _school IS NULL THEN
    RETURN;
  END IF;

  _my_class := public.student_class_id(_uid);
  _role := public.chat_caller_role();

  -- Students may auto-join ONLY their own class group (never arbitrary class_id).
  IF _my_class IS NOT NULL THEN
    INSERT INTO public.chat_participants (conversation_id, user_id)
    SELECT c.id, _uid
    FROM public.chat_conversations c
    WHERE c.school_id = _school
      AND c.kind = 'class_group'
      AND c.class_id = _my_class
    ON CONFLICT DO NOTHING;
  END IF;

  -- Teachers/staff may auto-join the school teacher group only.
  IF _role IN ('teacher', 'principal', 'admin') THEN
    INSERT INTO public.chat_participants (conversation_id, user_id)
    SELECT c.id, _uid
    FROM public.chat_conversations c
    WHERE c.school_id = _school
      AND c.kind = 'teacher_group'
    ON CONFLICT DO NOTHING;
  END IF;

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
      AND m.school_id = _school
    ORDER BY m.conversation_id, m.created_at DESC
  ),
  unread_counts AS (
    SELECT m.conversation_id, COUNT(*)::integer AS n
    FROM public.messages m
    JOIN public.chat_participants cp
      ON cp.conversation_id = m.conversation_id AND cp.user_id = _uid
    WHERE m.conversation_id IN (SELECT id FROM my_convs)
      AND m.school_id = _school
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

-- ── 4. Attachment URL must be under caller school + user path ────────────────
CREATE OR REPLACE FUNCTION public.chat_attachment_url_allowed(_url text, _uid uuid DEFAULT auth.uid())
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  school uuid;
  u text := coalesce(trim(_url), '');
BEGIN
  IF _uid IS NULL OR u = '' THEN
    RETURN false;
  END IF;
  school := (SELECT p.school_id FROM public.profiles p WHERE p.id = _uid);
  IF school IS NULL THEN
    RETURN false;
  END IF;
  -- Require storage path segment /chat-attachments/{school_id}/{user_id}/
  RETURN u ~* ('chat-attachments[/%].*' || school::text || '[/%]' || _uid::text || '[/%]')
    OR u LIKE ('%' || school::text || '/' || _uid::text || '/%');
END;
$$;

GRANT EXECUTE ON FUNCTION public.chat_attachment_url_allowed(text, uuid) TO authenticated;

-- Patch send RPC: DM matrix + attachment path check
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
  IF _has_att AND NOT public.chat_attachment_url_allowed(trim(_attachment_url), _sender) THEN
    RAISE EXCEPTION 'chat_forbidden: attachment path not allowed';
  END IF;

  IF _conversation_id IS NULL AND _receiver_id IS NOT NULL THEN
    IF NOT public.chat_can_dm(_sender, _receiver_id) THEN
      RAISE EXCEPTION 'chat_forbidden: cannot DM this user';
    END IF;
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
    IF _receiver_id IS NULL OR NOT public.chat_can_dm(_sender, _receiver_id) THEN
      RAISE EXCEPTION 'chat_forbidden: cannot DM this user';
    END IF;
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

-- Ensure DM creation uses the same matrix (no contact-list race / stale allow)
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
  IF NOT public.chat_can_dm(_uid, _peer_user_id) THEN
    RAISE EXCEPTION 'chat_forbidden: peer not allowed';
  END IF;

  _key := public.chat_dm_key(_uid, _peer_user_id);
  SELECT COALESCE(p.full_name, 'Chat') INTO _peer_name
  FROM public.profiles p WHERE p.id = _peer_user_id AND p.school_id = _school;

  IF _peer_name IS NULL THEN
    RAISE EXCEPTION 'chat_forbidden: peer not in school';
  END IF;

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

-- Soft-delete: sender only (alias for service)
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
    RAISE EXCEPTION 'chat_forbidden: only sender can delete';
  END IF;
  IF _row.school_id IS DISTINCT FROM public.get_my_school_id() THEN
    RAISE EXCEPTION 'chat_forbidden: cross-school';
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

-- Alias names used by MessageService
CREATE OR REPLACE FUNCTION public.rpc_delete_message(_message_id uuid)
RETURNS public.messages
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.rpc_delete_chat_message(_message_id);
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_delete_message(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_delete_message(uuid) TO authenticated;

-- ── 5. Trigger: scrub illegal client UPDATE on messages ──────────────────────
CREATE OR REPLACE FUNCTION public.messages_guard_chat_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND coalesce(auth.role(), '') <> 'service_role' THEN
    IF NEW.sender_id IS DISTINCT FROM OLD.sender_id
       OR NEW.receiver_id IS DISTINCT FROM OLD.receiver_id
       OR NEW.school_id IS DISTINCT FROM OLD.school_id
       OR NEW.conversation_id IS DISTINCT FROM OLD.conversation_id THEN
      RAISE EXCEPTION 'chat_forbidden: cannot reassign message';
    END IF;

    -- Soft-delete own only
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      IF NEW.deleted_at IS NULL THEN
        RAISE EXCEPTION 'chat_forbidden: cannot undelete';
      END IF;
      IF OLD.sender_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'chat_forbidden: delete only own messages';
      END IF;
      NEW.deleted_by := auth.uid();
      NEW.content := 'Message deleted';
      NEW.has_attachment := false;
    ELSIF NEW.content IS DISTINCT FROM OLD.content THEN
      RAISE EXCEPTION 'chat_forbidden: cannot edit message content';
    END IF;

    -- Non-sender may only flip read flags
    IF auth.uid() IS DISTINCT FROM OLD.sender_id THEN
      IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
         OR NEW.content IS DISTINCT FROM OLD.content THEN
        RAISE EXCEPTION 'chat_forbidden: receiver cannot edit/delete';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_guard_chat_update ON public.messages;
CREATE TRIGGER trg_messages_guard_chat_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.messages_guard_chat_update();

-- ── 6. RLS harden: DM matrix + deny arbitrary joins + no NULL school bypass ──
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages read participants" ON public.messages;
DROP POLICY IF EXISTS "messages send" ON public.messages;
DROP POLICY IF EXISTS "messages mark read" ON public.messages;
DROP POLICY IF EXISTS "messages insert dm" ON public.messages;
DROP POLICY IF EXISTS "messages update participant" ON public.messages;
DROP POLICY IF EXISTS "messages delete deny" ON public.messages;
DROP POLICY IF EXISTS "messages select participants" ON public.messages;

CREATE POLICY "messages read participants" ON public.messages
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND (
      sender_id = auth.uid()
      OR receiver_id = auth.uid()
      OR (conversation_id IS NOT NULL AND public.is_chat_participant(conversation_id, auth.uid()))
    )
  );

CREATE POLICY "messages send" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND school_id = public.get_my_school_id()
    AND (
      (
        conversation_id IS NOT NULL
        AND public.is_chat_participant(conversation_id, auth.uid())
      )
      OR (
        conversation_id IS NULL
        AND receiver_id IS NOT NULL
        AND public.chat_can_dm(auth.uid(), receiver_id)
      )
    )
  );

CREATE POLICY "messages mark read" ON public.messages
  FOR UPDATE TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND (
      receiver_id = auth.uid()
      OR sender_id = auth.uid()
      OR (conversation_id IS NOT NULL AND public.is_chat_participant(conversation_id, auth.uid()))
    )
  )
  WITH CHECK (
    school_id = public.get_my_school_id()
    AND (
      receiver_id = auth.uid()
      OR sender_id = auth.uid()
      OR (conversation_id IS NOT NULL AND public.is_chat_participant(conversation_id, auth.uid()))
    )
  );

CREATE POLICY "messages delete deny" ON public.messages
  FOR DELETE TO authenticated
  USING (false);

-- Conversations: read members only; no client insert/update/delete
DROP POLICY IF EXISTS "chat_conversations participant read" ON public.chat_conversations;
DROP POLICY IF EXISTS "chat conv insert deny" ON public.chat_conversations;
DROP POLICY IF EXISTS "chat conv update deny" ON public.chat_conversations;
DROP POLICY IF EXISTS "chat conv delete deny" ON public.chat_conversations;

CREATE POLICY "chat_conversations participant read" ON public.chat_conversations
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND public.is_chat_participant(id, auth.uid())
  );

CREATE POLICY "chat conv insert deny" ON public.chat_conversations
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY "chat conv update deny" ON public.chat_conversations
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY "chat conv delete deny" ON public.chat_conversations
  FOR DELETE TO authenticated
  USING (false);

-- Participants: no client join / leave; update last_read only for self
DROP POLICY IF EXISTS "chat_participants self read" ON public.chat_participants;
DROP POLICY IF EXISTS "chat_participants self update read" ON public.chat_participants;
DROP POLICY IF EXISTS "chat part insert deny" ON public.chat_participants;
DROP POLICY IF EXISTS "chat part delete deny" ON public.chat_participants;

CREATE POLICY "chat_participants self read" ON public.chat_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_chat_participant(conversation_id, auth.uid())
  );

CREATE POLICY "chat part insert deny" ON public.chat_participants
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY "chat_participants self update read" ON public.chat_participants
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "chat part delete deny" ON public.chat_participants
  FOR DELETE TO authenticated
  USING (false);

-- Attachments metadata: read via message ACL; no direct client insert
DROP POLICY IF EXISTS "message_attachments participant read" ON public.message_attachments;
DROP POLICY IF EXISTS "message_attachments insert deny" ON public.message_attachments;
DROP POLICY IF EXISTS "message_attachments delete deny" ON public.message_attachments;

CREATE POLICY "message_attachments participant read" ON public.message_attachments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_id
        AND m.school_id = public.get_my_school_id()
        AND (
          m.sender_id = auth.uid()
          OR m.receiver_id = auth.uid()
          OR (m.conversation_id IS NOT NULL AND public.is_chat_participant(m.conversation_id, auth.uid()))
        )
    )
  );

CREATE POLICY "message_attachments insert deny" ON public.message_attachments
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY "message_attachments delete deny" ON public.message_attachments
  FOR DELETE TO authenticated
  USING (false);

-- ── 7. Storage bucket: chat-attachments/{school_id}/{user_id}/... ────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  false,
  10485760,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "chat attachments read school" ON storage.objects;
DROP POLICY IF EXISTS "chat attachments upload scoped" ON storage.objects;
DROP POLICY IF EXISTS "chat attachments update own" ON storage.objects;
DROP POLICY IF EXISTS "chat attachments delete own" ON storage.objects;

CREATE POLICY "chat attachments read school" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = public.get_my_school_id()::text
  );

CREATE POLICY "chat attachments upload scoped" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = public.get_my_school_id()::text
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "chat attachments update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = public.get_my_school_id()::text
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = public.get_my_school_id()::text
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

CREATE POLICY "chat attachments delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'chat-attachments'
    AND (storage.foldername(name))[1] = public.get_my_school_id()::text
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

-- Legacy 2-arg send must not bypass matrix / attachment checks
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
  RETURN public.rpc_send_chat_message(
    NULL, _receiver_id, _content, NULL, NULL, NULL, NULL, NULL
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_send_direct_message(uuid, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_send_direct_message(uuid, text) TO authenticated;

-- Teacher group: students/parents cannot create
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
    RAISE EXCEPTION 'chat_forbidden: cannot create teacher group';
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
