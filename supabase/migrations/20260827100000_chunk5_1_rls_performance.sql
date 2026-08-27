-- =====================================================================
-- CHUNK 5.1 — RLS PERFORMANCE: STOP POLICIES PAYING ANOTHER TABLE'S RLS
--
-- Found by the G8 live-smoke gate, which is the only reason anyone saw it:
-- the parent panel returns HTTP 500 on /rest/v1/homework_submissions with
-- SQLSTATE 57014, "canceling statement due to statement timeout".
--
-- Measured as the parent, against 10 visible rows:
--     full scan of homework_submissions ....  7,747 ms
--     the query the app actually makes ..... 33,260 ms
--     authenticated statement_timeout ......      8 s   <- killed here
--
-- Root cause, and it is one pattern repeated: a policy that reaches another
-- RLS-protected table pays THAT table's whole policy stack, per row. These
-- policies say
--     EXISTS (SELECT 1 FROM students s WHERE s.id = <t>.student_id AND ...)
-- and `students` is itself protected, so every candidate row re-evaluates
-- students' policies. Measured: a single count over students, as the parent,
-- costs 375 ms. Multiply by rows x policies and 8 seconds disappears.
--
-- MY CONTRIBUTION, stated plainly: the nested EXISTS pattern predates this
-- work, but Chunk 1's role binding is what made `students` expensive to read.
-- Before it, those policies were a cheap column comparison. So this is not an
-- inherited failure to point at someone else -- the cost is mine to remove.
--
-- The fix is the shape the codebase already uses for teachers:
-- `teacher_teaches_class` is SECURITY DEFINER precisely so a policy asking
-- "does this teacher teach this class" does not re-run teachers' RLS. The
-- student and parent paths never got the same treatment. They do now.
--
-- SECURITY DEFINER bypasses RLS, so every guarantee the bypassed policies
-- carried is re-stated INSIDE the helper -- the active role, the active local
-- person, and the institution. Losing any of those here would trade a
-- performance bug for a privacy one.
--
-- Reverse: supabase/migrations/rollback/20260827100000_chunk5_1_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — the two identity helpers the student and parent paths lacked
-- ---------------------------------------------------------------------

