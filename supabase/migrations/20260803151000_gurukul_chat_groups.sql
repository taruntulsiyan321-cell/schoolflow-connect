-- ============================================================
-- Gurukul Chat MVP — Class Group + Teacher Group
-- Only these two group kinds. School-scoped. RLS + RPCs.
-- ============================================================

-- ── 1. Tables ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chat_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('class_group', 'teacher_group')),
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  title text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_groups_class_kind_chk CHECK (
    (kind = 'class_group' AND class_id IS NOT NULL)
    OR (kind = 'teacher_group' AND class_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS chat_groups_one_class_group_uidx
  ON public.chat_groups (school_id, class_id)
  WHERE kind = 'class_group';

CREATE UNIQUE INDEX IF NOT EXISTS chat_groups_one_teacher_group_uidx
  ON public.chat_groups (school_id)
  WHERE kind = 'teacher_group';

CREATE INDEX IF NOT EXISTS chat_groups_school_idx ON public.chat_groups (school_id);

CREATE TABLE IF NOT EXISTS public.chat_group_members (
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  last_read_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_group_members_user_idx
  ON public.chat_group_members (user_id);

CREATE TABLE IF NOT EXISTS public.chat_group_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.chat_groups(id) ON DELETE CASCADE,
  school_id uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id),
  content text NOT NULL DEFAULT '',
  reply_to_id uuid REFERENCES public.chat_group_messages(id) ON DELETE SET NULL,
  attachment_url text,
  attachment_name text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_group_messages_body_chk CHECK (
    deleted_at IS NOT NULL
    OR length(trim(content)) > 0
    OR attachment_url IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS chat_group_messages_group_created_idx
  ON public.chat_group_messages (group_id, created_at);

-- DM attachment / reply columns (optional extras on legacy messages)
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attachment_url text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- ── 2. RLS ───────────────────────────────────────────────────
ALTER TABLE public.chat_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_group_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_groups_select_member ON public.chat_groups;
CREATE POLICY chat_groups_select_member ON public.chat_groups
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND EXISTS (
      SELECT 1 FROM public.chat_group_members m
      WHERE m.group_id = id AND m.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS chat_group_members_select_self ON public.chat_group_members;
CREATE POLICY chat_group_members_select_self ON public.chat_group_members
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.chat_group_members self
      JOIN public.chat_groups g ON g.id = self.group_id
      WHERE self.group_id = chat_group_members.group_id
        AND self.user_id = auth.uid()
        AND g.school_id = public.get_my_school_id()
    )
  );

DROP POLICY IF EXISTS chat_group_members_update_self ON public.chat_group_members;
CREATE POLICY chat_group_members_update_self ON public.chat_group_members
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS chat_group_messages_select_member ON public.chat_group_messages;
CREATE POLICY chat_group_messages_select_member ON public.chat_group_messages
  FOR SELECT TO authenticated
  USING (
    school_id = public.get_my_school_id()
    AND EXISTS (
      SELECT 1 FROM public.chat_group_members m
      WHERE m.group_id = chat_group_messages.group_id
        AND m.user_id = auth.uid()
    )
  );

-- Writes go through SECURITY DEFINER RPCs
REVOKE ALL ON public.chat_groups FROM anon, authenticated;
REVOKE ALL ON public.chat_group_members FROM anon, authenticated;
REVOKE ALL ON public.chat_group_messages FROM anon, authenticated;
GRANT SELECT ON public.chat_groups TO authenticated;
GRANT SELECT, UPDATE ON public.chat_group_members TO authenticated;
GRANT SELECT ON public.chat_group_messages TO authenticated;
GRANT ALL ON public.chat_groups TO service_role;
GRANT ALL ON public.chat_group_members TO service_role;
GRANT ALL ON public.chat_group_messages TO service_role;

-- ── 3. Product DM rules (tighten to MVP) ─────────────────────
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
  IF caller_id IS NULL THEN RETURN; END IF;
  caller_school := public.get_my_school_id();
  IF caller_school IS NULL THEN RETURN; END IF;

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

  IF caller_role IS NULL THEN RETURN; END IF;
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
      -- Principal: students + teachers
      (caller_role IN ('admin', 'principal')
        AND ur.role IN ('teacher', 'student'))
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
      -- Parent: teachers + principal
      OR (caller_role = 'parent'
        AND ur.role IN ('teacher', 'principal'))
    );
END;
$$;

-- ── 4. Helpers ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._chat_caller_role()
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

CREATE OR REPLACE FUNCTION public._chat_assert_group_member(_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_group_members
    WHERE group_id = _group_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'not a group member';
  END IF;
END;
$$;

-- ── 5. Create Class Group ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_create_class_group(_class_id uuid)
RETURNS public.chat_groups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.get_my_school_id();
  _role text := public._chat_caller_role();
  _cls record;
  _title text;
  _row public.chat_groups;
  _teacher_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _school IS NULL THEN RAISE EXCEPTION 'school required'; END IF;
  IF _role NOT IN ('teacher', 'principal', 'admin') THEN
    RAISE EXCEPTION 'only teachers or principal may create class groups';
  END IF;

  SELECT c.id, c.name, c.section, c.school_id
  INTO _cls
  FROM public.classes c
  WHERE c.id = _class_id AND c.school_id = _school;
  IF _cls.id IS NULL THEN RAISE EXCEPTION 'class not found'; END IF;

  IF _role = 'teacher' THEN
    SELECT t.id INTO _teacher_id
    FROM public.teachers t
    WHERE t.user_id = _uid AND t.school_id = _school
    LIMIT 1;
    IF _teacher_id IS NULL THEN RAISE EXCEPTION 'teacher profile required'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = _teacher_id AND t.class_teacher_of = _class_id
    ) AND NOT EXISTS (
      SELECT 1 FROM public.teacher_classes tc
      WHERE tc.teacher_id = _teacher_id AND tc.class_id = _class_id AND tc.school_id = _school
    ) THEN
      RAISE EXCEPTION 'not assigned to this class';
    END IF;
  END IF;

  _title := trim(COALESCE(_cls.name, '') || CASE WHEN COALESCE(_cls.section, '') <> '' THEN '-' || _cls.section ELSE '' END);
  IF _title = '' THEN _title := 'Class Group'; END IF;
  _title := _title || ' Class Group';

  INSERT INTO public.chat_groups (school_id, kind, class_id, title, created_by)
  VALUES (_school, 'class_group', _class_id, _title, _uid)
  ON CONFLICT (school_id, class_id) WHERE (kind = 'class_group') DO NOTHING
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    SELECT * INTO _row FROM public.chat_groups
    WHERE school_id = _school AND kind = 'class_group' AND class_id = _class_id;
  END IF;

  -- Members: students in class
  INSERT INTO public.chat_group_members (group_id, user_id)
  SELECT _row.id, s.user_id
  FROM public.students s
  WHERE s.class_id = _class_id
    AND s.school_id = _school
    AND s.user_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Members: assigned teachers
  INSERT INTO public.chat_group_members (group_id, user_id)
  SELECT DISTINCT _row.id, t.user_id
  FROM public.teachers t
  WHERE t.school_id = _school
    AND t.user_id IS NOT NULL
    AND (
      t.class_teacher_of = _class_id
      OR EXISTS (
        SELECT 1 FROM public.teacher_classes tc
        WHERE tc.teacher_id = t.id AND tc.class_id = _class_id AND tc.school_id = _school
      )
    )
  ON CONFLICT DO NOTHING;

  -- Ensure creator is a member
  INSERT INTO public.chat_group_members (group_id, user_id)
  VALUES (_row.id, _uid)
  ON CONFLICT DO NOTHING;

  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_create_class_group(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_create_class_group(uuid) TO authenticated;

-- ── 6. Create Teacher Group ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_create_teacher_group()
RETURNS public.chat_groups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.get_my_school_id();
  _role text := public._chat_caller_role();
  _row public.chat_groups;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _school IS NULL THEN RAISE EXCEPTION 'school required'; END IF;
  IF _role NOT IN ('teacher', 'principal', 'admin') THEN
    RAISE EXCEPTION 'only teachers or principal may create teacher group';
  END IF;

  INSERT INTO public.chat_groups (school_id, kind, class_id, title, created_by)
  VALUES (_school, 'teacher_group', NULL, 'Teacher Group', _uid)
  ON CONFLICT (school_id) WHERE (kind = 'teacher_group') DO NOTHING
  RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    SELECT * INTO _row FROM public.chat_groups
    WHERE school_id = _school AND kind = 'teacher_group';
  END IF;

  INSERT INTO public.chat_group_members (group_id, user_id)
  SELECT _row.id, t.user_id
  FROM public.teachers t
  WHERE t.school_id = _school AND t.user_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO public.chat_group_members (group_id, user_id)
  SELECT _row.id, ur.user_id
  FROM public.user_roles ur
  JOIN public.profiles p ON p.id = ur.user_id
  WHERE p.school_id = _school
    AND ur.role IN ('principal', 'admin')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.chat_group_members (group_id, user_id)
  VALUES (_row.id, _uid)
  ON CONFLICT DO NOTHING;

  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_create_teacher_group() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_create_teacher_group() TO authenticated;

-- ── 7. List groups for caller ────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_list_chat_groups()
RETURNS TABLE (
  id uuid,
  kind text,
  title text,
  class_id uuid,
  member_count integer,
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
  IF _uid IS NULL OR _school IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT
    g.id,
    g.kind,
    g.title,
    g.class_id,
    (SELECT COUNT(*)::integer FROM public.chat_group_members m WHERE m.group_id = g.id) AS member_count,
    (
      SELECT COUNT(*)::integer
      FROM public.chat_group_messages msg
      JOIN public.chat_group_members mem ON mem.group_id = g.id AND mem.user_id = _uid
      WHERE msg.group_id = g.id
        AND msg.deleted_at IS NULL
        AND msg.sender_id <> _uid
        AND (mem.last_read_at IS NULL OR msg.created_at > mem.last_read_at)
    ) AS unread,
    (
      SELECT CASE
        WHEN lm.deleted_at IS NOT NULL THEN 'Message deleted'
        WHEN lm.attachment_url IS NOT NULL AND coalesce(trim(lm.content), '') = '' THEN 'Attachment'
        ELSE lm.content
      END
      FROM public.chat_group_messages lm
      WHERE lm.group_id = g.id
      ORDER BY lm.created_at DESC
      LIMIT 1
    ) AS last_message,
    (
      SELECT lm.created_at
      FROM public.chat_group_messages lm
      WHERE lm.group_id = g.id
      ORDER BY lm.created_at DESC
      LIMIT 1
    ) AS last_time
  FROM public.chat_groups g
  JOIN public.chat_group_members me ON me.group_id = g.id AND me.user_id = _uid
  WHERE g.school_id = _school
  ORDER BY last_time DESC NULLS LAST, g.title;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_list_chat_groups() FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_list_chat_groups() TO authenticated;

-- ── 8. Group thread + send + mark read + delete ──────────────
CREATE OR REPLACE FUNCTION public.rpc_list_group_messages(_group_id uuid)
RETURNS TABLE (
  id uuid,
  group_id uuid,
  sender_id uuid,
  sender_name text,
  content text,
  reply_to_id uuid,
  attachment_url text,
  attachment_name text,
  deleted_at timestamptz,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._chat_assert_group_member(_group_id);

  RETURN QUERY
  SELECT
    m.id,
    m.group_id,
    m.sender_id,
    COALESCE(p.full_name, 'Unknown') AS sender_name,
    CASE WHEN m.deleted_at IS NOT NULL THEN '' ELSE m.content END AS content,
    m.reply_to_id,
    CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.attachment_url END AS attachment_url,
    CASE WHEN m.deleted_at IS NOT NULL THEN NULL ELSE m.attachment_name END AS attachment_name,
    m.deleted_at,
    m.created_at
  FROM public.chat_group_messages m
  LEFT JOIN public.profiles p ON p.id = m.sender_id
  WHERE m.group_id = _group_id
  ORDER BY m.created_at ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_list_group_messages(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_list_group_messages(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_send_group_message(
  _group_id uuid,
  _content text,
  _reply_to_id uuid DEFAULT NULL,
  _attachment_url text DEFAULT NULL,
  _attachment_name text DEFAULT NULL
)
RETURNS public.chat_group_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.get_my_school_id();
  _body text := trim(COALESCE(_content, ''));
  _row public.chat_group_messages;
  _g public.chat_groups;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _school IS NULL THEN RAISE EXCEPTION 'school required'; END IF;
  PERFORM public._chat_assert_group_member(_group_id);

  SELECT * INTO _g FROM public.chat_groups WHERE id = _group_id AND school_id = _school;
  IF _g.id IS NULL THEN RAISE EXCEPTION 'group not found'; END IF;

  IF length(_body) = 0 AND _attachment_url IS NULL THEN
    RAISE EXCEPTION 'Message cannot be empty';
  END IF;
  IF length(_body) > 8000 THEN RAISE EXCEPTION 'Message too long'; END IF;

  IF _reply_to_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.chat_group_messages r
    WHERE r.id = _reply_to_id AND r.group_id = _group_id
  ) THEN
    RAISE EXCEPTION 'invalid reply target';
  END IF;

  INSERT INTO public.chat_group_messages (
    group_id, school_id, sender_id, content, reply_to_id, attachment_url, attachment_name
  ) VALUES (
    _group_id, _school, _uid, _body, _reply_to_id, _attachment_url, _attachment_name
  )
  RETURNING * INTO _row;

  UPDATE public.chat_group_members
  SET last_read_at = now()
  WHERE group_id = _group_id AND user_id = _uid;

  RETURN _row;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_send_group_message(uuid, text, uuid, text, text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_send_group_message(uuid, text, uuid, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_mark_group_read(_group_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._chat_assert_group_member(_group_id);
  UPDATE public.chat_group_members
  SET last_read_at = now()
  WHERE group_id = _group_id AND user_id = auth.uid();
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_mark_group_read(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_mark_group_read(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_delete_group_message(_message_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _msg public.chat_group_messages;
BEGIN
  SELECT * INTO _msg FROM public.chat_group_messages WHERE id = _message_id;
  IF _msg.id IS NULL THEN RAISE EXCEPTION 'message not found'; END IF;
  PERFORM public._chat_assert_group_member(_msg.group_id);
  IF _msg.sender_id <> auth.uid() THEN
    RAISE EXCEPTION 'can only delete own messages';
  END IF;
  UPDATE public.chat_group_messages
  SET deleted_at = now(), content = '', attachment_url = NULL, attachment_name = NULL
  WHERE id = _message_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_delete_group_message(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.rpc_delete_group_message(uuid) TO authenticated;

-- ── 9. Notify group members + unread total includes groups ───
CREATE OR REPLACE FUNCTION public.trg_group_messages_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _name text;
  _title text;
  _mem record;
  _role text;
  _link text;
BEGIN
  SELECT COALESCE(p.full_name, 'Someone') INTO _name
  FROM public.profiles p WHERE p.id = NEW.sender_id;
  SELECT g.title INTO _title FROM public.chat_groups g WHERE g.id = NEW.group_id;

  FOR _mem IN
    SELECT m.user_id FROM public.chat_group_members m
    WHERE m.group_id = NEW.group_id AND m.user_id <> NEW.sender_id
  LOOP
    SELECT ur.role::text INTO _role
    FROM public.user_roles ur
    WHERE ur.user_id = _mem.user_id
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
      _mem.user_id,
      'message',
      COALESCE(_title, 'Group') || ': new message',
      left(COALESCE(_name, 'Someone') || ': ' || COALESCE(NEW.content, 'Attachment'), 160),
      'users',
      _link
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS chat_group_messages_notify ON public.chat_group_messages;
CREATE TRIGGER chat_group_messages_notify
  AFTER INSERT ON public.chat_group_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_group_messages_notify();

CREATE OR REPLACE FUNCTION public.get_chat_unread_total()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (
    (SELECT COUNT(*)::integer
     FROM public.messages
     WHERE receiver_id = auth.uid() AND is_read = false AND deleted_at IS NULL)
    +
    (SELECT COUNT(*)::integer
     FROM public.chat_group_messages msg
     JOIN public.chat_group_members mem
       ON mem.group_id = msg.group_id AND mem.user_id = auth.uid()
     WHERE msg.deleted_at IS NULL
       AND msg.sender_id <> auth.uid()
       AND (mem.last_read_at IS NULL OR msg.created_at > mem.last_read_at))
  )::integer;
$$;

-- Realtime for group messages
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'chat_group_messages'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_group_messages;
  END IF;
END $$;
