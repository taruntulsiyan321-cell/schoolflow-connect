-- =====================================================================
-- CHUNK 1.5 — CONVERGE user_roles
--
-- RLS resolves roles through memberships. 31 functions still read user_roles
-- with global-role semantics, so a role revoked in memberships stays granted
-- inside them. Two sources of truth, one unmaintained.
--
-- This converges all 31 and then makes user_roles physically read-only, so
-- requirement 3 ("no new writes from any path") is proven by the schema rather
-- than by having read the code carefully.
--
-- SHAPE OF THE REWRITE, applied uniformly:
--   * "what role is the caller acting in"  -> active_membership_role(),
--     which is one role for one session (locked decision 2).
--   * "what role does that OTHER person hold" -> membership_role_at(them,
--     my active institution) — never their global role, never a role at an
--     institution I am not in.
--   * "who are the operators of institution X" -> memberships at X, not
--     user_roles joined to profiles.school_id.
--   * super_admin resolves ONLY from the super_admins table (verification 4).
--
-- BEHAVIOUR CHANGES, deliberate and flagged:
--   1. claim_signup_role() no longer creates anything. Self-claiming a role
--      contradicts the invitation model — an admin invites, the person
--      accepts, and nothing is visible until they do (locked decision 2).
--      It now reports the active membership role and grants nothing.
--   2. handle_new_user() and get_auth_context() no longer insert a role. A new
--      signup has no access until invited. That is the spec, and it was
--      already effectively true since a roleless account resolved no school.
--   3. link_portal_on_auth() now creates an ACTIVE membership when it binds a
--      local record. Rationale: an admin setting students.portal_email IS the
--      invitation; the identifier match is the acceptance. Without this the
--      existing portal-login flow would bind the record and grant nothing.
--   4. _community_user_role() no longer defaults to 'student' for an unknown
--      user. It returns NULL, because "no membership" must mean "nothing".
--
-- Reverse: supabase/migrations/rollback/20260826120000_chunk15_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — the two resolvers every rewritten function uses
-- ---------------------------------------------------------------------

-- The role another account holds at a given institution. Priority order is
-- the one the chat helpers already used, kept so their behaviour is unchanged
-- for anyone holding a single membership.
CREATE OR REPLACE FUNCTION public.membership_role_at(_user_id uuid, _school_id uuid)
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.role
    FROM public.memberships m
   WHERE m.account_id = _user_id
     AND m.school_id = _school_id
     AND m.status = 'active'
   ORDER BY CASE m.role
              WHEN 'admin'     THEN 1
              WHEN 'principal' THEN 2
              WHEN 'teacher'   THEN 3
              WHEN 'student'   THEN 4
              WHEN 'parent'    THEN 5
              ELSE 6
            END
   LIMIT 1
$$;

-- The role to treat an account as holding, from the caller's point of view.
-- For the caller themself this is the ACTIVE membership — one session, one
-- role. super_admin comes from the super_admins table and nowhere else.
CREATE OR REPLACE FUNCTION public.effective_role(_user_id uuid DEFAULT auth.uid())
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN _user_id = auth.uid() AND public.is_super_admin()
      THEN 'super_admin'::public.app_role
    WHEN _user_id = auth.uid()
      THEN public.active_membership_role()
    ELSE public.membership_role_at(_user_id, public.get_my_school_id())
  END
$$;

