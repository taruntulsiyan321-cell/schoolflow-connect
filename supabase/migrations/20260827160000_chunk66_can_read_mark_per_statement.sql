-- =====================================================================
-- CHUNK 6.6 — restructure can_read_mark so resolution happens once per
--              statement instead of once per row
--
-- MEASURED BEFORE THIS MIGRATION, at 2,546 marks (the scale fixture):
--
--   admin      20,277 ms    7.97 ms/candidate
--   principal  21,031 ms    8.26 ms/candidate
--   teacher    18,458 ms    7.25 ms/candidate
--   student    35,852 ms   14.08 ms/candidate
--   parent     50,105 ms   19.68 ms/candidate
--
-- Against an 8 s statement timeout. The build doc predicted the parent
-- would be the casualty; it is the worst, but EVERY role is already past
-- the timeout at one real school's volume. The marks surface is not
-- degraded at scale, it is entirely down — for admins and teachers too.
-- The 26-row demo showed 0.5 s and hid all five.
--
-- ROOT CAUSE, exactly as the doc states it: can_read_mark(_exam_id,
-- _student_id) takes two per-row arguments, so Postgres cannot cache it
-- and re-invokes the whole body — an EXISTS over exams, same_school(),
-- the role lookup and the role's own arm — once per candidate row.
-- Candidates are every mark in the school, not the five a parent can see.
--
-- THE FIX: uncorrelated set-returning helpers, used as
-- `col IN (SELECT public.helper())`. Because the subquery references no
-- outer column, Postgres evaluates it ONCE as a hashed InitPlan and every
-- row is then a hash probe. This is the mechanism that actually gives
-- once-per-statement; a scalar helper is re-invoked per row however cheap
-- its body looks, and an array-returning helper is re-evaluated per row
-- inside `= ANY(...)` for the same reason.
--
-- WHAT IS DELIBERATELY NOT CHANGED: who can read what. Each arm below
-- reproduces the previous predicate exactly, including the two places
-- where the old shape was looser than it needed to be (a student and a
-- parent were gated on the STUDENT being theirs, not on the exam being
-- their class's). Tightening those here would be a behaviour change
-- smuggled in under a performance fix, which is how the exam_group_id
-- regression happened. Noted, not taken.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SECTION 1 — the classes a teacher teaches, resolved once
--
-- Set-shaped equivalent of teacher_teaches_class(auth.uid(), c), whose
-- two EXISTS arms (teacher_classes, and teachers.class_teacher_of) are
-- preserved as a UNION.
--
-- GUARANTEES THIS SECURITY DEFINER RE-STATES (G12): it bypasses RLS on
-- teacher_classes and teachers, so it asserts for itself —
--   * active role      : must be 'teacher'
--   * active local person: the teacher row must BE the caller's
--   * institution      : the teacher row must be in the active school
-- Dropping any one of them would let a teacher who changed schools keep
-- reading the old one, which is the precise hole G12 names.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_teacher_class_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT tc.class_id
    FROM public.teacher_classes tc
    JOIN public.teachers t ON t.id = tc.teacher_id
   WHERE public.active_membership_role() = 'teacher'
     AND t.id = public.active_local_person_id()
     AND t.school_id = public.active_membership_school_id()
     AND tc.class_id IS NOT NULL
  UNION
  SELECT t.class_teacher_of
    FROM public.teachers t
   WHERE public.active_membership_role() = 'teacher'
     AND t.id = public.active_local_person_id()
     AND t.school_id = public.active_membership_school_id()
     AND t.class_teacher_of IS NOT NULL
$$;

COMMENT ON FUNCTION public.my_teacher_class_ids() IS
  'Chunk 6.6. Set-shaped equivalent of teacher_teaches_class for the CALLER. Takes no argument so an uncorrelated IN (SELECT ...) resolves it once per statement. Re-states active role, active local person and institution, all of which it bypasses as SECURITY DEFINER.';

-- ---------------------------------------------------------------------
-- SECTION 2 — the exams whose marks the caller may read
--
-- One arm per role, dispatched on active_membership_role() (G12: check
-- the role before evaluating any arm). The whole function runs once, so
-- the dispatch costs nothing per row.
--
-- Super admin is absent from this function ON PURPOSE, not by oversight.
-- A super admin acting in a granted institution has no membership row, so
-- active_membership_role() is NULL and every arm below is false. They are
-- carried by their own explicit arm in the policy (Section 4), which is
-- where their access has always lived and where it stays auditable.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_readable_exam_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT e.id
    FROM public.exams e
   WHERE e.school_id = public.active_membership_school_id()
     AND CASE public.active_membership_role()
           -- Operators see every exam in their own institution.
           WHEN 'admin'     THEN true
           WHEN 'principal' THEN true
           -- A teacher sees the exams of the classes they teach. No
           -- publication filter: uploading marks means reading them
           -- before they are published.
           WHEN 'teacher'   THEN e.class_id IN (SELECT public.my_teacher_class_ids())
           -- Student and guardian only once results are published. The
           -- previous predicate scoped these by STUDENT rather than by
           -- class, and that is reproduced exactly here: the narrowing to
           -- "their own" happens in my_readable_mark_student_ids().
           WHEN 'student'   THEN e.results_published_at IS NOT NULL
           WHEN 'parent'    THEN e.results_published_at IS NOT NULL
           ELSE false
         END
$$;

COMMENT ON FUNCTION public.my_readable_exam_ids() IS
  'Chunk 6.6. Exams whose marks the caller may read, resolved once per statement via an uncorrelated IN (SELECT ...). Institution is asserted directly; super admins are deliberately excluded here and carried by their own arm on the marks_read policy.';

-- ---------------------------------------------------------------------
-- SECTION 3 — the students whose marks the caller may read
--
-- Operators and teachers had no student-level restriction, so their arm
-- enumerates the institution's students rather than inventing a NULL
-- "means everyone" sentinel. A sentinel that means "skip the check" is
-- one edit away from meaning it in a case nobody intended; enumerating a
-- few hundred ids into a hash costs nothing and cannot be misread.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_readable_mark_student_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.id
    FROM public.students s
   WHERE s.school_id = public.active_membership_school_id()
     AND CASE public.active_membership_role()
           WHEN 'admin'     THEN true
           WHEN 'principal' THEN true
           WHEN 'teacher'   THEN true
           -- The student themselves, resolved through the active
           -- membership's local person — never through a passed-in id.
           WHEN 'student'   THEN s.id = public.active_local_person_id()
           -- Both guardian linkages, same as my_children_student_ids.
           WHEN 'parent'    THEN s.parent_user_id = auth.uid()
                                 OR EXISTS (
                                      SELECT 1 FROM public.parent_students ps
                                       WHERE ps.student_id = s.id
                                         AND ps.parent_id = public.active_local_person_id()
                                    )
           ELSE false
         END
$$;

COMMENT ON FUNCTION public.my_readable_mark_student_ids() IS
  'Chunk 6.6. Students whose marks the caller may read, resolved once per statement. Operators and teachers enumerate the institution rather than using a NULL-means-everyone sentinel. Re-states institution, active role and active local person.';

-- ---------------------------------------------------------------------
-- SECTION 4 — the policy
--
-- Both IN (SELECT ...) subqueries are uncorrelated, so each becomes a
-- one-time hashed InitPlan and each row costs two hash probes.
--
-- The super-admin arm is unchanged from Chunk 6.5 and is ordered so
-- is_super_admin() short-circuits first: for the overwhelming majority of
-- callers it is false immediately, and same_school(school_id) — the only
-- per-row call left in the policy — is never reached.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS marks_read ON public.marks;
CREATE POLICY marks_read ON public.marks
  FOR SELECT
  USING (
    (
      exam_id    IN (SELECT public.my_readable_exam_ids())
      AND student_id IN (SELECT public.my_readable_mark_student_ids())
    )
    OR (
      public.is_super_admin()
      AND public.super_admin_has_any_access()
      AND public.same_school(school_id)
    )
  );

-- ---------------------------------------------------------------------
-- SECTION 5 — can_read_mark is kept, and rewritten to agree
--
-- It is no longer on the read path, but it is a public function that
-- other code may call, and leaving two definitions of "may this person
-- read this mark" that could drift apart is G9's exact failure. It is
-- redefined in terms of the same two sets, so there is one answer.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_read_mark(_exam_id uuid, _student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _exam_id    IN (SELECT public.my_readable_exam_ids())
     AND _student_id IN (SELECT public.my_readable_mark_student_ids())
$$;

COMMENT ON FUNCTION public.can_read_mark(uuid, uuid) IS
  'Chunk 6.6. No longer used by the marks_read policy — a per-row function is what made a parent read cost 50 s at 2,546 marks. Kept and redefined over the same sets so a caller cannot get a different answer from the policy. Does NOT include the super-admin arm, which lives on the policy.';


-- ---------------------------------------------------------------------
-- SECTION 6 — the schools the caller may reach, resolved once
--
-- MEASURE, THEN MEASURE AGAIN (G12). Sections 1-5 did land: the plan
-- confirms both reads are now `hashed SubPlan`s costing 40 ms and 336 ms
-- ONCE, not per row. Parent went 50.1 s -> 11.2 s. And 11.2 s is still a
-- 500. The fix was real and insufficient, which is exactly the case G12
-- says never to assume away.
--
-- The plan named what remained:
--
--   Seq Scan on marks (actual time=388..8046 rows=5)
--     Filter: ((school_id IS NULL) OR same_school(school_id)) AND (...)
--     Rows Removed by Filter: 2541
--
-- That is the RESTRICTIVE tenant fence, and being RESTRICTIVE it is
-- evaluated for every candidate row before anything else. Measured:
--
--   same_school()           2.73 ms per call
--     get_my_school_id()    2.35 ms of it
--     super_admin_has_access() 0.07 ms
--
-- 2,546 rows x 2.73 ms = 6.95 s, which is the entire remainder.
--
-- WHY THE FUNCTION CANNOT JUST BE MADE CHEAP: tried and disproved rather
-- than assumed. same_school() was rewritten as a non-SECURITY-DEFINER,
-- no-SET wrapper — the two properties that block SQL inlining — hoping
-- the planner would inline it and turn the body into one hashed SubPlan
-- for all 104 tenant-fenced tables at once. It did not: Postgres refuses
-- to inline a SQL function whose body contains a subquery, the filter
-- still read `same_school(school_id)`, and the per-call sublink made it
-- WORSE (8.0 s -> 16.2 s). Run inside a transaction that rolled itself
-- back, so production never saw it.
--
-- What does work is the same mechanism as Sections 1-3, but written in
-- the POLICY rather than behind a function call, where the planner can
-- see it is uncorrelated.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_accessible_school_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  -- Exactly the two arms of same_school(), as a set:
  --   _school_id = get_my_school_id()  OR  super_admin_has_access(_school_id)
  SELECT public.get_my_school_id()
   WHERE public.get_my_school_id() IS NOT NULL
  UNION
  SELECT l.school_id
    FROM public.super_admin_access_log l
    JOIN public.super_admins sa ON sa.id = l.super_admin_id
   WHERE sa.account_id = auth.uid()
     AND sa.revoked_at IS NULL
     AND l.expires_at > now()
     AND l.school_id IS NOT NULL
$$;

COMMENT ON FUNCTION public.my_accessible_school_ids() IS
  'Chunk 6.6. The set form of same_school(): the caller''s own institution plus any a super admin currently holds live access to. Used as an uncorrelated IN (SELECT ...) inside tenant fences so the resolution costs once per statement instead of 2.73 ms per candidate row.';

-- ---------------------------------------------------------------------
-- SECTION 7 — the tenant fences on this chunk's tables
--
-- Identical predicate, expressed so the planner can hoist it. Nothing
-- about who may reach what changes: `x IN (SELECT get_my_school_id()
-- UNION granted)` is the same statement as `x = get_my_school_id() OR
-- super_admin_has_access(x)`, including for NULL x, where both are false.
--
-- Still RESTRICTIVE, still on {anon, authenticated}, still ALL, still
-- covering both USING and WITH CHECK. A fence that got quietly narrower
-- while being made faster is the failure this chunk exists to avoid.
--
-- SCOPE, STATED PLAINLY: the same predicate is used by 234 policies over
-- 104 tables. Only this chunk's six are rewritten here. The rest carry
-- the identical per-row cost and are REPORTED with measurements rather
-- than swept into a performance migration — rewriting every tenant fence
-- in the database is a change to the isolation boundary itself and is a
-- decision to be taken deliberately, not inherited from a chunk about
-- marks.
-- ---------------------------------------------------------------------
DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['marks','exams','exam_subjects','tests','test_marks','report_cards'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', _t || '_tenant_fence', _t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        AS RESTRICTIVE
        FOR ALL
        TO anon, authenticated
        USING      (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()))
        WITH CHECK (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()))
    $f$, _t || '_tenant_fence', _t);
  END LOOP;
