-- =====================================================================
-- CHUNK 1 (continued) — THE MEMBERSHIP FENCE
--
-- Chunk 1's isolation Proof 2 failed. The tenancy predicate itself was
-- correct — same_school() and has_role() both resolve through the active
-- membership — but a survey of all 120 school-scoped tables against a
-- student, a teacher and a parent found 80 leaking table/person pairs.
--
-- Root cause, and it is a single one: policies identify a person by
--   auth.uid() -> local record
-- and NEVER check which institution that local record belongs to. So a
-- person's records at institution A stay readable while their session is
-- active at institution B. That contradicts locked decision 2 ("the database
-- only ever sees one institution and one role").
--
-- Two mechanisms carry the whole leak, so two fixes close it:
--
--   1. Four SECURITY DEFINER identity helpers. Being SECURITY DEFINER they
--      bypass RLS entirely, so they must fence themselves. Between them they
--      are named by 53+ policies.
--
--   2. The person-path policies on the four local-record tables — students,
--      teachers, parents, parent_students. Every other table's policies reach
--      a person by an inline `EXISTS (SELECT 1 FROM students s WHERE
--      s.user_id = auth.uid() ...)`, and RLS DOES apply to a table referenced
--      inside another table's policy expression. Fencing these four therefore
--      fences every inline person-path in the schema at once, without editing
--      the ~119 policies that contain one.
--
-- Not exploitable before this migration: one institution exists and every
-- account holds exactly one membership. This closes the hole before the
-- second institution makes it reachable.
--
-- same_school() is used rather than a bare school_id comparison so that the
-- super-admin logged-access bypass built in the previous migration keeps
-- working through these paths too.
--
-- Reverse: supabase/migrations/rollback/20260825130000_chunk1_fence_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — the four identity helpers fence themselves
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.student_class_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.class_id
    FROM public.students s
   WHERE s.user_id = _user_id
     AND public.same_school(s.school_id)
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.teacher_teaches_class(_user_id uuid, _class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.teacher_classes tc
      JOIN public.teachers t ON t.id = tc.teacher_id
     WHERE t.user_id = _user_id
       AND tc.class_id = _class_id
       AND public.same_school(t.school_id)
  ) OR EXISTS (
    SELECT 1 FROM public.teachers t
     WHERE t.user_id = _user_id
       AND t.class_teacher_of = _class_id
       AND public.same_school(t.school_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.is_class_teacher_of_class(_uid uuid, _class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.teachers t
     WHERE t.user_id = _uid
       AND t.class_teacher_of = _class_id
       AND public.same_school(t.school_id)
  )
$$;

CREATE OR REPLACE FUNCTION public.teacher_teaches_class_subject(
  _user_id uuid, _class_id uuid, _subject text DEFAULT NULL::text, _subject_id uuid DEFAULT NULL::uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.teacher_classes tc
      JOIN public.teachers t ON t.id = tc.teacher_id
     WHERE t.user_id = _user_id
       AND tc.class_id = _class_id
       AND public.same_school(t.school_id)
       AND (
         (_subject_id IS NOT NULL AND tc.subject_id IS NOT NULL AND tc.subject_id = _subject_id)
         OR (
           _subject IS NOT NULL
           AND NULLIF(trim(_subject), '') IS NOT NULL
           AND lower(trim(COALESCE(tc.subject, ''))) = lower(trim(_subject))
         )
         OR (
           _subject_id IS NOT NULL
           AND tc.subject_id IS NULL
           AND NULLIF(trim(COALESCE(tc.subject, '')), '') IS NOT NULL
           AND EXISTS (
             SELECT 1 FROM public.subjects s
              WHERE s.id = _subject_id
                AND lower(trim(s.name)) = lower(trim(tc.subject))
           )
         )
       )
  );
$$;


-- ---------------------------------------------------------------------
-- SECTION 2 — the four local-record tables fence their person paths
--
-- Each policy below is the original predicate with same_school() ANDed over
-- the whole thing. Nothing else about them changes: the same people see the
-- same rows, within their active institution only.
-- ---------------------------------------------------------------------

-- students -------------------------------------------------------------
DROP POLICY IF EXISTS "students self read" ON public.students;
CREATE POLICY "students self read" ON public.students
  FOR SELECT
  USING (user_id = auth.uid() AND public.same_school(school_id));

DROP POLICY IF EXISTS "students parent read" ON public.students;
CREATE POLICY "students parent read" ON public.students
  FOR SELECT
  USING (
    public.same_school(school_id)
    AND (
      parent_user_id = auth.uid()
      OR EXISTS (
        SELECT 1
          FROM public.parent_students ps
          JOIN public.parents p ON p.id = ps.parent_id
         WHERE ps.student_id = students.id
           AND p.user_id = auth.uid()
      )
    )
  );

-- teachers -------------------------------------------------------------
DROP POLICY IF EXISTS "teachers self read" ON public.teachers;
CREATE POLICY "teachers self read" ON public.teachers
  FOR SELECT
  USING (user_id = auth.uid() AND public.same_school(school_id));

DROP POLICY IF EXISTS "teachers school staff read" ON public.teachers;
CREATE POLICY "teachers school staff read" ON public.teachers
  FOR SELECT
  USING (
    public.same_school(school_id)
    AND (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );

-- parents --------------------------------------------------------------
DROP POLICY IF EXISTS parents_school_select ON public.parents;
CREATE POLICY parents_school_select ON public.parents
  FOR SELECT
  USING (
    public.same_school(school_id)
    AND (
      user_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  );

DROP POLICY IF EXISTS parents_self_update ON public.parents;
CREATE POLICY parents_self_update ON public.parents
  FOR UPDATE
  USING (user_id = auth.uid() AND public.same_school(school_id));

-- parent_students ------------------------------------------------------
DROP POLICY IF EXISTS parent_students_select ON public.parent_students;
CREATE POLICY parent_students_select ON public.parent_students
  FOR SELECT
  USING (
    public.same_school(school_id)
    AND (
      EXISTS (
        SELECT 1 FROM public.parents p
         WHERE p.id = parent_students.parent_id
           AND p.user_id = auth.uid()
      )
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  );


-- ---------------------------------------------------------------------
-- SECTION 3 — prove this took nobody's current access away
--
-- Every local record that belongs to a logged-in person must sit in the same
-- institution as that person's active membership. If that ever failed, the
-- fence above would lock a real user out of their own data, so refuse to
-- commit rather than find out in production.
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int; _d text;
BEGIN
  SELECT count(*), string_agg(t.who, '; ') INTO _n, _d FROM (
    SELECT 'student ' || s.id || ' school ' || s.school_id
             || ' vs membership school ' || m.school_id AS who
      FROM public.students s
      JOIN public.memberships m
        ON m.account_id = s.user_id AND m.status = 'active' AND m.role = 'student'
     WHERE s.user_id IS NOT NULL AND s.school_id IS DISTINCT FROM m.school_id
    UNION ALL
    SELECT 'teacher ' || te.id || ' school ' || te.school_id
             || ' vs membership school ' || m.school_id
      FROM public.teachers te
      JOIN public.memberships m
        ON m.account_id = te.user_id AND m.status = 'active' AND m.role = 'teacher'
     WHERE te.user_id IS NOT NULL AND te.school_id IS DISTINCT FROM m.school_id
    UNION ALL
    SELECT 'parent ' || pa.id || ' school ' || pa.school_id
             || ' vs membership school ' || m.school_id
      FROM public.parents pa
      JOIN public.memberships m
        ON m.account_id = pa.user_id AND m.status = 'active' AND m.role = 'parent'
     WHERE pa.user_id IS NOT NULL AND pa.school_id IS DISTINCT FROM m.school_id
  ) t;

  IF _n > 0 THEN
    RAISE EXCEPTION 'Membership fence: % local record(s) sit outside their own account''s active institution and would be fenced off: %', _n, _d;
  END IF;
END $$;