GRANT EXECUTE ON FUNCTION public.membership_role_at(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.effective_role(uuid)           TO authenticated;

-- Grant / revoke a membership. The admin functions below go through these so
-- the membership shape is written in exactly one place.
CREATE OR REPLACE FUNCTION public._grant_membership(
  _account uuid, _school uuid, _role public.app_role, _local_person uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _id uuid;
BEGIN
  IF _account IS NULL OR _school IS NULL OR _role IS NULL THEN
    RAISE EXCEPTION 'account, institution and role are all required';
  END IF;

  INSERT INTO public.accounts (id) VALUES (_account) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.memberships (account_id, school_id, role, local_person_id, status, invited_by, invited_at, responded_at)
  VALUES (_account, _school, _role, _local_person, 'active', auth.uid(), now(), now())
  ON CONFLICT (account_id, school_id, role) DO UPDATE
    SET status = 'active',
        local_person_id = COALESCE(EXCLUDED.local_person_id, public.memberships.local_person_id),
        responded_at = now()
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public._revoke_membership(
  _account uuid, _school uuid, _role public.app_role)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.memberships
     SET status = 'revoked', responded_at = now()
   WHERE account_id = _account AND school_id = _school AND role = _role
     AND status <> 'revoked'
$$;

REVOKE EXECUTE ON FUNCTION public._grant_membership(uuid, uuid, public.app_role, uuid) FROM public, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._revoke_membership(uuid, uuid, public.app_role)       FROM public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SECTION 2 — the 19 read-only functions
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._community_user_role(_uid uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.effective_role(_uid)::text
$$;

CREATE OR REPLACE FUNCTION public.chat_caller_role()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.effective_role(auth.uid())::text
$$;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.effective_role(auth.uid())
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS public.app_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.effective_role(_user_id)
$$;

CREATE OR REPLACE FUNCTION public.ensure_default_role()
RETURNS public.app_role
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;
  BEGIN
    PERFORM public.link_portal_on_auth(_uid);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
  RETURN public.effective_role(_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public._notify_school_operators(
  _school_id uuid, _type text, _title text, _body text DEFAULT NULL::text,
  _icon text DEFAULT NULL::text, _link text DEFAULT NULL::text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT m.account_id AS user_id
      FROM public.memberships m
     WHERE m.school_id = _school_id
       AND m.status = 'active'
       AND m.role IN ('principal'::public.app_role, 'admin'::public.app_role)
  LOOP
    PERFORM public._notify(r.user_id, _type, _title, _body, _icon, _link);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public._peek_teacher_featured_battle(_class_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _bid uuid;
BEGIN
  IF _class_id IS NULL THEN RETURN NULL; END IF;
  SELECT b.id INTO _bid
  FROM public.battles b
  WHERE b.class_id = _class_id
    AND b.is_public = true
    AND b.status IN ('live', 'scheduled')
    AND coalesce(b.source, '') NOT LIKE 'featured_%'
    AND b.source IN ('manual', 'custom', 'bank')
    AND EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.account_id = b.creator_user_id
         AND m.school_id = b.school_id
         AND m.status = 'active'
         AND m.role = 'teacher'
    )
    AND EXISTS (SELECT 1 FROM public.battle_questions bq WHERE bq.battle_id = b.id)
  ORDER BY b.starts_at DESC NULLS LAST, b.created_at DESC
  LIMIT 1;
  RETURN _bid;
END;
$$;

CREATE OR REPLACE FUNCTION public._featured_system_creator(_class_id uuid)
RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _uid uuid; _school uuid;
BEGIN
  SELECT c.school_id INTO _school FROM public.classes c WHERE c.id = _class_id;

  SELECT t.user_id INTO _uid
  FROM public.teacher_classes tc
  JOIN public.teachers t ON t.id = tc.teacher_id
  WHERE tc.class_id = _class_id AND t.user_id IS NOT NULL
  ORDER BY tc.id LIMIT 1;
  IF _uid IS NOT NULL THEN RETURN _uid; END IF;

  IF _school IS NOT NULL THEN
    SELECT m.account_id INTO _uid
    FROM public.memberships m
    WHERE m.school_id = _school
      AND m.status = 'active'
      AND m.role IN ('admin', 'principal', 'teacher')
    ORDER BY CASE m.role WHEN 'admin' THEN 1 WHEN 'principal' THEN 2 ELSE 3 END, m.account_id
    LIMIT 1;
    IF _uid IS NOT NULL THEN RETURN _uid; END IF;
  END IF;

  SELECT s.user_id INTO _uid
  FROM public.students s
  WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
  ORDER BY s.created_at NULLS LAST, s.id LIMIT 1;
  IF _uid IS NOT NULL THEN RETURN _uid; END IF;

  SELECT p.id INTO _uid FROM public.profiles p ORDER BY p.created_at NULLS LAST LIMIT 1;
  RETURN _uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_users_with_roles()
RETURNS TABLE(user_id uuid, email text, phone text, created_at timestamp with time zone, roles public.app_role[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _school uuid := public.get_my_school_id();
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can list users';
  END IF;
  IF _school IS NULL THEN
    RAISE EXCEPTION 'No school context';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text, u.phone::text, u.created_at,
         COALESCE(array_agg(m.role ORDER BY m.role) FILTER (WHERE m.role IS NOT NULL),
                  ARRAY[]::public.app_role[])
  FROM auth.users u
  JOIN public.memberships m
    ON m.account_id = u.id AND m.school_id = _school AND m.status = 'active'
  GROUP BY u.id
  ORDER BY u.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.write_academic_audit(
  _entity_type text, _entity_id uuid, _action text,
  _previous jsonb DEFAULT NULL::jsonb, _new jsonb DEFAULT NULL::jsonb,
  _school_id uuid DEFAULT NULL::uuid, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _id uuid; _sid uuid; _role text;
BEGIN
  _sid  := coalesce(_school_id, public.get_my_school_id(), public.default_school_id());
  _role := public.effective_role(auth.uid())::text;

  INSERT INTO public.academic_audit (
    school_id, entity_type, entity_id, action,
    actor_user_id, actor_role, previous_value, new_value, metadata
  ) VALUES (
    _sid, _entity_type, _entity_id, _action,
    auth.uid(), _role, _previous, _new, coalesce(_metadata, '{}'::jsonb)
  )
  RETURNING id INTO _id;
  RETURN _id;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_can_create_class_group(_uid uuid, _class_id uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _role text; cls_school uuid;
BEGIN
  IF _uid IS NULL OR _class_id IS NULL THEN RETURN false; END IF;

  SELECT c.school_id INTO cls_school FROM public.classes c WHERE c.id = _class_id;
  IF cls_school IS NULL THEN RETURN false; END IF;

  -- Tenancy from the membership, not profiles.school_id.
  _role := CASE WHEN _uid = auth.uid()
                THEN CASE WHEN public.active_membership_school_id() = cls_school
                          THEN public.active_membership_role()::text END
                ELSE public.membership_role_at(_uid, cls_school)::text
           END;
  IF _role IS NULL THEN RETURN false; END IF;

  IF _role IN ('admin', 'principal') THEN RETURN true; END IF;
  IF _role = 'teacher' THEN RETURN public.teacher_teaches_class(_uid, _class_id); END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_can_dm(_from uuid, _to uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  from_role text; to_role text; _school uuid; from_class uuid; to_class uuid;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _from = _to THEN RETURN false; END IF;

  -- One institution: the caller's active one. Both parties must be members.
  _school := CASE WHEN _from = auth.uid()
                  THEN public.active_membership_school_id()
                  ELSE public.get_my_school_id() END;
  IF _school IS NULL THEN RETURN false; END IF;

  from_role := CASE WHEN _from = auth.uid()
                    THEN public.active_membership_role()::text
                    ELSE public.membership_role_at(_from, _school)::text END;
  to_role   := public.membership_role_at(_to, _school)::text;

  IF from_role IS NULL OR to_role IS NULL THEN RETURN false; END IF;

  IF from_role IN ('admin', 'principal') THEN
    RETURN to_role IN ('student', 'teacher', 'principal', 'admin', 'parent');
  END IF;
  IF to_role IN ('admin', 'principal') AND from_role IN ('teacher', 'student', 'parent') THEN
    RETURN true;
  END IF;

  IF from_role = 'teacher' THEN
    IF to_role = 'teacher' THEN RETURN true; END IF;
    IF to_role = 'student' THEN
      RETURN public.teacher_teaches_class(_from, public.student_class_id(_to));
    END IF;
    IF to_role = 'parent' THEN
      RETURN EXISTS (
        SELECT 1
          FROM public.memberships pm
          JOIN public.parent_students ps ON ps.parent_id = pm.local_person_id
          JOIN public.students s ON s.id = ps.student_id
         WHERE pm.account_id = _to AND pm.school_id = _school
           AND pm.status = 'active' AND pm.role = 'parent'
           AND s.class_id IS NOT NULL
           AND public.teacher_teaches_class(_from, s.class_id)
      ) OR EXISTS (
        SELECT 1 FROM public.students s
         WHERE s.parent_user_id = _to AND s.school_id = _school
           AND s.class_id IS NOT NULL
           AND public.teacher_teaches_class(_from, s.class_id)
      );
    END IF;
    RETURN false;
  END IF;

  IF from_role = 'student' THEN
    from_class := public.student_class_id(_from);
    IF to_role = 'student' THEN
      to_class := public.student_class_id(_to);
      RETURN from_class IS NOT NULL AND to_class IS NOT NULL AND from_class = to_class;
    END IF;
    IF to_role = 'teacher' THEN
      RETURN from_class IS NOT NULL AND public.teacher_teaches_class(_to, from_class);
    END IF;
    RETURN false;
  END IF;

  IF from_role = 'parent' THEN
    IF to_role = 'teacher' THEN
      RETURN EXISTS (
        SELECT 1
          FROM public.memberships pm
          JOIN public.parent_students ps ON ps.parent_id = pm.local_person_id
          JOIN public.students s ON s.id = ps.student_id
         WHERE pm.account_id = _from AND pm.school_id = _school
           AND pm.status = 'active' AND pm.role = 'parent'
           AND s.class_id IS NOT NULL
           AND public.teacher_teaches_class(_to, s.class_id)
      ) OR EXISTS (
        SELECT 1 FROM public.students s
         WHERE s.parent_user_id = _from AND s.school_id = _school
           AND s.class_id IS NOT NULL
           AND public.teacher_teaches_class(_to, s.class_id)
      );
    END IF;
    RETURN false;
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_chat_contacts()
RETURNS TABLE(user_id uuid, name text, role text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE caller_id uuid := auth.uid(); caller_school uuid;
BEGIN
  IF caller_id IS NULL THEN RETURN; END IF;
  caller_school := public.active_membership_school_id();
  IF caller_school IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT DISTINCT
    m.account_id,
    COALESCE(NULLIF(p.full_name, ''), p.email, 'User')::text,
    m.role::text
  FROM public.memberships m
  JOIN public.profiles p ON p.id = m.account_id
  WHERE m.school_id = caller_school
    AND m.status = 'active'
    AND m.account_id <> caller_id
    AND COALESCE(p.is_active, true)
    AND public.chat_can_dm(caller_id, m.account_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.rpc_get_my_student_identity()
RETURNS TABLE(user_id uuid, role public.app_role, has_student_role boolean, student_id uuid,
              school_id uuid, class_id uuid, class_name text, class_section text,
              class_display_name text, class_category text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role public.app_role;
  _has_student_role boolean := false;
  _local uuid;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;

  BEGIN PERFORM public.link_portal_on_auth(_uid); EXCEPTION WHEN OTHERS THEN NULL; END;

  _role := public.effective_role(_uid);
  _has_student_role := (_role = 'student'::public.app_role);
  _local := public.active_local_person_id();

  RETURN QUERY
  SELECT
    _uid,
    _role,
    _has_student_role,
    s.id,
    COALESCE(s.school_id, public.get_my_school_id()),
    s.class_id,
    c.name, c.section, c.display_name, c.category
  FROM (SELECT _uid AS uid) AS u
  LEFT JOIN public.students s
         ON s.id = _local AND _has_student_role
  LEFT JOIN public.classes c ON c.id = s.class_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_messages_notify_receiver()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE _name text; _role text; _link text; _uid uuid;
BEGIN
  SELECT COALESCE(p.full_name, 'Someone') INTO _name
  FROM public.profiles p WHERE p.id = NEW.sender_id;

  IF NEW.conversation_id IS NOT NULL THEN
    FOR _uid IN
      SELECT cp.user_id FROM public.chat_participants cp
       WHERE cp.conversation_id = NEW.conversation_id AND cp.user_id <> NEW.sender_id
    LOOP
      _role := public.membership_role_at(_uid, NEW.school_id)::text;
      _link := CASE _role
        WHEN 'teacher'   THEN '/teacher/communication'
        WHEN 'principal' THEN '/principal/messages'
        WHEN 'parent'    THEN '/parent/chat'
        ELSE '/student/chat' END;
      PERFORM public._notify(_uid, 'message',
        'New message from ' || COALESCE(_name, 'Someone'),
        left(COALESCE(NEW.content, ''), 160), 'message-square', _link);
    END LOOP;
  ELSIF NEW.receiver_id IS NOT NULL THEN
    _role := public.membership_role_at(NEW.receiver_id, NEW.school_id)::text;
    _link := CASE _role
      WHEN 'teacher'   THEN '/teacher/communication'
      WHEN 'principal' THEN '/principal/messages'
      WHEN 'parent'    THEN '/parent/chat'
      ELSE '/student/chat' END;
    PERFORM public._notify(NEW.receiver_id, 'message',
      'New message from ' || COALESCE(_name, 'Someone'),
      left(COALESCE(NEW.content, ''), 160), 'message-square', _link);
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_chat_inbox()
RETURNS TABLE(conversation_id uuid, kind text, title text, class_id uuid, peer_user_id uuid,
              peer_role text, unread integer, last_message text, last_time timestamp with time zone)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.active_membership_school_id();
  _my_class uuid;
  _role text;
BEGIN
  IF _uid IS NULL OR _school IS NULL THEN RETURN; END IF;

  _my_class := public.student_class_id(_uid);
  _role := public.chat_caller_role();

  IF _my_class IS NOT NULL THEN
    INSERT INTO public.chat_participants (conversation_id, user_id)
    SELECT c.id, _uid FROM public.chat_conversations c
     WHERE c.school_id = _school AND c.kind = 'class_group' AND c.class_id = _my_class
    ON CONFLICT DO NOTHING;
  END IF;

  IF _role IN ('teacher', 'principal', 'admin') THEN
    INSERT INTO public.chat_participants (conversation_id, user_id)
    SELECT c.id, _uid FROM public.chat_conversations c
     WHERE c.school_id = _school AND c.kind = 'teacher_group'
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN QUERY
  WITH my_convs AS (
    SELECT c.* FROM public.chat_conversations c
    JOIN public.chat_participants cp ON cp.conversation_id = c.id
    WHERE cp.user_id = _uid AND c.school_id = _school
  ),
  last_msg AS (
    SELECT DISTINCT ON (m.conversation_id) m.conversation_id,
      CASE WHEN m.deleted_at IS NOT NULL THEN 'Message deleted' ELSE m.content END AS content,
      m.created_at, m.sender_id
    FROM public.messages m
    WHERE m.conversation_id IN (SELECT id FROM my_convs) AND m.school_id = _school
    ORDER BY m.conversation_id, m.created_at DESC
  ),
  unread_counts AS (
    SELECT m.conversation_id, COUNT(*)::integer AS n
    FROM public.messages m
    JOIN public.chat_participants cp ON cp.conversation_id = m.conversation_id AND cp.user_id = _uid
    WHERE m.conversation_id IN (SELECT id FROM my_convs) AND m.school_id = _school
      AND m.sender_id <> _uid AND m.deleted_at IS NULL
      AND (cp.last_read_at IS NULL OR m.created_at > cp.last_read_at)
    GROUP BY m.conversation_id
  ),
  peers AS (
    SELECT cp.conversation_id, cp.user_id AS peer_id
    FROM public.chat_participants cp
    JOIN my_convs c ON c.id = cp.conversation_id AND c.kind = 'dm'
    WHERE cp.user_id <> _uid
  )
  SELECT c.id, c.kind,
    CASE WHEN c.kind = 'dm' THEN COALESCE(p.full_name, c.title) ELSE c.title END,
    c.class_id, peers.peer_id,
    public.membership_role_at(peers.peer_id, _school)::text,
    COALESCE(u.n, 0), lm.content, lm.created_at
  FROM my_convs c
  LEFT JOIN last_msg lm ON lm.conversation_id = c.id
  LEFT JOIN unread_counts u ON u.conversation_id = c.id
  LEFT JOIN peers ON peers.conversation_id = c.id
  LEFT JOIN public.profiles p ON p.id = peers.peer_id
  ORDER BY COALESCE(lm.created_at, c.updated_at) DESC NULLS LAST;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rpc_ensure_class_group(_class_id uuid)
RETURNS public.chat_conversations
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _school uuid := public.active_membership_school_id();
  _title text;
  _row public.chat_conversations;
BEGIN
  IF _uid IS NULL OR _school IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public.chat_can_create_class_group(_uid, _class_id) THEN
    RAISE EXCEPTION 'chat_forbidden: cannot create class group';
  END IF;

  SELECT COALESCE(c.name, 'Class')
         || CASE WHEN NULLIF(c.section, '') IS NOT NULL THEN ' ' || c.section ELSE '' END
    INTO _title
  FROM public.classes c WHERE c.id = _class_id AND c.school_id = _school;
  IF _title IS NULL THEN RAISE EXCEPTION 'class not found'; END IF;

  INSERT INTO public.chat_conversations (school_id, kind, class_id, title, created_by)
  VALUES (_school, 'class_group', _class_id, _title || ' Group', _uid)
  ON CONFLICT DO NOTHING RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    SELECT * INTO _row FROM public.chat_conversations
     WHERE school_id = _school AND kind = 'class_group' AND class_id = _class_id;
  END IF;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _row.id, s.user_id FROM public.students s
   WHERE s.class_id = _class_id AND s.user_id IS NOT NULL AND s.school_id = _school
  ON CONFLICT DO NOTHING;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _row.id, t.user_id FROM public.teachers t
  JOIN public.teacher_classes tc ON tc.teacher_id = t.id
   WHERE tc.class_id = _class_id AND t.user_id IS NOT NULL AND t.school_id = _school
  ON CONFLICT DO NOTHING;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _row.id, t.user_id FROM public.teachers t
   WHERE t.class_teacher_of = _class_id AND t.user_id IS NOT NULL AND t.school_id = _school
  ON CONFLICT DO NOTHING;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _row.id, m.account_id FROM public.memberships m
   WHERE m.school_id = _school AND m.status = 'active' AND m.role IN ('principal', 'admin')
  ON CONFLICT DO NOTHING;

  RETURN _row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rpc_ensure_teacher_group()
RETURNS public.chat_conversations
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _role text := public.chat_caller_role();
  _school uuid := public.active_membership_school_id();
  _row public.chat_conversations;
BEGIN
  IF _uid IS NULL OR _school IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _role IS NULL OR _role NOT IN ('teacher', 'principal', 'admin') THEN
    RAISE EXCEPTION 'chat_forbidden: cannot create teacher group';
  END IF;

  INSERT INTO public.chat_conversations (school_id, kind, title, created_by)
  VALUES (_school, 'teacher_group', 'Teacher Group', _uid)
  ON CONFLICT DO NOTHING RETURNING * INTO _row;

  IF _row.id IS NULL THEN
    SELECT * INTO _row FROM public.chat_conversations
     WHERE school_id = _school AND kind = 'teacher_group';
  END IF;

  INSERT INTO public.chat_participants (conversation_id, user_id)
  SELECT _row.id, m.account_id FROM public.memberships m
   WHERE m.school_id = _school AND m.status = 'active'
     AND m.role IN ('teacher', 'principal', 'admin')
  ON CONFLICT DO NOTHING;

  RETURN _row;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rpc_ensure_featured_battles_all()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _cid uuid; _daily uuid; _weekly uuid; _ncert uuid; _teacher uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := public.student_class_id(_uid);
  IF _cid IS NULL THEN
    RETURN jsonb_build_object('daily', null, 'weekly', null, 'ncert', null,
                              'teacher', null, 'ok', false, 'reason', 'no_class');
  END IF;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_refresh_featured_battles') THEN
      PERFORM public.rpc_refresh_featured_battles();
    ELSIF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_rotate_featured_battles') THEN
      PERFORM public.rpc_rotate_featured_battles();
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_seed_featured_battle_for_class') THEN
    BEGIN PERFORM public._seed_featured_battle_for_class(_cid, 'daily');  EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM public._seed_featured_battle_for_class(_cid, 'weekly'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM public._seed_featured_battle_for_class(_cid, 'ncert');  EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  SELECT id INTO _daily FROM public.battles
   WHERE source = 'featured_daily' AND class_id = _cid
     AND starts_at::date = current_date AND status IN ('live', 'scheduled')
   ORDER BY created_at LIMIT 1;

  SELECT id INTO _weekly FROM public.battles
   WHERE source = 'featured_weekly' AND class_id = _cid
     AND date_trunc('week', starts_at) = date_trunc('week', now())
     AND status IN ('live', 'scheduled')
   ORDER BY created_at LIMIT 1;

  SELECT id INTO _ncert FROM public.battles
   WHERE source = 'featured_ncert' AND class_id = _cid
     AND starts_at::date = current_date AND status IN ('live', 'scheduled')
   ORDER BY created_at LIMIT 1;

  _teacher := public._peek_teacher_featured_battle(_cid);

  RETURN jsonb_build_object('daily', _daily, 'weekly', _weekly, 'ncert', _ncert,
                            'teacher', _teacher, 'ok', true);
END;
$fn$;


-- ---------------------------------------------------------------------
-- SECTION 3 — the 12 functions that WROTE user_roles now write memberships
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_assign_role(_identifier text, _role public.app_role)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth'
AS $fn$
DECLARE _uid uuid; _id text; _school uuid := public.active_membership_school_id();
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can assign roles';
  END IF;
  IF _role IN ('principal'::public.app_role, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Principal and Admin roles are managed by the platform owner only';
  END IF;
  IF _school IS NULL THEN RAISE EXCEPTION 'No school context'; END IF;

  _id := trim(_identifier);
  IF _id IS NULL OR _id = '' THEN RAISE EXCEPTION 'Email or phone required'; END IF;

  IF position('@' IN _id) > 0 THEN
    SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
  ELSE
    SELECT id INTO _uid FROM auth.users
     WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = regexp_replace(_id, '\D', '', 'g')
     LIMIT 1;
  END IF;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No user found with %. Ask them to sign in once first.', _id;
  END IF;

  PERFORM public._grant_membership(_uid, _school, _role, NULL);
  RETURN _uid;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_remove_role(_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE _school uuid := public.active_membership_school_id();
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can remove roles';
  END IF;
  IF _role IN ('principal'::public.app_role, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Principal and Admin roles are managed by the platform owner only';
  END IF;
  IF _school IS NULL THEN RAISE EXCEPTION 'No school context'; END IF;
  IF public.membership_role_at(_user_id, _school) IS NULL THEN
    RAISE EXCEPTION 'Target user is outside your school';
  END IF;

  PERFORM public._revoke_membership(_user_id, _school, _role);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_set_unique_role(_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE _school uuid := public.active_membership_school_id();
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only school admins can assign roles';
  END IF;
  IF _role::text = 'super_admin' THEN
    RAISE EXCEPTION 'super_admin cannot be assigned from the school admin panel';
  END IF;
  IF _school IS NULL THEN RAISE EXCEPTION 'No school context'; END IF;

  -- "Unique role" now means: one active membership at THIS institution.
  -- Memberships at other institutions are none of this admin's business.
  UPDATE public.memberships
     SET status = 'revoked', responded_at = now()
   WHERE account_id = _user_id AND school_id = _school AND role <> _role AND status = 'active';

  PERFORM public._grant_membership(_user_id, _school, _role, NULL);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_connect_teacher_account(_teacher_id uuid, _identifier text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth'
AS $fn$
DECLARE _uid uuid; _id text; _teacher_school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can connect teacher accounts';
  END IF;
  SELECT school_id INTO _teacher_school FROM public.teachers WHERE id = _teacher_id;
  IF _teacher_school IS NULL OR NOT public.same_school(_teacher_school) THEN
    RAISE EXCEPTION 'Teacher is outside your school';
  END IF;

  _id := trim(_identifier);
  IF _id IS NULL OR _id = '' THEN RAISE EXCEPTION 'Email or phone required'; END IF;

  IF position('@' IN _id) > 0 THEN
    SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
  ELSE
    SELECT id INTO _uid FROM auth.users
      WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = regexp_replace(_id, '\D', '', 'g')
      LIMIT 1;
  END IF;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No account found for %. Ask the teacher to sign in with Google once first.', _id;
  END IF;

  UPDATE public.teachers SET user_id = _uid, status = 'active' WHERE id = _teacher_id;
  PERFORM public._grant_membership(_uid, _teacher_school, 'teacher'::public.app_role, _teacher_id);
  UPDATE public.profiles SET school_id = coalesce(school_id, _teacher_school) WHERE id = _uid;
  RETURN _uid;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_connect_student_account(
  _student_id uuid, _identifier text, _as text DEFAULT 'student'::text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth'
AS $fn$
DECLARE _uid uuid; _id text; _phone text; _student_school uuid; _parent_rec uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can connect student accounts';
  END IF;

  SELECT school_id INTO _student_school FROM public.students WHERE id = _student_id;
  IF _student_school IS NULL OR NOT public.same_school(_student_school) THEN
    RAISE EXCEPTION 'Student is outside your school';
  END IF;

  _id := trim(_identifier);
  IF _id IS NULL OR _id = '' THEN RAISE EXCEPTION 'Email or phone required'; END IF;

  IF lower(coalesce(_as, 'student')) = 'parent' THEN
    IF position('@' IN _id) > 0 THEN
      SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
      IF _uid IS NULL THEN
        UPDATE public.students SET parent_portal_email = lower(_id) WHERE id = _student_id;
        RETURN NULL;
      END IF;
      UPDATE public.students SET parent_user_id = _uid, parent_portal_email = lower(_id) WHERE id = _student_id;
    ELSE
      _phone := public.normalize_phone(_id);
      IF _phone IS NULL OR length(_phone) < 7 THEN RAISE EXCEPTION 'Invalid phone number'; END IF;
      SELECT id INTO _uid FROM auth.users WHERE public.normalize_phone(phone) = _phone LIMIT 1;
      IF _uid IS NULL THEN
        UPDATE public.students SET parent_mobile = _phone WHERE id = _student_id;
        RETURN NULL;
      END IF;
      UPDATE public.students SET parent_user_id = _uid, parent_mobile = _phone WHERE id = _student_id;
    END IF;

    SELECT id INTO _parent_rec FROM public.parents
     WHERE user_id = _uid AND school_id = _student_school LIMIT 1;

    PERFORM public._grant_membership(_uid, _student_school, 'parent'::public.app_role, _parent_rec);
    UPDATE public.profiles SET school_id = coalesce(school_id, _student_school) WHERE id = _uid;
    RETURN _uid;
  END IF;

  IF position('@' IN _id) > 0 THEN
    SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
    IF _uid IS NULL THEN
      UPDATE public.students SET portal_email = lower(_id), portal_phone = NULL WHERE id = _student_id;
      RETURN NULL;
    END IF;
    UPDATE public.students SET user_id = _uid, portal_email = lower(_id) WHERE id = _student_id;
  ELSE
    _phone := public.normalize_phone(_id);
    IF _phone IS NULL OR length(_phone) < 7 THEN RAISE EXCEPTION 'Invalid phone number'; END IF;
    SELECT id INTO _uid FROM auth.users WHERE public.normalize_phone(phone) = _phone LIMIT 1;
    IF _uid IS NULL THEN
      UPDATE public.students SET portal_phone = _phone, portal_email = NULL WHERE id = _student_id;
      RETURN NULL;
    END IF;
    UPDATE public.students SET user_id = _uid, portal_phone = _phone WHERE id = _student_id;
  END IF;

  PERFORM public._grant_membership(_uid, _student_school, 'student'::public.app_role, _student_id);
  UPDATE public.profiles SET school_id = coalesce(school_id, _student_school) WHERE id = _uid;
  RETURN _uid;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_revoke_student_account(_student_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE _uid uuid; _student_school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can revoke student accounts';
  END IF;
  SELECT user_id, school_id INTO _uid, _student_school FROM public.students WHERE id = _student_id;
  IF _student_school IS NULL OR NOT public.same_school(_student_school) THEN
    RAISE EXCEPTION 'Student is outside your school';
  END IF;
  UPDATE public.students SET user_id = NULL, portal_email = NULL, portal_phone = NULL WHERE id = _student_id;
  IF _uid IS NOT NULL THEN
    PERFORM public._revoke_membership(_uid, _student_school, 'student'::public.app_role);
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_revoke_teacher_account(_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE _uid uuid; _teacher_school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can revoke teacher accounts';
  END IF;
  SELECT user_id, school_id INTO _uid, _teacher_school FROM public.teachers WHERE id = _teacher_id;
  IF _teacher_school IS NULL OR NOT public.same_school(_teacher_school) THEN
    RAISE EXCEPTION 'Teacher is outside your school';
  END IF;
  UPDATE public.teachers SET user_id = NULL, status = 'inactive' WHERE id = _teacher_id;
  IF _uid IS NOT NULL THEN
    PERFORM public._revoke_membership(_uid, _teacher_school, 'teacher'::public.app_role);
  END IF;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.admin_set_teacher_access(_teacher_id uuid, _active boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE _uid uuid; _teacher_school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can change teacher access';
  END IF;
  SELECT school_id INTO _teacher_school FROM public.teachers WHERE id = _teacher_id;
  IF _teacher_school IS NULL OR NOT public.same_school(_teacher_school) THEN
    RAISE EXCEPTION 'Teacher is outside your school';
  END IF;
  UPDATE public.teachers SET status = CASE WHEN _active THEN 'active' ELSE 'inactive' END
    WHERE id = _teacher_id RETURNING user_id INTO _uid;
  IF _uid IS NOT NULL THEN
    IF _active THEN
      PERFORM public._grant_membership(_uid, _teacher_school, 'teacher'::public.app_role, _teacher_id);
    ELSE
      PERFORM public._revoke_membership(_uid, _teacher_school, 'teacher'::public.app_role);
    END IF;
  END IF;
END;
$fn$;

-- Self-claiming a role contradicts the invitation model: an admin invites, the
-- person accepts, and nothing is visible until they do (locked decision 2).
-- This now grants nothing and only reports what the caller actually holds.
CREATE OR REPLACE FUNCTION public.claim_signup_role(_role public.app_role)
RETURNS public.app_role
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _role NOT IN ('student'::public.app_role, 'parent'::public.app_role) THEN
    RAISE EXCEPTION 'Only student or parent roles can be claimed on signup';
  END IF;
  BEGIN PERFORM public.link_portal_on_auth(_uid); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN public.effective_role(_uid);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.get_auth_context()
RETURNS TABLE(user_id uuid, email text, full_name text, photo_url text, is_active boolean,
              role public.app_role, school_id uuid, school_name text, school_slug text,
              school_logo_url text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth'
AS $fn$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;

  PERFORM public.link_portal_on_auth(_uid);

  INSERT INTO public.profiles (id, full_name, email, school_id, is_active)
  SELECT _uid,
         coalesce((SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE auth.users.id = _uid), ''),
         (SELECT auth.users.email FROM auth.users WHERE auth.users.id = _uid),
         NULL,
         true
  ON CONFLICT (id) DO NOTHING;

  RETURN QUERY
  SELECT p.id, p.email, p.full_name, p.photo_url, p.is_active,
         public.effective_role(_uid),
         COALESCE(public.active_membership_school_id(), p.school_id),
         s.name, s.slug, s.logo_url
  FROM public.profiles p
  LEFT JOIN public.schools s
         ON s.id = COALESCE(public.active_membership_school_id(), p.school_id)
  WHERE p.id = _uid;
END;
$fn$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth', 'extensions'
AS $fn$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone, school_id, is_active)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.email, NEW.phone, NULL, true)
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
        full_name = CASE WHEN EXCLUDED.full_name <> '' THEN EXCLUDED.full_name
                         ELSE public.profiles.full_name END;

  PERFORM public.link_portal_on_auth(NEW.id);

  -- No role is granted here. A new account has no access until an admin
  -- invites it and the person accepts (locked decision 2).
  RETURN NEW;
END;
$fn$;

-- Portal linking. The admin setting students.portal_email / teachers.email IS
-- the invitation; matching that identifier at sign-in is the acceptance, so a
-- successful bind grants an ACTIVE membership carrying the local record.
CREATE OR REPLACE FUNCTION public.link_portal_on_auth(_uid uuid DEFAULT auth.uid())
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth'
AS $fn$
DECLARE
  _email text;
  _phone text;
  _profile_school uuid;
  _allow_global boolean;
  _teacher_id uuid;
  _student_id uuid;
  _parent_student_id uuid;
  _has_membership boolean;
  _match_count int;
  _sch uuid;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND _uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Cannot link portal for another user';
  END IF;

  SELECT lower(email), public.normalize_phone(phone) INTO _email, _phone
  FROM auth.users WHERE id = _uid;

  SELECT school_id INTO _profile_school FROM public.profiles WHERE id = _uid;
  _allow_global := (_profile_school IS NULL);

  SELECT EXISTS(SELECT 1 FROM public.memberships WHERE account_id = _uid AND status = 'active')
    INTO _has_membership;

  -- Teacher by email
  IF _email IS NOT NULL THEN
    _teacher_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _teacher_id FROM public.teachers
       WHERE lower(email) = _email AND user_id IS NULL AND school_id = _profile_school LIMIT 1;
    END IF;
    IF _teacher_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count FROM public.teachers
       WHERE lower(email) = _email AND user_id IS NULL;
      IF _match_count = 1 THEN
        SELECT id INTO _teacher_id FROM public.teachers
         WHERE lower(email) = _email AND user_id IS NULL LIMIT 1;
      END IF;
    END IF;
    IF _teacher_id IS NOT NULL THEN
      UPDATE public.teachers SET user_id = _uid WHERE id = _teacher_id;
      SELECT school_id INTO _sch FROM public.teachers WHERE id = _teacher_id;
      IF _sch IS NOT NULL THEN
        PERFORM public._grant_membership(_uid, _sch, 'teacher'::public.app_role, _teacher_id);
        _has_membership := true;
        UPDATE public.profiles SET school_id = _sch WHERE id = _uid AND school_id IS NULL;
        _profile_school := coalesce(_profile_school, _sch);
        _allow_global := (_profile_school IS NULL);
      END IF;
    END IF;
  END IF;

  -- Student by portal_email
  IF _email IS NOT NULL THEN
    _student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _student_id FROM public.students
       WHERE user_id IS NULL AND lower(portal_email) = _email AND school_id = _profile_school LIMIT 1;
    END IF;
    IF _student_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count FROM public.students
       WHERE user_id IS NULL AND lower(portal_email) = _email;
      IF _match_count = 1 THEN
        SELECT id INTO _student_id FROM public.students
         WHERE user_id IS NULL AND lower(portal_email) = _email LIMIT 1;
      END IF;
    END IF;
    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _uid WHERE id = _student_id;
      SELECT school_id INTO _sch FROM public.students WHERE id = _student_id;
      IF _sch IS NOT NULL THEN
        PERFORM public._grant_membership(_uid, _sch, 'student'::public.app_role, _student_id);
        _has_membership := true;
        UPDATE public.profiles SET school_id = _sch WHERE id = _uid AND school_id IS NULL;
        _profile_school := coalesce(_profile_school, _sch);
        _allow_global := (_profile_school IS NULL);
      END IF;
    END IF;
  END IF;

  -- Student by portal_phone
  IF _phone IS NOT NULL AND _student_id IS NULL THEN
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _student_id FROM public.students
       WHERE user_id IS NULL AND public.normalize_phone(portal_phone) = _phone
         AND school_id = _profile_school LIMIT 1;
    END IF;
    IF _student_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count FROM public.students
       WHERE user_id IS NULL AND public.normalize_phone(portal_phone) = _phone;
      IF _match_count = 1 THEN
        SELECT id INTO _student_id FROM public.students
         WHERE user_id IS NULL AND public.normalize_phone(portal_phone) = _phone LIMIT 1;
      END IF;
    END IF;
    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _uid WHERE id = _student_id;
      SELECT school_id INTO _sch FROM public.students WHERE id = _student_id;
      IF _sch IS NOT NULL THEN
        PERFORM public._grant_membership(_uid, _sch, 'student'::public.app_role, _student_id);
        _has_membership := true;
        UPDATE public.profiles SET school_id = _sch WHERE id = _uid AND school_id IS NULL;
        _profile_school := coalesce(_profile_school, _sch);
        _allow_global := (_profile_school IS NULL);
      END IF;
    END IF;
  END IF;

  -- Parent by parent_portal_email
  IF _email IS NOT NULL THEN
    _parent_student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _parent_student_id FROM public.students
       WHERE parent_user_id IS NULL AND lower(parent_portal_email) = _email
         AND school_id = _profile_school LIMIT 1;
    END IF;
    IF _parent_student_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count FROM public.students
       WHERE parent_user_id IS NULL AND lower(parent_portal_email) = _email;
      IF _match_count = 1 THEN
        SELECT id INTO _parent_student_id FROM public.students
         WHERE parent_user_id IS NULL AND lower(parent_portal_email) = _email LIMIT 1;
      END IF;
    END IF;
    IF _parent_student_id IS NOT NULL THEN
      UPDATE public.students SET parent_user_id = _uid WHERE id = _parent_student_id;
      SELECT school_id INTO _sch FROM public.students WHERE id = _parent_student_id;
      IF _sch IS NOT NULL THEN
        PERFORM public._grant_membership(_uid, _sch, 'parent'::public.app_role,
                 (SELECT id FROM public.parents WHERE user_id = _uid AND school_id = _sch LIMIT 1));
        _has_membership := true;
        UPDATE public.profiles SET school_id = _sch WHERE id = _uid AND school_id IS NULL;
        _profile_school := coalesce(_profile_school, _sch);
        _allow_global := (_profile_school IS NULL);
      END IF;
    END IF;
  END IF;

  -- Parent by parent_mobile
  IF _phone IS NOT NULL THEN
    _parent_student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _parent_student_id FROM public.students
       WHERE parent_user_id IS NULL AND public.normalize_phone(parent_mobile) = _phone
         AND school_id = _profile_school LIMIT 1;
    END IF;
    IF _parent_student_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count FROM public.students
       WHERE parent_user_id IS NULL AND public.normalize_phone(parent_mobile) = _phone;
      IF _match_count = 1 THEN
        SELECT id INTO _parent_student_id FROM public.students
         WHERE parent_user_id IS NULL AND public.normalize_phone(parent_mobile) = _phone LIMIT 1;
      END IF;
    END IF;
    IF _parent_student_id IS NOT NULL THEN
      UPDATE public.students SET parent_user_id = _uid WHERE id = _parent_student_id;
      SELECT school_id INTO _sch FROM public.students WHERE id = _parent_student_id;
      IF _sch IS NOT NULL THEN
        PERFORM public._grant_membership(_uid, _sch, 'parent'::public.app_role,
                 (SELECT id FROM public.parents WHERE user_id = _uid AND school_id = _sch LIMIT 1));
        UPDATE public.profiles SET school_id = _sch WHERE id = _uid AND school_id IS NULL;
      END IF;
    END IF;
  END IF;
END;
$fn$;


-- ---------------------------------------------------------------------
-- SECTION 4 — user_roles becomes read-only, structurally
--
-- Requirement 3 is "no new writes from any path". Proving that by reading code
-- is exactly the kind of assurance that decays. This makes it a property of
-- the table: any INSERT, UPDATE or DELETE raises, so a forgotten path fails
-- loudly instead of quietly rebuilding the second source of truth.
--
-- The rows already there are left untouched — the client still reads them
-- until it is moved over, and they are the audit trail of what the old model
-- believed.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_user_roles_read_only()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  RAISE EXCEPTION
    'public.user_roles is read-only since Chunk 1.5. Roles live on public.memberships — use _grant_membership()/_revoke_membership() or the admin_* RPCs.';
END;
$fn$;

DROP TRIGGER IF EXISTS trg_user_roles_read_only ON public.user_roles;
CREATE TRIGGER trg_user_roles_read_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION public.tg_user_roles_read_only();


-- ---------------------------------------------------------------------
-- SECTION 5 — assertions
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int; _d text;
BEGIN
  -- Nothing in the schema may still read user_roles for authorization.
  SELECT count(*), string_agg(t.proname, ', ') INTO _n, _d
    FROM (SELECT DISTINCT p.proname
            FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
           WHERE n.nspname = 'public' AND p.prokind = 'f'
             AND pg_get_functiondef(p.oid) ILIKE '%user_roles%'
             AND p.proname NOT IN ('tg_user_roles_read_only')) t;
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 1.5: % function(s) still reference user_roles: %', _n, _d;
  END IF;

  -- And no policy may either.
  SELECT count(*), string_agg(tablename || '.' || policyname, ', ') INTO _n, _d
    FROM pg_policies
   WHERE schemaname = 'public'
     AND tablename <> 'user_roles'
     AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ILIKE '%user_roles%';
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 1.5: % policy/policies still reference user_roles: %', _n, _d;
  END IF;

  -- The read-only guard must exist.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.user_roles'::regclass
      AND tgname = 'trg_user_roles_read_only' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'Chunk 1.5: user_roles read-only guard missing';
  END IF;
END $$;