END $$;


-- =====================================================================
-- SECTIONS 8-13 — the rest of Chunk 6's surface, same defect
--
-- The scale fixture existed to stop the gate measuring 26 rows. Once it
-- did, it showed that marks was not the only broken table — it was the
-- only one anybody had measured. At 2,546 marks / 1,260 test marks:
--
--   test_marks   parent    TIMED OUT past 180 s
--   test_marks   student   TIMED OUT past 180 s
--   test_marks   teacher   98,685 ms
--   report_cards parent     6,049 ms
--   tests        student    7,304 ms
--
-- Every one is the same shape as can_read_mark: a scalar SECURITY DEFINER
-- resolver taking a per-row argument, re-invoked once per candidate row.
--
-- TWO THINGS MAKE THIS WORSE THAN IT LOOKS, both found by reading the
-- policies rather than assuming:
--
-- 1. tests_write, test_marks_write, exam_subjects_write and
--    report_cards_write are FOR ALL. A permissive FOR ALL policy is
--    evaluated on SELECT as well, so every read was paying BOTH its read
--    resolver and its write resolver, per row.
--
-- 2. The obvious fix for a write policy is NOT safe. Rewriting
--    can_manage_test(id) as id IN (SELECT ...) would risk INSERT: the
--    subquery becomes a one-time InitPlan, and a row being inserted is not
--    guaranteed visible to it, where the per-row function does see it. So
--    the write predicates below stay exactly as they are — per-row is
--    correct there, and a handful of rows is not a cost.
--
-- The change is therefore: split FOR ALL into the three write commands so
-- reads stop paying for them, and OR the write predicate into the read
-- policy so nobody who could read through the FOR ALL arm loses it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SECTION 8 — naming, before two similar sets can drift (G9)
--
-- my_readable_exam_ids() answers "whose MARKS may I read" and filters
-- student and parent to published results. exams_read answers a different
-- question, "which exams may I SEE", and deliberately does NOT filter on
-- publication, because the subject-wise timetable is visible to students
-- before any result exists. Two different sets, one of which was about to
-- be reused for the other. Renamed so they cannot be confused.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_exam_ids_for_marks()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT e.id
    FROM public.exams e
   WHERE e.school_id = public.active_membership_school_id()
     AND CASE public.active_membership_role()
           WHEN 'admin'     THEN true
           WHEN 'principal' THEN true
           WHEN 'teacher'   THEN e.class_id IN (SELECT public.my_teacher_class_ids())
           WHEN 'student'   THEN e.results_published_at IS NOT NULL
           WHEN 'parent'    THEN e.results_published_at IS NOT NULL
           ELSE false
         END
