-- ============================================================================
-- Student context / Practice class mapping SSOT
-- ============================================================================
-- Root causes addressed:
--   1. profiles.school_id can stick on signup default while students.school_id is the
--      real tenant → same_school(classes.school_id) fails → class join null → Practice
--      "Couldn't determine your class".
--   2. get_my_role() LIMIT 1 without priority can disagree with Auth pickRole.
--   3. Students must always be able to read their own class row for curriculum scope.
-- ============================================================================

-- ── 1. School id: prefer portal school (students / teachers) over stale profile ─
CREATE OR REPLACE FUNCTION public.get_my_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT s.school_id
       FROM public.students s
      WHERE s.user_id = auth.uid()
        AND s.school_id IS NOT NULL
      LIMIT 1),
    (SELECT t.school_id
       FROM public.teachers t
      WHERE t.user_id = auth.uid()
        AND t.school_id IS NOT NULL
      LIMIT 1),
    (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid())
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_my_school_id() TO authenticated;

COMMENT ON FUNCTION public.get_my_school_id() IS
  'Authenticated tenant school_id. Prefers students/teachers.school_id over profiles so Practice class RLS matches the portal row.';

-- ── 2. Role: same priority as client Auth (session.ts ROLE_PRIORITY) ───────────
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.role
  FROM public.user_roles r
  WHERE r.user_id = auth.uid()
  ORDER BY CASE r.role::text
    WHEN 'super_admin' THEN 1
    WHEN 'admin' THEN 2
    WHEN 'principal' THEN 3
    WHEN 'teacher' THEN 4
    WHEN 'student' THEN 5
    WHEN 'parent' THEN 6
    ELSE 99
  END
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

-- ── 3. Backfill mismatched profile school from linked student / teacher ──────
UPDATE public.profiles p
SET school_id = s.school_id
FROM public.students s
WHERE s.user_id = p.id
  AND s.school_id IS NOT NULL
  AND p.school_id IS DISTINCT FROM s.school_id;

UPDATE public.profiles p
SET school_id = t.school_id
FROM public.teachers t
WHERE t.user_id = p.id
  AND t.school_id IS NOT NULL
  AND p.school_id IS DISTINCT FROM t.school_id
  AND NOT EXISTS (
    SELECT 1 FROM public.students s WHERE s.user_id = p.id AND s.school_id IS NOT NULL
  );

-- ── 4. Classes SELECT: always allow own class (and taught / child class) ──────
DROP POLICY IF EXISTS classes_school_read ON public.classes;
CREATE POLICY classes_school_read ON public.classes
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    OR school_id IS NULL
    OR id = public.student_class_id(auth.uid())
    OR public.teacher_teaches_class(auth.uid(), id)
    OR EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.class_id = classes.id
        AND s.parent_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.parent_students ps
      JOIN public.students s ON s.id = ps.student_id
      JOIN public.parents pr ON pr.id = ps.parent_id
      WHERE s.class_id = classes.id
        AND pr.user_id = auth.uid()
    )
  );

-- ── 5. Identity RPC — single source for Home + Practice + resolveStudentContext ─
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
STABLE
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

  -- Align portal link + default role with Auth bootstrap path
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

  -- Portal-scoped role: users who are both teachers/admins and students must
  -- retain explicit student access in the student portal despite global priority.
  _role := CASE
    WHEN EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = _uid)
     AND EXISTS (
       SELECT 1
       FROM public.user_roles ur
       WHERE ur.user_id = _uid AND ur.role = 'student'::public.app_role
     )
    THEN 'student'::public.app_role
    ELSE public.get_my_role()
  END;
  _has_student_role := EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _uid AND ur.role = 'student'::public.app_role
  );

  -- Prefer student school; keep profile in sync when linked
  UPDATE public.profiles p
  SET school_id = s.school_id
  FROM public.students s
  WHERE p.id = _uid
    AND s.user_id = _uid
    AND s.school_id IS NOT NULL
    AND p.school_id IS DISTINCT FROM s.school_id;

  -- When a linked students row + student role grant exist, expose role=student
  -- for the student portal even if global priority prefers teacher/admin.
  IF _has_student_role AND EXISTS (
    SELECT 1 FROM public.students s WHERE s.user_id = _uid
  ) THEN
    _role := 'student'::public.app_role;
  END IF;

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

GRANT EXECUTE ON FUNCTION public.rpc_get_my_student_identity() TO authenticated;

COMMENT ON FUNCTION public.rpc_get_my_student_identity() IS
  'SSOT student academic identity for client: role, student_id, school_id, class metadata. Bypasses classes RLS for own row via SECURITY DEFINER.';