-- "Is this student record the one my session is acting as?"
-- Role-bound: a parent, teacher or admin session is NOT this student, even
-- when the same human owns both records (Chunk 1 role binding).
CREATE OR REPLACE FUNCTION public.is_my_student_record(_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _student_id IS NOT NULL
     AND public.active_membership_role() = 'student'
     AND _student_id = public.active_local_person_id()
$$;

-- "Is this student my child, in the institution I am active in?"
-- Covers both links: the denormalised students.parent_user_id and the
-- parent_students join, resolved through the ACTIVE parent membership.
CREATE OR REPLACE FUNCTION public.is_my_child(_student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _student_id IS NOT NULL
     AND public.active_membership_role() = 'parent'
     AND EXISTS (
       SELECT 1
         FROM public.students s
        WHERE s.id = _student_id
          AND s.school_id = public.active_membership_school_id()
          AND (
            s.parent_user_id = auth.uid()
            OR EXISTS (
              SELECT 1 FROM public.parent_students ps
               WHERE ps.student_id = s.id
                 AND ps.parent_id = public.active_local_person_id()
            )
          )
     )
$$;

GRANT EXECUTE ON FUNCTION public.is_my_student_record(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_my_child(uuid)          TO authenticated;


-- ---------------------------------------------------------------------
-- SECTION 2 — homework_submissions: the table that was actually timing out
--
-- It carried TEN permissive policies, five of them duplicates of the other
-- five -- an older set and a newer `hw_sub *` set, both live. That is G9's
-- two-sources-of-truth shape showing up as a performance bug: every duplicate
-- is another full evaluation per row.
--
-- The duplicates are removed and the survivors use the helpers. Access is
-- preserved exactly, with one deliberate tightening noted below.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "Parents can view submissions of their children"      ON public.homework_submissions;
DROP POLICY IF EXISTS "Parents via parent_students can view submissions"    ON public.homework_submissions;
DROP POLICY IF EXISTS "Students can manage their own submissions"           ON public.homework_submissions;
DROP POLICY IF EXISTS "Teachers can view and grade submissions for their homework" ON public.homework_submissions;
DROP POLICY IF EXISTS "Admins can manage all submissions"                   ON public.homework_submissions;

-- TIGHTENING, deliberate: the dropped "Admins can manage all submissions"
-- granted the PRINCIPAL full write (it was FOR ALL over admin OR principal).
-- The principal is oversight, not an editor -- the same rule Chunk 4 enforced
-- for attendance. The principal keeps SELECT through "hw_sub principal read".
--
-- PRESERVED: the dropped teacher policy also matched on hw.created_by, which
-- the surviving one did not. A teacher who created homework for a class they
-- no longer teach would have lost access, so that arm is carried over.

DROP POLICY IF EXISTS "hw_sub parent read" ON public.homework_submissions;
CREATE POLICY "hw_sub parent read" ON public.homework_submissions
  FOR SELECT TO authenticated
  USING (public.is_my_child(student_id));

DROP POLICY IF EXISTS "hw_sub student own" ON public.homework_submissions;
CREATE POLICY "hw_sub student own" ON public.homework_submissions
  FOR ALL TO authenticated
  USING (public.is_my_student_record(student_id))
  WITH CHECK (public.is_my_student_record(student_id));

DROP POLICY IF EXISTS "hw_sub teacher manage" ON public.homework_submissions;
CREATE POLICY "hw_sub teacher manage" ON public.homework_submissions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.homework h
       WHERE h.id = homework_submissions.homework_id
         AND (h.created_by = (SELECT auth.uid())
           OR public.teacher_teaches_class((SELECT auth.uid()), h.class_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.homework h
       WHERE h.id = homework_submissions.homework_id
         AND (h.created_by = (SELECT auth.uid())
           OR public.teacher_teaches_class((SELECT auth.uid()), h.class_id))
    )
  );


-- ---------------------------------------------------------------------
-- SECTION 3 — the same swap everywhere the student/parent path is nested
--
-- Each of these is the identical predicate expressed through the helper, so
-- who can see what does not change; only the cost does.
-- ---------------------------------------------------------------------

-- attendance
DROP POLICY IF EXISTS "att student read self" ON public.attendance;
CREATE POLICY "att student read self" ON public.attendance
  FOR SELECT TO authenticated
  USING (public.is_my_student_record(student_id));

DROP POLICY IF EXISTS "att parent read child" ON public.attendance;
CREATE POLICY "att parent read child" ON public.attendance
  FOR SELECT TO authenticated
  USING (public.is_my_child(student_id));

DROP POLICY IF EXISTS "Parents via parent_students can view attendance" ON public.attendance;

-- homework (the assignment itself)
DROP POLICY IF EXISTS "homework parent read" ON public.homework;
CREATE POLICY "homework parent read" ON public.homework
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
       WHERE s.class_id = homework.class_id
         AND public.is_my_child(s.id)
    )
  );

-- Chunk 5's own tables, written with the nested shape before it was measured.
DROP POLICY IF EXISTS homework_answers_parent_read ON public.homework_answers;
CREATE POLICY homework_answers_parent_read ON public.homework_answers
  FOR SELECT TO authenticated
  USING (public.is_my_child(student_id));

DROP POLICY IF EXISTS homework_answers_student_own ON public.homework_answers;
CREATE POLICY homework_answers_student_own ON public.homework_answers
  FOR ALL TO authenticated
  USING (public.is_my_student_record(student_id))
  WITH CHECK (public.is_my_student_record(student_id));

DROP POLICY IF EXISTS homework_completions_parent_read ON public.homework_completions;
CREATE POLICY homework_completions_parent_read ON public.homework_completions
  FOR SELECT TO authenticated
  USING (public.is_my_child(student_id));

DROP POLICY IF EXISTS homework_completions_student_own ON public.homework_completions;
CREATE POLICY homework_completions_student_own ON public.homework_completions
  FOR SELECT TO authenticated
  USING (public.is_my_student_record(student_id));

-- leave_requests and fees, both on the same parent path.
DROP POLICY IF EXISTS "leaves parent read child" ON public.leave_requests;
CREATE POLICY "leaves parent read child" ON public.leave_requests
  FOR SELECT TO authenticated
  USING (public.is_my_child(student_id));

DROP POLICY IF EXISTS "fees parent read" ON public.fees;
CREATE POLICY "fees parent read" ON public.fees
  FOR SELECT TO authenticated
  USING (public.is_my_child(student_id));

DROP POLICY IF EXISTS "fees student read" ON public.fees;
CREATE POLICY "fees student read" ON public.fees
  FOR SELECT TO authenticated
  USING (public.is_my_student_record(student_id));

-- academic_daily_activity is keyed by user_id, not student_id.
DROP POLICY IF EXISTS "activity parent" ON public.academic_daily_activity;
CREATE POLICY "activity parent" ON public.academic_daily_activity
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
       WHERE s.user_id = academic_daily_activity.user_id
         AND public.is_my_child(s.id)
    )
  );