$$;

DROP POLICY IF EXISTS marks_read ON public.marks;
CREATE POLICY marks_read ON public.marks
  FOR SELECT
  USING (
    (
      exam_id        IN (SELECT public.my_exam_ids_for_marks())
      AND student_id IN (SELECT public.my_readable_mark_student_ids())
    )
    OR (
      (SELECT public.is_super_admin())
      AND (SELECT public.super_admin_has_any_access())
      AND school_id IN (SELECT public.my_accessible_school_ids())
    )
  );

CREATE OR REPLACE FUNCTION public.can_read_mark(_exam_id uuid, _student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT _exam_id        IN (SELECT public.my_exam_ids_for_marks())
     AND _student_id     IN (SELECT public.my_readable_mark_student_ids())
$$;

DROP FUNCTION IF EXISTS public.my_readable_exam_ids();

-- ---------------------------------------------------------------------
-- SECTION 9 — the set forms of the remaining resolvers
--
-- Each reproduces its scalar original exactly. They may call the old
-- per-row helpers freely INSIDE, because the whole function now runs once
-- per statement — the cost was never these helpers, it was invoking them
-- 2,546 times.
-- ---------------------------------------------------------------------

-- "Which exams may I see" — the exams_read CASE, unchanged, including the
-- deliberate absence of a publication filter for student and parent.
CREATE OR REPLACE FUNCTION public.my_visible_exam_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT e.id
    FROM public.exams e
   WHERE e.school_id = public.active_membership_school_id()
     AND CASE public.active_membership_role()
           WHEN 'admin'     THEN true
           WHEN 'principal' THEN true
           WHEN 'teacher'   THEN e.class_id IN (SELECT public.my_teacher_class_ids())
           WHEN 'student'   THEN e.class_id = public.student_class_id(auth.uid())
           WHEN 'parent'    THEN e.class_id = ANY (public.my_children_class_ids())
           ELSE false
         END
$$;

-- can_manage_exam(), as a set.
CREATE OR REPLACE FUNCTION public.my_manageable_exam_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT e.id
    FROM public.exams e
   WHERE e.school_id IN (SELECT public.my_accessible_school_ids())
     AND (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR public.is_class_teacher_of_class(auth.uid(), e.class_id)
     )
$$;

-- can_read_test(), as a set.
CREATE OR REPLACE FUNCTION public.my_readable_test_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT t.id
    FROM public.tests t
    JOIN public.section_subjects ss ON ss.id = t.section_subject_id
   WHERE t.school_id IN (SELECT public.my_accessible_school_ids())
     AND (
       public.is_principal_or_admin(auth.uid())
       OR public.teacher_teaches_class(auth.uid(), ss.section_id)
       OR ss.section_id = public.student_class_id(auth.uid())
       OR public.is_class_of_my_child(ss.section_id)
     )
$$;

-- can_manage_test(), as a set.
CREATE OR REPLACE FUNCTION public.my_manageable_test_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT t.id
    FROM public.tests t
    JOIN public.section_subjects ss ON ss.id = t.section_subject_id
   WHERE t.school_id IN (SELECT public.my_accessible_school_ids())
     AND (
       public.has_role(auth.uid(), 'admin'::public.app_role)
       OR t.created_by = auth.uid()
       OR public.teacher_teaches_class(auth.uid(), ss.section_id)
     )
$$;

-- is_my_student_record(x) OR is_my_child(x), as one set.
CREATE OR REPLACE FUNCTION public.my_own_or_children_student_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT s.id
    FROM public.students s
   WHERE s.school_id = public.active_membership_school_id()
     AND CASE public.active_membership_role()
           WHEN 'student' THEN s.id = public.active_local_person_id()
           WHEN 'parent'  THEN s.parent_user_id = auth.uid()
                               OR EXISTS (
                                    SELECT 1 FROM public.parent_students ps
                                     WHERE ps.student_id = s.id
                                       AND ps.parent_id = public.active_local_person_id()
                                  )
           ELSE false
         END
$$;

-- is_class_teacher_of_student(auth.uid(), x), as a set.
-- DELIBERATE TIGHTENING, stated rather than slipped in: the scalar
-- original carries no institution predicate at all. It is harmless today
-- because every table using it also has a RESTRICTIVE tenant fence, but
-- "harmless because something else catches it" is how a hole opens the
-- day that something else moves. The institution filter is added here. It
-- cannot narrow real access: a class teacher is always in the same
-- institution as the student whose class they hold.
CREATE OR REPLACE FUNCTION public.my_class_teacher_student_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT s.id
    FROM public.students s
    JOIN public.teachers t ON t.class_teacher_of = s.class_id
   WHERE t.user_id = auth.uid()
     AND t.school_id IN (SELECT public.my_accessible_school_ids())
$$;

-- ---------------------------------------------------------------------
-- SECTION 10 — exams
--
-- Same five arms, same super-admin arm. Every no-argument call is wrapped
-- in (SELECT ...) so the planner hoists it to a one-time InitPlan instead
-- of calling it per row; every per-row lookup becomes set membership.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS exams_read ON public.exams;
CREATE POLICY exams_read ON public.exams
  FOR SELECT
  USING (
    school_id IN (SELECT public.my_accessible_school_ids())
    AND (
      id IN (SELECT public.my_visible_exam_ids())
      OR ((SELECT public.is_super_admin()) AND (SELECT public.super_admin_has_any_access()))
    )
  );

-- ---------------------------------------------------------------------
-- SECTION 11 — exam_subjects
--
-- The read arm was already just same_school(), so it needs only the set
-- form. The write policy was FOR ALL and is split; because the read arm
-- is "anyone in the institution" and manage is a strict subset of that,
-- splitting removes no read access.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS exam_subjects_read  ON public.exam_subjects;
DROP POLICY IF EXISTS exam_subjects_write ON public.exam_subjects;

CREATE POLICY exam_subjects_read ON public.exam_subjects
  FOR SELECT
  USING (school_id IN (SELECT public.my_accessible_school_ids()));

CREATE POLICY exam_subjects_insert ON public.exam_subjects
  FOR INSERT WITH CHECK (public.can_manage_exam(exam_id));
CREATE POLICY exam_subjects_update ON public.exam_subjects
  FOR UPDATE USING (public.can_manage_exam(exam_id))
         WITH CHECK (public.can_manage_exam(exam_id));
CREATE POLICY exam_subjects_delete ON public.exam_subjects
  FOR DELETE USING (public.can_manage_exam(exam_id));

-- ---------------------------------------------------------------------
-- SECTION 12 — tests and test_marks
--
-- The read policies gain the manage arm that the FOR ALL write policy
-- used to provide on SELECT. That arm is not redundant: can_manage_test
-- includes created_by = auth.uid(), so a teacher who created a test and
-- has since stopped teaching that section could read it before and would
-- silently lose it otherwise.
--
-- tests_hide_soft_deleted keeps its meaning exactly; has_role() is merely
-- wrapped so it resolves once instead of per row.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS tests_read  ON public.tests;
DROP POLICY IF EXISTS tests_write ON public.tests;

CREATE POLICY tests_read ON public.tests
  FOR SELECT
  USING (
    id IN (SELECT public.my_readable_test_ids())
    OR id IN (SELECT public.my_manageable_test_ids())
  );

CREATE POLICY tests_insert ON public.tests
  FOR INSERT WITH CHECK (public.can_manage_test(id));
CREATE POLICY tests_update ON public.tests
  FOR UPDATE USING (public.can_manage_test(id))
         WITH CHECK (public.can_manage_test(id));
CREATE POLICY tests_delete ON public.tests
  FOR DELETE USING (public.can_manage_test(id));

DROP POLICY IF EXISTS tests_hide_soft_deleted ON public.tests;
CREATE POLICY tests_hide_soft_deleted ON public.tests
  AS RESTRICTIVE
  FOR ALL
  USING (deleted_at IS NULL OR (SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

DROP POLICY IF EXISTS test_marks_read  ON public.test_marks;
DROP POLICY IF EXISTS test_marks_write ON public.test_marks;

CREATE POLICY test_marks_read ON public.test_marks
  FOR SELECT
  USING (
    test_id IN (SELECT public.my_readable_test_ids())
    OR test_id IN (SELECT public.my_manageable_test_ids())
    OR student_id IN (SELECT public.my_own_or_children_student_ids())
  );

CREATE POLICY test_marks_insert ON public.test_marks
  FOR INSERT WITH CHECK (public.can_manage_test(test_id));
CREATE POLICY test_marks_update ON public.test_marks
  FOR UPDATE USING (public.can_manage_test(test_id))
         WITH CHECK (public.can_manage_test(test_id));
CREATE POLICY test_marks_delete ON public.test_marks
  FOR DELETE USING (public.can_manage_test(test_id));

-- ---------------------------------------------------------------------
-- SECTION 13 — report_cards
--
-- Four scalar resolvers become three set memberships plus one hoisted
-- role check, and the manage arm the FOR ALL policy used to contribute on
-- SELECT is preserved explicitly.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS report_cards_read  ON public.report_cards;
DROP POLICY IF EXISTS report_cards_write ON public.report_cards;

CREATE POLICY report_cards_read ON public.report_cards
  FOR SELECT
  USING (
    student_id IN (SELECT public.my_own_or_children_student_ids())
    OR student_id IN (SELECT public.my_class_teacher_student_ids())
    OR exam_id IN (SELECT public.my_manageable_exam_ids())
    OR (SELECT public.is_principal_or_admin(auth.uid()))
  );

CREATE POLICY report_cards_insert ON public.report_cards
  FOR INSERT WITH CHECK (public.can_manage_exam(exam_id));
CREATE POLICY report_cards_update ON public.report_cards
  FOR UPDATE USING (public.can_manage_exam(exam_id))
         WITH CHECK (public.can_manage_exam(exam_id));
CREATE POLICY report_cards_delete ON public.report_cards
  FOR DELETE USING (public.can_manage_exam(exam_id));


-- =====================================================================
-- SECTION 14 — measure, then measure again, then a third time
--
-- Sections 8-13 moved most of the surface a long way: report_cards
-- 6,049 -> 323 ms, exam_subjects 860 -> 18 ms, test_marks as student from
-- TIMED OUT to 1,884 ms. And tests/test_marks as teacher and parent were
-- still 23 s and 41 s.
--
-- Profiled rather than guessed at:
--
--   my_readable_test_ids()            40,127 ms   <- the whole cost
--   my_manageable_test_ids()              51 ms
--   my_own_or_children_student_ids()     256 ms
--   is_class_of_my_child()               126 ms per call
--
-- The mistake was one level down from the one Sections 1-3 fixed. Making
-- the helper set-returning stopped the POLICY calling it per candidate
-- row — but inside the helper, the OR chain still called four scalar
-- resolvers once per row of ITS OWN driving table. 36 tests x four
-- expensive calls is 40 seconds. The function ran once; it was just
-- expensive once.
--
-- (Note also is_class_of_my_child at 126 ms, against 17 ms measured in
-- Chunk 6. It scans students, and students went from 13 rows to 223. The
-- per-row helpers were never cheap — the demo was small.)
--
-- The fix is the same trick applied inside: an expression containing no
-- column reference, wrapped in (SELECT ...), becomes a one-time InitPlan
-- rather than a per-row call. Every no-argument fact each helper needs is
-- hoisted; every per-row lookup becomes set membership against a set that
-- is itself resolved once.
--
-- Nothing below changes which rows any role can reach. Each body is the
-- same predicate with its constant parts lifted out.
-- =====================================================================

-- get_my_school_id() was being called TWICE per invocation here, once for
-- the value and once for the null guard.
CREATE OR REPLACE FUNCTION public.my_accessible_school_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT x.sid FROM (SELECT public.get_my_school_id() AS sid) x WHERE x.sid IS NOT NULL
  UNION
  SELECT l.school_id
    FROM public.super_admin_access_log l
    JOIN public.super_admins sa ON sa.id = l.super_admin_id
   WHERE sa.account_id = auth.uid()
     AND sa.revoked_at IS NULL
     AND l.expires_at > now()
     AND l.school_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.my_teacher_class_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT tc.class_id
    FROM public.teacher_classes tc
    JOIN public.teachers t ON t.id = tc.teacher_id
   WHERE (SELECT public.active_membership_role()) = 'teacher'
     AND t.id = (SELECT public.active_local_person_id())
     AND t.school_id = (SELECT public.active_membership_school_id())
     AND tc.class_id IS NOT NULL
  UNION
  SELECT t.class_teacher_of
    FROM public.teachers t
   WHERE (SELECT public.active_membership_role()) = 'teacher'
     AND t.id = (SELECT public.active_local_person_id())
     AND t.school_id = (SELECT public.active_membership_school_id())
     AND t.class_teacher_of IS NOT NULL
$$;

-- The classes a teacher is CLASS TEACHER of, which is a strict subset of
-- the above and is what can_manage_exam turns on.
CREATE OR REPLACE FUNCTION public.my_class_teacher_class_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT t.class_teacher_of
    FROM public.teachers t
   WHERE t.user_id = auth.uid()
     AND t.class_teacher_of IS NOT NULL
     AND t.school_id IN (SELECT public.my_accessible_school_ids())
$$;

CREATE OR REPLACE FUNCTION public.my_exam_ids_for_marks()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT e.id
    FROM public.exams e
   WHERE e.school_id = (SELECT public.active_membership_school_id())
     AND CASE (SELECT public.active_membership_role())
           WHEN 'admin'     THEN true
           WHEN 'principal' THEN true
           WHEN 'teacher'   THEN e.class_id IN (SELECT public.my_teacher_class_ids())
           WHEN 'student'   THEN e.results_published_at IS NOT NULL
           WHEN 'parent'    THEN e.results_published_at IS NOT NULL
           ELSE false
         END
$$;

CREATE OR REPLACE FUNCTION public.my_visible_exam_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT e.id
    FROM public.exams e
   WHERE e.school_id = (SELECT public.active_membership_school_id())
     AND CASE (SELECT public.active_membership_role())
           WHEN 'admin'     THEN true
           WHEN 'principal' THEN true
           WHEN 'teacher'   THEN e.class_id IN (SELECT public.my_teacher_class_ids())
           WHEN 'student'   THEN e.class_id = (SELECT public.student_class_id(auth.uid()))
           WHEN 'parent'    THEN e.class_id IN (SELECT unnest(public.my_children_class_ids()))
           ELSE false
         END
$$;

CREATE OR REPLACE FUNCTION public.my_manageable_exam_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT e.id
    FROM public.exams e
   WHERE e.school_id IN (SELECT public.my_accessible_school_ids())
     AND (
       (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
       OR e.class_id IN (SELECT public.my_class_teacher_class_ids())
     )
$$;

CREATE OR REPLACE FUNCTION public.my_readable_test_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT t.id
    FROM public.tests t
    JOIN public.section_subjects ss ON ss.id = t.section_subject_id
   WHERE t.school_id IN (SELECT public.my_accessible_school_ids())
     AND (
       (SELECT public.is_principal_or_admin(auth.uid()))
       OR ss.section_id IN (SELECT public.my_teacher_class_ids())
       OR ss.section_id = (SELECT public.student_class_id(auth.uid()))
       OR ss.section_id IN (SELECT unnest(public.my_children_class_ids()))
     )
$$;

CREATE OR REPLACE FUNCTION public.my_manageable_test_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT t.id
    FROM public.tests t
    JOIN public.section_subjects ss ON ss.id = t.section_subject_id
   WHERE t.school_id IN (SELECT public.my_accessible_school_ids())
     AND (
       (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
       OR t.created_by = auth.uid()
       OR ss.section_id IN (SELECT public.my_teacher_class_ids())
     )
$$;

CREATE OR REPLACE FUNCTION public.my_readable_mark_student_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT s.id
    FROM public.students s
   WHERE s.school_id = (SELECT public.active_membership_school_id())
     AND CASE (SELECT public.active_membership_role())
           WHEN 'admin'     THEN true
           WHEN 'principal' THEN true
           WHEN 'teacher'   THEN true
           WHEN 'student'   THEN s.id = (SELECT public.active_local_person_id())
           WHEN 'parent'    THEN s.parent_user_id = auth.uid()
                                 OR s.id IN (
                                      SELECT ps.student_id FROM public.parent_students ps
                                       WHERE ps.parent_id = (SELECT public.active_local_person_id())
                                    )
           ELSE false
         END
$$;

CREATE OR REPLACE FUNCTION public.my_own_or_children_student_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT s.id
    FROM public.students s
   WHERE s.school_id = (SELECT public.active_membership_school_id())
     AND CASE (SELECT public.active_membership_role())
           WHEN 'student' THEN s.id = (SELECT public.active_local_person_id())
           WHEN 'parent'  THEN s.parent_user_id = auth.uid()
                               OR s.id IN (
                                    SELECT ps.student_id FROM public.parent_students ps
                                     WHERE ps.parent_id = (SELECT public.active_local_person_id())
                                  )
           ELSE false
         END
$$;

CREATE OR REPLACE FUNCTION public.my_class_teacher_student_ids()
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT s.id
    FROM public.students s
   WHERE s.class_id IN (SELECT public.my_class_teacher_class_ids())
$$;


-- =====================================================================
-- SECTION 15 — the fourth measurement, and the last hiding place
--
-- After Section 14 the outer scans were clean: EXPLAIN on marks shows six
-- hashed SubPlans at loops=1 and 0.0004 ms per row. But tests as a parent
-- was still 929 ms, and the plan showed 928.7 ms of that is SubPlan setup
-- with 0.0102 ms per row. The per-row cost had not been removed, it had
-- MOVED INSIDE the InitPlan — which is precisely the outcome G12 warns
-- about, one level further in than the last time.
--
-- Profiled again rather than reasoned about:
--
--   my_readable_test_ids()        896.9 ms
--     student_class_id()          816.6 ms   <- ONE call
--   my_manageable_test_ids()       16.2 ms
--   my_accessible_school_ids()      5.8 ms
--   my_teacher_class_ids()          4.7 ms
--   my_children_class_ids()        13.7 ms
--
-- student_class_id() filters students with same_school(s.school_id) — a
-- per-row SECURITY DEFINER call at 2.73 ms — before it applies the cheap
-- identity test. 223 students x 2.73 ms is the 816 ms. It was 13 students
-- when this was written.
--
-- Two changes, neither of which alters the answer:
--   * the institution test becomes set membership, resolved once;
--   * the role test moves FIRST, so a caller who is not a student stops
--     immediately instead of scanning the roster to discover it.
--
-- This helper is used well beyond this chunk, so the improvement is not
-- confined to tests — but nothing about who resolves to which class
-- changes. Same rows, same NULL for a non-student.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.student_class_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.class_id
    FROM public.students s
   WHERE CASE
           WHEN _user_id = auth.uid()
             THEN (SELECT public.active_membership_role()) = 'student'
                  AND s.id = (SELECT public.active_local_person_id())
           ELSE s.user_id = _user_id
         END
     AND s.school_id IN (SELECT public.my_accessible_school_ids())
   LIMIT 1
$$;

-- is_principal_or_admin() calls has_role() twice; both are argument-free
-- once auth.uid() is resolved, so both hoist.
CREATE OR REPLACE FUNCTION public.is_principal_or_admin(_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT (SELECT public.has_role(_uid, 'admin'::public.app_role))
      OR (SELECT public.has_role(_uid, 'principal'::public.app_role))
$$;

-- Ledger. Recorded under the full filename, matching every other row —
-- an earlier apply wrote a bare timestamp that also collided with
-- 20260827130000_session_start_idempotent from the same day.
DELETE FROM public.schema_migrations WHERE version = '20260827130000';
INSERT INTO public.schema_migrations (version)
VALUES ('20260827160000_chunk66_can_read_mark_per_statement')
ON CONFLICT DO NOTHING;


-- =====================================================================
-- SECTION 16 — students and student_academic_profiles
--
-- NOT scope creep, and not chosen from the list of 96 tables that share
-- this defect. The live smoke gate failed on the admin panel:
--
--   HTTP 500  /rest/v1/students?select=id&school_id=eq...
--   HTTP 500  /rest/v1/student_academic_profiles?...limit=5000
--             {"code":"57014","message":"canceling statement due to
--              statement timeout"}
--
-- The scale fixture put 210 students in the school — one ordinary school
-- — and that is enough to take the admin dashboard past the 8 s timeout.
-- The volume is mine, so the break is mine to fix; shipping a chunk that
-- leaves the admin panel returning 500 is not an option, and deleting the
-- fixture to make the gate quiet is the opposite of what the fixture is
-- for.
--
-- Every policy on both tables used the same per-row shape: same_school(),
-- has_role(), active_membership_role(), teacher_teaches_class(), and
-- EXISTS subqueries against students — the last of which nests RLS on a
-- protected table, exactly what G12 forbids.
--
-- G9 note: students and student_academic_profiles granted to the SAME set
-- of people, written out twice, in two different orders, with two
-- different spellings of the parent linkage. One helper now answers it
-- once. That removes a second place for the rule to drift, which is worth
-- more here than the speed.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.my_visible_student_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.id
    FROM public.students s
   WHERE s.school_id IN (SELECT public.my_accessible_school_ids())
     AND (
       -- Operators: the whole institution.
       (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
       OR (SELECT public.has_role(auth.uid(), 'principal'::public.app_role))
       -- The student themselves, resolved through the active membership.
       OR (
            (SELECT public.active_membership_role()) = 'student'
            AND s.user_id = auth.uid()
            AND s.id = (SELECT public.active_local_person_id())
          )
       -- Guardians, both linkages, exactly as students parent read had it.
       OR (
            (SELECT public.active_membership_role()) = 'parent'
            AND (
              s.parent_user_id = auth.uid()
              OR s.id IN (
                   SELECT ps.student_id FROM public.parent_students ps
                    WHERE ps.parent_id = (SELECT public.active_local_person_id())
                 )
            )
          )
       -- Teachers, for the classes they teach.
       OR s.class_id IN (SELECT public.my_teacher_class_ids())
     )
$$;

COMMENT ON FUNCTION public.my_visible_student_ids() IS
  'Chunk 6.6. The one answer to "which students may this caller see", used by both students and student_academic_profiles, which previously spelled the same rule out separately. Resolved once per statement via an uncorrelated IN (SELECT ...).';

-- ---------------------------------------------------------------------
-- students
--
-- The three SELECT policies collapse into one set membership. Their union
-- is reproduced exactly by the helper above, with one deliberate
-- tightening: "students teacher read" carried NO institution predicate of
-- its own, relying on teacher_teaches_class and the tenant fence. The
-- helper states it. A teacher is never in a different institution from
-- the class they teach, so no real access narrows.
--
-- "students school staff read" is DROPPED rather than rewritten: its
-- predicate is character-for-character the SELECT half of "students admin
-- and principal all", which is FOR ALL and therefore already covers
-- SELECT. A duplicate permissive policy is pure cost (G12).
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "students school staff read" ON public.students;
DROP POLICY IF EXISTS "students parent read"       ON public.students;
DROP POLICY IF EXISTS "students self read"         ON public.students;
DROP POLICY IF EXISTS "students teacher read"      ON public.students;

CREATE POLICY students_read ON public.students
  FOR SELECT
  USING (id IN (SELECT public.my_visible_student_ids()));

DROP POLICY IF EXISTS "students admin and principal all" ON public.students;
CREATE POLICY "students admin and principal all" ON public.students
  FOR ALL
  USING (
    school_id IN (SELECT public.my_accessible_school_ids())
    AND ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
      OR (SELECT public.has_role(auth.uid(), 'principal'::public.app_role)))
  )
  WITH CHECK (
    school_id IN (SELECT public.my_accessible_school_ids())
    AND ((SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
      OR (SELECT public.has_role(auth.uid(), 'principal'::public.app_role)))
  );

-- The RESTRICTIVE policies keep their meaning exactly; only the
-- argument-free calls are hoisted so they resolve once.
DROP POLICY IF EXISTS students_tenant_fence ON public.students;
CREATE POLICY students_tenant_fence ON public.students
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()));

DROP POLICY IF EXISTS students_hide_soft_deleted ON public.students;
CREATE POLICY students_hide_soft_deleted ON public.students
  AS RESTRICTIVE FOR ALL
  USING (deleted_at IS NULL OR (SELECT public.has_role(auth.uid(), 'admin'::public.app_role)));

DROP POLICY IF EXISTS students_exit_hides_from_guardian ON public.students;
CREATE POLICY students_exit_hides_from_guardian ON public.students
  AS RESTRICTIVE FOR ALL
  USING (
    exit_date IS NULL
    OR exit_date > CURRENT_DATE
    OR NOT (SELECT public.has_role(auth.uid(), 'parent'::public.app_role))
  );

-- ---------------------------------------------------------------------
-- student_academic_profiles
--
-- sap_school_select held four EXISTS subqueries against students. Each
-- one made this policy pay students' ENTIRE policy stack per candidate
-- row — the nested-RLS pattern G12 exists to stop. They resolve to the
-- same set as the helper above, so they become one membership test.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS sap_school_select ON public.student_academic_profiles;
CREATE POLICY sap_school_select ON public.student_academic_profiles
  FOR SELECT
  USING (
    school_id IN (SELECT public.my_accessible_school_ids())
    AND student_id IN (SELECT public.my_visible_student_ids())
  );

DROP POLICY IF EXISTS student_academic_profiles_tenant_fence ON public.student_academic_profiles;
CREATE POLICY student_academic_profiles_tenant_fence ON public.student_academic_profiles
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()));
