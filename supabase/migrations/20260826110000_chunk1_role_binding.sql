-- =====================================================================
-- CHUNK 1 (correction) — BIND IDENTITY TO THE ACTIVE ROLE, NOT THE ACCOUNT
--
-- Chunk 1 verification item 5 failed:
--
--   "The same human as teacher and parent at one school has two memberships
--    and two distinct local_person_id values, and switching changes what is
--    visible."
--
-- The two memberships and two distinct local records were correct. Switching
-- did NOT change visibility: active as a parent, she still saw all 12 of her
-- students, because teacher_teaches_class() resolves through
-- `teachers.user_id = auth.uid()` — the ACCOUNT — and an account that is a
-- teacher is a teacher no matter which membership is active.
--
-- The earlier fences bound identity to the active INSTITUTION. Locked decision
-- 2 requires both: "the database only ever sees one institution AND one role."
--
-- The fix is what memberships.local_person_id exists for. A session is not
-- acting as "whoever this account is"; it is acting as exactly one local
-- record — the active membership's local_person_id. Every person-path
-- predicate now resolves through that.
--
-- Verified live before writing: all 48 policy call sites of the four identity
-- helpers pass auth.uid(), so binding the auth.uid() branch is sufficient; the
-- other branch is kept, institution-fenced, for callers asking about a
-- different person.
--
-- Reverse: supabase/migrations/rollback/20260826110000_chunk1_role_binding_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — which local record is this session acting as?
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.active_local_person_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT m.local_person_id
    FROM public.memberships m
   WHERE m.id = public.active_membership_id()
     AND m.status = 'active'
$$;

GRANT EXECUTE ON FUNCTION public.active_local_person_id() TO authenticated;


-- ---------------------------------------------------------------------
-- SECTION 2 — the four identity helpers resolve through the active membership
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
   WHERE public.same_school(s.school_id)
     AND CASE
           WHEN _user_id = auth.uid()
             THEN s.id = public.active_local_person_id()
                  AND public.active_membership_role() = 'student'
           ELSE s.user_id = _user_id
         END
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
     WHERE tc.class_id = _class_id
       AND public.same_school(t.school_id)
       AND CASE
             WHEN _user_id = auth.uid()
               THEN t.id = public.active_local_person_id()
                    AND public.active_membership_role() = 'teacher'
             ELSE t.user_id = _user_id
           END
  ) OR EXISTS (
    SELECT 1 FROM public.teachers t
     WHERE t.class_teacher_of = _class_id
       AND public.same_school(t.school_id)
       AND CASE
             WHEN _user_id = auth.uid()
               THEN t.id = public.active_local_person_id()
                    AND public.active_membership_role() = 'teacher'
             ELSE t.user_id = _user_id
           END
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
     WHERE t.class_teacher_of = _class_id
       AND public.same_school(t.school_id)
       AND CASE
             WHEN _uid = auth.uid()
               THEN t.id = public.active_local_person_id()
                    AND public.active_membership_role() = 'teacher'
             ELSE t.user_id = _uid
           END
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
     WHERE tc.class_id = _class_id
       AND public.same_school(t.school_id)
       AND CASE
             WHEN _user_id = auth.uid()
               THEN t.id = public.active_local_person_id()
                    AND public.active_membership_role() = 'teacher'
             ELSE t.user_id = _user_id
           END
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
-- SECTION 3 — the local-record tables resolve through the active membership
--
-- Each keeps its original user_id = auth.uid() term as defence in depth and
-- adds the two that make it role-bound: the record must BE the one this
-- session is acting as, and the active role must match.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "students self read" ON public.students;
CREATE POLICY "students self read" ON public.students
  FOR SELECT
  USING (
    public.same_school(school_id)
    AND user_id = auth.uid()
    AND id = public.active_local_person_id()
    AND public.active_membership_role() = 'student'
  );

DROP POLICY IF EXISTS "students parent read" ON public.students;
CREATE POLICY "students parent read" ON public.students
  FOR SELECT
  USING (
    public.same_school(school_id)
    AND public.active_membership_role() = 'parent'
    AND (
      parent_user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.parent_students ps
         WHERE ps.student_id = students.id
           AND ps.parent_id = public.active_local_person_id()
      )
    )
  );

DROP POLICY IF EXISTS "teachers self read" ON public.teachers;
CREATE POLICY "teachers self read" ON public.teachers
  FOR SELECT
  USING (
    public.same_school(school_id)
    AND user_id = auth.uid()
    AND id = public.active_local_person_id()
    AND public.active_membership_role() = 'teacher'
  );

DROP POLICY IF EXISTS "teachers school staff read" ON public.teachers;
CREATE POLICY "teachers school staff read" ON public.teachers
  FOR SELECT
  USING (
    public.same_school(school_id)
    AND (
      (user_id = auth.uid()
        AND id = public.active_local_person_id()
        AND public.active_membership_role() = 'teacher')
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );

DROP POLICY IF EXISTS parents_school_select ON public.parents;
CREATE POLICY parents_school_select ON public.parents
  FOR SELECT
  USING (
    public.same_school(school_id)
    AND (
      (user_id = auth.uid()
        AND id = public.active_local_person_id()
        AND public.active_membership_role() = 'parent')
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  );

DROP POLICY IF EXISTS parents_self_update ON public.parents;
CREATE POLICY parents_self_update ON public.parents
  FOR UPDATE
  USING (
    public.same_school(school_id)
    AND user_id = auth.uid()
    AND id = public.active_local_person_id()
    AND public.active_membership_role() = 'parent'
  );

DROP POLICY IF EXISTS parent_students_select ON public.parent_students;
CREATE POLICY parent_students_select ON public.parent_students
  FOR SELECT
  USING (
    public.same_school(school_id)
    AND (
      (public.active_membership_role() = 'parent'
        AND parent_id = public.active_local_person_id())
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  );


-- ---------------------------------------------------------------------
-- SECTION 4 — this only works if every person-holding membership names its
-- local record. A student membership with a NULL local_person_id would now
-- lock that student out of their own row, so refuse to commit if any exists.
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int; _d text;
BEGIN
  SELECT count(*), string_agg(m.id::text || ' (' || m.role || ')', ', ')
    INTO _n, _d
    FROM public.memberships m
   WHERE m.status = 'active'
     AND m.role IN ('student', 'teacher', 'parent')
     AND m.local_person_id IS NULL;
  IF _n > 0 THEN
    RAISE EXCEPTION 'role binding: % active membership(s) have no local_person_id and would lose access: %', _n, _d;
  END IF;

  -- And every one of them must point at a record that really exists in that
  -- institution, or the same lockout happens by a different route.
  SELECT count(*) INTO _n
    FROM public.memberships m
   WHERE m.status = 'active' AND m.local_person_id IS NOT NULL
     AND NOT (
       (m.role = 'student' AND EXISTS (SELECT 1 FROM public.students x
                                        WHERE x.id = m.local_person_id AND x.school_id = m.school_id))
    OR (m.role = 'teacher' AND EXISTS (SELECT 1 FROM public.teachers x
                                        WHERE x.id = m.local_person_id AND x.school_id = m.school_id))
    OR (m.role = 'parent'  AND EXISTS (SELECT 1 FROM public.parents x
                                        WHERE x.id = m.local_person_id AND x.school_id = m.school_id))
     );
  IF _n > 0 THEN
    RAISE EXCEPTION 'role binding: % membership(s) point at a local record that does not exist in their institution', _n;
  END IF;
END $$;
