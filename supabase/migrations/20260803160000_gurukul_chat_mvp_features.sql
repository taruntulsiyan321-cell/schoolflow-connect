-- ============================================================
-- Gurukul Chat MVP — message features (reply / attach / delete / groups)
-- Apply after APPLY_GURUKUL_CHAT_LIVE_SYNC.sql
-- ============================================================

-- ── 1. Rich message columns ──────────────────────────────────
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id),
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_mime text,
  ADD COLUMN IF NOT EXISTS has_attachment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS read_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversation_id uuid;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON public.messages (reply_to_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages (conversation_id, created_at);

-- ── 2. Conversations (Class Group / Teacher Group only) ──────
CREATE TABLE IF NOT EXISTS public.chat_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('class_group', 'teacher_group')),
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (school_id, kind, class_id)
);

CREATE TABLE IF NOT EXISTS public.chat_participants (
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

ALTER TABLE public.messages
  DROP CONSTRAINT IF EXISTS messages_conversation_id_fkey;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_conversation_id_fkey
  FOREIGN KEY (conversation_id) REFERENCES public.chat_conversations(id) ON DELETE CASCADE;

ALTER TABLE public.chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_conversations_select ON public.chat_conversations;
CREATE POLICY chat_conversations_select ON public.chat_conversations
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND EXISTS (
      SELECT 1 FROM public.chat_participants p
      WHERE p.conversation_id = chat_conversations.id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS chat_participants_select ON public.chat_participants;
CREATE POLICY chat_participants_select ON public.chat_participants
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.chat_participants me
      WHERE me.conversation_id = chat_participants.conversation_id
        AND me.user_id = auth.uid()
    )
  );