-- ---------------------------------------------------------------------
-- SECTION 4 — assertions
--
-- G11: assert the guarantee, not a snapshot. The guarantee is that the helpers
-- stay role-bound and institution-bound -- if they ever stopped being either,
-- SECURITY DEFINER would turn this optimisation into a privacy hole.
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int; _d text;
BEGIN
  FOR _d IN SELECT unnest(ARRAY['is_my_student_record', 'is_my_child']) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = _d
         AND p.prosecdef
         AND p.prosrc LIKE '%active_membership_role()%'
    ) THEN
      RAISE EXCEPTION
        '%() must be SECURITY DEFINER and role-bound; without the role check it would grant across roles', _d;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='is_my_child'
       AND p.prosrc LIKE '%active_membership_school_id()%'
  ) THEN
    RAISE EXCEPTION 'is_my_child() lost its institution check';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='is_my_student_record'
       AND p.prosrc LIKE '%active_local_person_id()%'
  ) THEN
    RAISE EXCEPTION 'is_my_student_record() lost its local-person binding';
  END IF;

  -- The duplicate stack is gone: no table may carry two permissive policies
  -- that are the same predicate under different names.
  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname='public' AND tablename='homework_submissions' AND permissive='PERMISSIVE';
  IF _n > 6 THEN
    RAISE EXCEPTION 'homework_submissions still carries % permissive policies; the duplicates were not removed', _n;
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 5 — pass two: the remaining per-row scans
--
-- Pass one took the app-shaped parent query from 33.3 s to 14.5 s -- better,
-- still over the 8 s timeout, so still a 500. Measuring again showed the cost
-- had moved rather than gone:
--
--   * `homework parent read` (written in pass one) scans students for EVERY
--     homework row: O(students in class) per row.
--   * `hw_sub teacher manage` reaches into `homework`, so it pays homework's
--     whole policy stack per candidate row -- and homework carries its own
--     duplicated stack, including THREE separate parent policies.
--
-- Both are the same lesson as pass one: a policy must not do per-row work that
-- a SECURITY DEFINER helper can do once.
-- ---------------------------------------------------------------------

