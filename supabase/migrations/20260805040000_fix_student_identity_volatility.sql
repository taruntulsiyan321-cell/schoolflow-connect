-- Identity infrastructure bug (NOT a Practice bug) -- opened and fixed as
-- its own change, per explicit instruction to treat this separately.
--
-- rpc_get_my_student_identity() has returned HTTP 400 on every call,
-- confirmed live via network capture during Practice E2E work. Root cause,
-- found by reading the function, not by guessing: it is declared STABLE
-- (line 548 of 20260802640000_auth_rls_session_auditor_closures.sql, and
-- STABLE since its original creation in
-- 20260802570000_student_context_class_identity.sql -- this predates
-- everything touched this session and is not a regression from any of it),
-- but its body performs a real UPDATE:
--
--   UPDATE public.profiles p SET school_id = s.school_id ...
--
-- and calls two functions that themselves write (link_portal_on_auth,
-- ensure_default_role). PostgreSQL does not allow data-modifying
-- statements inside a function marked STABLE or IMMUTABLE -- only VOLATILE
-- functions may have side effects. Executing this function raises a
-- Postgres error, which PostgREST surfaces to the client as HTTP 400.
--
-- Impact: every caller of this RPC gets a 400 and falls back to a slower,
-- multi-query identity-resolution path (see resolveStudentContext.ts).
-- Identity is foundational -- Practice, Homework, Recovery, Dashboard, and
-- Battleground all consume it through the same shared path, so this is not
-- Practice-scoped; it's shared infrastructure.
--
-- Fix: drop the incorrect STABLE annotation. VOLATILE is PL/pgSQL's
-- default when no volatility category is specified, matching what this
-- function actually does. Nothing else changes -- signature, body, and
-- every other clause reproduced verbatim from the live version.

CREATE OR REPLACE FUNCTION public.rpc_get_my_student_identity()
RETURNS TABLE (
  user_id uuid,
  role public.app_role,
  has_student_role boolean,
  student_id uuid,
  school_id uuid,
  class_id uuid,
  class_name text,
  class_section text,
  class_display_name text,
  class_category text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role public.app_role;
  _has_student_role boolean := false;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    PERFORM public.link_portal_on_auth(_uid);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    PERFORM public.ensure_default_role();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  _has_student_role := EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _uid AND ur.role = 'student'::public.app_role
  );
  _role := CASE
    WHEN _has_student_role
     AND EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = _uid)
    THEN 'student'::public.app_role
    ELSE public.get_my_role()
  END;

  UPDATE public.profiles p
  SET school_id = s.school_id
  FROM public.students s
  WHERE p.id = _uid
    AND s.user_id = _uid
    AND s.school_id IS NOT NULL
    AND p.school_id IS DISTINCT FROM s.school_id;

  RETURN QUERY
  SELECT
    _uid,
    _role,
    _has_student_role,
    s.id,
    COALESCE(s.school_id, public.get_my_school_id()),
    s.class_id,
    c.name,
    c.section,
    c.display_name,
    c.category
  FROM (SELECT _uid AS uid) AS u
  LEFT JOIN public.students s ON s.user_id = u.uid
  LEFT JOIN public.classes c ON c.id = s.class_id;
END;
$$;