-- ── 3. Contacts RPC — include photo_url ──────────────────────
-- Must DROP first: OUT/return row type changes (e.g. app_role→text, +photo_url) hit 42P13.
DROP FUNCTION IF EXISTS public.get_chat_contacts();
CREATE OR REPLACE FUNCTION public.get_chat_contacts()
RETURNS TABLE(user_id uuid, name text, role text, photo_url text)
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

  SELECT ur.role::text INTO caller_role
  FROM public.user_roles ur
  WHERE ur.user_id = caller_id
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

  IF caller_role IS NULL THEN
    RETURN;
  END IF;

  caller_class := public.student_class_id(caller_id);

  RETURN QUERY
  SELECT DISTINCT
    u.id AS user_id,
    COALESCE(p.full_name, u.email, u.phone, 'Unknown') AS name,
    ur.role::text AS role,
    p.photo_url::text AS photo_url
  FROM auth.users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  JOIN public.profiles p ON p.id = u.id
  WHERE u.id <> caller_id
    AND p.school_id = caller_school
    AND COALESCE(p.is_active, true)
    AND (
      (caller_role IN ('admin', 'principal')
        AND ur.role IN ('teacher', 'student', 'principal', 'admin', 'parent'))
      OR (caller_role = 'teacher'
        AND ur.role IN ('student', 'teacher', 'principal', 'admin', 'parent'))
      OR (caller_role = 'student'
        AND (
          (ur.role = 'student'
            AND caller_class IS NOT NULL
            AND public.student_class_id(u.id) = caller_class)
          OR ur.role IN ('teacher', 'principal', 'admin')
        ))
      OR (caller_role = 'parent'
        AND ur.role IN ('teacher', 'principal', 'admin'))
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_chat_contacts() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_chat_contacts() TO authenticated;

-- ── 4. Extended direct send ──────────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_send_direct_message(uuid, text);

CREATE OR REPLACE FUNCTION public.rpc_send_direct_message(
  _receiver_id uuid,
  _content text,
  _reply_to_id uuid DEFAULT NULL,
  _attachment_url text DEFAULT NULL,
  _attachment_name text DEFAULT NULL,
  _attachment_mime text DEFAULT NULL
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
  _row public.messages;
BEGIN
  IF _sender IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF _receiver_id IS NULL OR _receiver_id = _sender THEN
    RAISE EXCEPTION 'invalid receiver';
  END IF;
  IF length(_body) = 0 AND COALESCE(_attachment_url, '') = '' THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;
  IF length(_body) > 8000 THEN
    RAISE EXCEPTION 'Message too long';
  END IF;

  _school := public.get_my_school_id();
  IF _school IS NULL THEN
    RAISE EXCEPTION 'school required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.get_chat_contacts() c WHERE c.user_id = _receiver_id
  ) THEN
    RAISE EXCEPTION 'receiver not allowed';
  END IF;

  IF _reply_to_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = _reply_to_id
      AND (
        (m.sender_id = _sender AND m.receiver_id = _receiver_id)
        OR (m.sender_id = _receiver_id AND m.receiver_id = _sender)
      )
  ) THEN
    RAISE EXCEPTION 'invalid reply target';
  END IF;

  INSERT INTO public.messages (
    sender_id, receiver_id, content, is_read, school_id,
    reply_to_id, attachment_url, attachment_name, attachment_mime, has_attachment
  )
  VALUES (
    _sender, _receiver_id,
    CASE WHEN length(_body) > 0 THEN _body ELSE COALESCE('📎 ' || _attachment_name, 'Attachment') END,
    false, _school,
    _reply_to_id, _attachment_url, _attachment_name, _attachment_mime,
    COALESCE(_attachment_url, '') <> ''
  )
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_send_direct_message(uuid, text, uuid, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_send_direct_message(uuid, text, uuid, text, text, text) TO authenticated;

-- ── 5. Soft delete (own messages only) ───────────────────────
CREATE OR REPLACE FUNCTION public.rpc_delete_message(_message_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  UPDATE public.messages
  SET deleted_at = now(),
      content = '',
      attachment_url = NULL,
      attachment_name = NULL,
      attachment_mime = NULL,
      has_attachment = false
  WHERE id = _message_id
    AND sender_id = _uid
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'cannot delete message';
  END IF;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_delete_message(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_delete_message(uuid) TO authenticated;

DROP POLICY IF EXISTS "messages soft delete own" ON public.messages;
CREATE POLICY "messages soft delete own" ON public.messages
  FOR UPDATE TO authenticated
  USING (sender_id = auth.uid())
  WITH CHECK (sender_id = auth.uid());

-- ── 6. Group helpers ─────────────────────────────────────────
DROP FUNCTION IF EXISTS public.get_chat_groups();
CREATE OR REPLACE FUNCTION public.get_chat_groups()
RETURNS TABLE(
  conversation_id uuid,
  name text,
  kind text,
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
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.name,
    c.kind,
    COALESCE((
      SELECT COUNT(*)::integer
      FROM public.messages m
      WHERE m.conversation_id = c.id
        AND m.sender_id <> _uid
        AND m.deleted_at IS NULL
        AND m.created_at > COALESCE(p.last_read_at, 'epoch'::timestamptz)
    ), 0) AS unread,
    (
      SELECT CASE
        WHEN lm.deleted_at IS NOT NULL THEN 'This message was deleted'
        WHEN COALESCE(lm.attachment_name, '') <> '' AND trim(lm.content) = '' THEN '📎 ' || lm.attachment_name
        ELSE lm.content
      END
      FROM public.messages lm
      WHERE lm.conversation_id = c.id
      ORDER BY lm.created_at DESC
      LIMIT 1
    ) AS last_message,
    (
      SELECT lm.created_at
      FROM public.messages lm
      WHERE lm.conversation_id = c.id
      ORDER BY lm.created_at DESC
      LIMIT 1
    ) AS last_time
  FROM public.chat_conversations c
  JOIN public.chat_participants p ON p.conversation_id = c.id AND p.user_id = _uid
  WHERE c.school_id = public.get_my_school_id();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_chat_groups() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.get_chat_groups() TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_create_class_group()
RETURNS TABLE(conversation_id uuid, name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _school uuid;
  _role text;
  _class_id uuid;
  _class_name text;
  _conv_id uuid;
  _name text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  _school := public.get_my_school_id();
  IF _school IS NULL THEN
    RAISE EXCEPTION 'school required';
  END IF;

  SELECT ur.role::text INTO _role
  FROM public.user_roles ur
  WHERE ur.user_id = _uid
  ORDER BY
    CASE ur.role
      WHEN 'admin' THEN 1
      WHEN 'principal' THEN 2
      WHEN 'teacher' THEN 3
      ELSE 6
    END
  LIMIT 1;

  IF _role IS NULL OR _role NOT IN ('teacher', 'principal', 'admin') THEN
    RAISE EXCEPTION 'not allowed to create Class Group';
  END IF;

  IF _role = 'teacher' THEN
    SELECT t.class_teacher_of INTO _class_id
    FROM public.teachers t
    WHERE t.user_id = _uid AND t.school_id = _school
    LIMIT 1;
    IF _class_id IS NULL THEN
      RAISE EXCEPTION 'Only class teachers can create a Class Group';
    END IF;
  ELSE
    -- principal/admin: require an explicit class via teacher mapping is not available —
    -- use first class they administer; prefer class_teacher if any
    SELECT t.class_teacher_of INTO _class_id
    FROM public.teachers t
    WHERE t.user_id = _uid AND t.class_teacher_of IS NOT NULL
    LIMIT 1;
    IF _class_id IS NULL THEN
      SELECT c.id INTO _class_id
      FROM public.classes c
      WHERE c.school_id = _school
      ORDER BY c.name
      LIMIT 1;
    END IF;
    IF _class_id IS NULL THEN
      RAISE EXCEPTION 'No class available for Class Group';
    END IF;
  END IF;

  SELECT COALESCE(c.name || COALESCE('-' || NULLIF(c.section, ''), ''), 'Class') INTO _class_name
  FROM public.classes c WHERE c.id = _class_id;

  _name := 'Class Group · ' || _class_name;

  INSERT INTO public.chat_conversations (school_id, kind, class_id, name, created_by)
  VALUES (_school, 'class_group', _class_id, _name, _uid)
  ON CONFLICT (school_id, kind, class_id) DO UPDATE SET name = EXCLUDED.name
  RETURNING id INTO _conv_id;

  IF _conv_id IS NULL THEN
    SELECT id INTO _conv_id FROM public.chat_conversations
    WHERE school_id = _school AND kind = 'class_group' AND class_id = _class_id;
  END IF;

  -- Participants: class teacher(s) + students in class + principals/admins of school
  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _conv_id, t.user_id
  FROM public.teachers t
  WHERE t.class_teacher_of = _class_id AND t.user_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _conv_id, s.user_id
  FROM public.students s
  WHERE s.class_id = _class_id AND s.user_id IS NOT NULL AND s.school_id = _school
  ON CONFLICT DO NOTHING;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _conv_id, ur.user_id
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE p.school_id = _school AND ur.role IN ('principal', 'admin')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  VALUES (_conv_id, _uid)
  ON CONFLICT DO NOTHING;

  conversation_id := _conv_id;
  name := _name;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_create_class_group() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_create_class_group() TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_send_group_message(
  _conversation_id uuid,
  _content text,
  _reply_to_id uuid DEFAULT NULL,
  _attachment_url text DEFAULT NULL,
  _attachment_name text DEFAULT NULL,
  _attachment_mime text DEFAULT NULL
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
  _row public.messages;
BEGIN
  IF _sender IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_participants p
    WHERE p.conversation_id = _conversation_id AND p.user_id = _sender
  ) THEN
    RAISE EXCEPTION 'not a group participant';
  END IF;
  IF length(_body) = 0 AND COALESCE(_attachment_url, '') = '' THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;

  SELECT school_id INTO _school FROM public.chat_conversations WHERE id = _conversation_id;

  INSERT INTO public.messages (
    sender_id, receiver_id, content, is_read, school_id, conversation_id,
    reply_to_id, attachment_url, attachment_name, attachment_mime, has_attachment
  )
  VALUES (
    _sender, _sender,
    CASE WHEN length(_body) > 0 THEN _body ELSE COALESCE('📎 ' || _attachment_name, 'Attachment') END,
    true, _school, _conversation_id,
    _reply_to_id, _attachment_url, _attachment_name, _attachment_mime,
    COALESCE(_attachment_url, '') <> ''
  )
  RETURNING * INTO _row;

  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_send_group_message(uuid, text, uuid, text, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_send_group_message(uuid, text, uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_mark_group_messages_read(_conversation_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  UPDATE public.chat_participants
  SET last_read_at = now()
  WHERE conversation_id = _conversation_id AND user_id = _uid;
  RETURN 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_mark_group_messages_read(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_mark_group_messages_read(uuid) TO authenticated;

-- Realtime for conversations
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_conversations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_conversations;
  END IF;
END $$;