-- "Does a child of mine sit in this class?" Answers per CLASS, not per row.
CREATE OR REPLACE FUNCTION public.is_class_of_my_child(_class_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT _class_id IS NOT NULL
     AND public.active_membership_role() = 'parent'
     AND EXISTS (
       SELECT 1
         FROM public.students s
        WHERE s.class_id = _class_id
          AND s.school_id = public.active_membership_school_id()
          AND (
            s.parent_user_id = auth.uid()
            OR EXISTS (
              SELECT 1 FROM public.parent_students ps
               WHERE ps.student_id = s.id
                 AND ps.parent_id = public.active_local_person_id()
            )
          )
     )
$$;

-- "May I, as a teacher, manage this homework?" Bypasses homework's RLS so the
-- caller does not pay it a second time from inside another table's policy.
CREATE OR REPLACE FUNCTION public.can_manage_homework(_homework_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.homework h
     WHERE h.id = _homework_id
       AND (h.created_by = auth.uid()
         OR public.teacher_teaches_class(auth.uid(), h.class_id))
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_class_of_my_child(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_manage_homework(uuid)  TO authenticated;


-- homework: collapse the duplicate stack. Eight permissive policies become
-- five, with no change to who sees what.
DROP POLICY IF EXISTS "Parents can view homework for their children"   ON public.homework;
DROP POLICY IF EXISTS "Parents via parent_students can view homework"  ON public.homework;
DROP POLICY IF EXISTS "Students can view homework for their class"     ON public.homework;
DROP POLICY IF EXISTS "Teachers can manage homework for their classes" ON public.homework;

DROP POLICY IF EXISTS "homework parent read" ON public.homework;
CREATE POLICY "homework parent read" ON public.homework
  FOR SELECT TO authenticated
  USING (public.is_class_of_my_child(class_id));

-- The dropped teacher policy also matched created_by, which the surviving one
-- did not; carried over so a teacher never loses their own homework.
DROP POLICY IF EXISTS "homework teacher manage" ON public.homework;
CREATE POLICY "homework teacher manage" ON public.homework
  FOR ALL TO authenticated
  USING (created_by = (SELECT auth.uid())
      OR public.teacher_teaches_class((SELECT auth.uid()), class_id))
  WITH CHECK (created_by = (SELECT auth.uid())
      OR public.teacher_teaches_class((SELECT auth.uid()), class_id));

-- homework_submissions: stop reaching into homework from inside a policy.
DROP POLICY IF EXISTS "hw_sub teacher manage" ON public.homework_submissions;
CREATE POLICY "hw_sub teacher manage" ON public.homework_submissions
  FOR ALL TO authenticated
  USING (public.can_manage_homework(homework_id))
  WITH CHECK (public.can_manage_homework(homework_id));

-- academic_daily_activity: per-class, not per-row.
DROP POLICY IF EXISTS "activity parent" ON public.academic_daily_activity;
CREATE POLICY "activity parent" ON public.academic_daily_activity
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
       WHERE s.user_id = academic_daily_activity.user_id
         AND public.is_class_of_my_child(s.class_id)
    )
  );

DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname='public' AND tablename='homework' AND permissive='PERMISSIVE';
  IF _n > 5 THEN
    RAISE EXCEPTION 'homework still carries % permissive policies; duplicates remain', _n;
  END IF;

  -- Same guarantee as the pass-one helpers: SECURITY DEFINER means every
  -- bypassed check has to be re-stated inside.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='is_class_of_my_child'
       AND p.prosecdef
       AND p.prosrc LIKE '%active_membership_role()%'
       AND p.prosrc LIKE '%active_membership_school_id()%'
  ) THEN
    RAISE EXCEPTION 'is_class_of_my_child() must stay role-bound and institution-bound';
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 6 — close the institution gap the tenant-scope gate found
--
-- can_manage_homework is SECURITY DEFINER, so it bypasses homework's tenant
-- fence. teacher_teaches_class() fences itself, but the `created_by` arm did
-- not: a teacher who moved institutions could still manage homework they had
-- created at the previous one. Narrow, but it is exactly the cross-institution
-- path this build exists to close, and SECURITY DEFINER means nothing else
-- would have caught it.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_manage_homework(_homework_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.homework h
     WHERE h.id = _homework_id
       AND public.same_school(h.school_id)
       AND (h.created_by = auth.uid()
         OR public.teacher_teaches_class(auth.uid(), h.class_id))
  )
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='can_manage_homework'
       AND p.prosrc LIKE '%same_school%'
  ) THEN
    RAISE EXCEPTION 'can_manage_homework() lost its institution fence';
  END IF;
END $$;
