-- ROOT CAUSE FIX — the most severe finding of this entire campaign.
--
-- This schema has TWO coexisting parent-child linkage mechanisms:
--   1. students.parent_user_id (legacy direct column)
--   2. parents -> parent_students (join table)
-- The ADMIN'S ACTUAL PARENT-LINKING UI (src/gurukul-admin/Parents.tsx) only
-- ever writes mechanism #2 -- it NEVER sets parent_user_id. Confirmed by
-- reading that component directly, not inferred.
--
-- 17 RLS policies across 16 tables (students, attendance, marks, fees,
-- homework, homework_submissions, concept_mastery, academic_daily_activity,
-- leave_requests, library_checkouts, question_records, revision_queue,
-- student_mistakes, plus a "classmate read" marks policy) check ONLY
-- mechanism #1. Net effect: for every parent account linked through the
-- real, production admin workflow, EVERY parent-facing data view in the
-- application is silently empty -- not a UI bug, a hard RLS block at the
-- database layer. Confirmed live: a fresh parent linked via parent_students
-- only (student_id resolves, parent row resolves, parent_students row
-- resolves -- all confirmed readable) still got `"students": null` back
-- from a direct PostgREST embedded-select query, because "students parent
-- read" (`USING (parent_user_id = auth.uid())`) silently denied the read.
--
-- This was found via a systematic sweep of pg_policies for the
-- parent_user_id-without-parent_students pattern -- the SAME sweep run
-- earlier this session for a different purpose returned only 1 false
-- result, because that earlier query had `AND NOT (qual ILIKE ... OR
-- with_check ILIKE ...)`, and Postgres's three-valued NULL logic makes
-- `NOT (false OR NULL)` evaluate to NULL (excluded), not TRUE -- every
-- SELECT-only policy has with_check = NULL, so every one of these 17 was
-- silently skipped by that first sweep. Re-run with explicit NULL handling
-- to get the real, complete list. Worth remembering: this exact NULL-in-OR
-- trap is the same class of bug already found once this session in
-- application code (match_ai_answer_cache's `NULL = ANY(array)` bug,
-- documented earlier in this campaign) -- easy to reintroduce even while
-- actively hunting for it.
--
-- Fix: every policy below gets `parent_user_id = auth.uid()` (or the
-- equivalent EXISTS-joined form) OR'd with an explicit parent_students
-- lookup, preserving every other condition in the original policy exactly
-- (published-only gating on marks, class-scoping on homework, the
-- `student_id IS NOT NULL` guard on leave_requests, etc.) -- nothing here
-- widens what a parent can see beyond their own linked children, it only
-- makes the second linkage mechanism actually work.

DROP POLICY IF EXISTS "students parent read" ON public.students;
CREATE POLICY "students parent read" ON public.students FOR SELECT
  USING (
    parent_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.parent_students ps
      JOIN public.parents p ON p.id = ps.parent_id
      WHERE ps.student_id = students.id AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "att parent read child" ON public.attendance;
CREATE POLICY "att parent read child" ON public.attendance FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = attendance.student_id
        AND (
          s.parent_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id AND p.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "activity parent" ON public.academic_daily_activity;
CREATE POLICY "activity parent" ON public.academic_daily_activity FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = academic_daily_activity.user_id
        AND (
          s.parent_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id AND p.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "mastery parent" ON public.concept_mastery;
CREATE POLICY "mastery parent" ON public.concept_mastery FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = concept_mastery.user_id
        AND (
          s.parent_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id AND p.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "fees parent read" ON public.fees;
CREATE POLICY "fees parent read" ON public.fees FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = fees.student_id
        AND (
          s.parent_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id AND p.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "Parents can view homework for their children" ON public.homework;
CREATE POLICY "Parents can view homework for their children" ON public.homework FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.class_id = homework.class_id
        AND (
          s.parent_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id AND p.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "homework parent read" ON public.homework;
CREATE POLICY "homework parent read" ON public.homework FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.class_id = homework.class_id
        AND (
          s.parent_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id AND p.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "Parents can view submissions of their children" ON public.homework_submissions;
CREATE POLICY "Parents can view submissions of their children" ON public.homework_submissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = homework_submissions.student_id
        AND (
          s.parent_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id AND p.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "hw_sub parent read" ON public.homework_submissions;
CREATE POLICY "hw_sub parent read" ON public.homework_submissions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = homework_submissions.student_id
        AND (
          s.parent_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id AND p.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "leaves parent read child" ON public.leave_requests;
CREATE POLICY "leaves parent read child" ON public.leave_requests FOR SELECT
  USING (
    student_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = leave_requests.student_id
        AND (
          s.parent_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id AND p.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "checkouts parent read" ON public.library_checkouts;
CREATE POLICY "checkouts parent read" ON public.library_checkouts FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = library_checkouts.student_id
        AND (
          s.parent_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id AND p.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "marks classmate read" ON public.marks;
CREATE POLICY "marks classmate read" ON public.marks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.exams e
      JOIN public.students me ON (
        me.user_id = auth.uid()
        OR me.parent_user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = me.id AND p.user_id = auth.uid())
      )
      WHERE e.id = marks.exam_id AND e.class_id = me.class_id AND e.results_published_at IS NOT NULL
    )
  );

DROP POLICY IF EXISTS "marks parent read" ON public.marks;
CREATE POLICY "marks parent read" ON public.marks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      JOIN public.exams e ON e.id = marks.exam_id
      WHERE s.id = marks.student_id
        AND e.results_published_at IS NOT NULL
        AND (
          s.parent_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id AND p.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "qrec parent" ON public.question_records;
CREATE POLICY "qrec parent" ON public.question_records FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = question_records.user_id
        AND (
          s.parent_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id AND p.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "revision parent" ON public.revision_queue;
CREATE POLICY "revision parent" ON public.revision_queue FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = revision_queue.user_id
        AND (
          s.parent_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id AND p.user_id = auth.uid())
        )
    )
  );

DROP POLICY IF EXISTS "mistakes parent child" ON public.student_mistakes;
CREATE POLICY "mistakes parent child" ON public.student_mistakes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = student_mistakes.user_id
        AND (
          s.parent_user_id = auth.uid()
          OR EXISTS (SELECT 1 FROM public.parent_students ps JOIN public.parents p ON p.id = ps.parent_id WHERE ps.student_id = s.id AND p.user_id = auth.uid())
        )
    )
  );

-- "parent_academic_alerts"."parent alerts own" is deliberately left
-- untouched: it gates on this table's OWN parent_user_id column (who an
-- alert is addressed to), not students.parent_user_id -- a direct
-- ownership check, not an instance of this bug. Whether the alert-creation
-- code correctly resolves target parents through both linkage mechanisms
-- is a separate, not-yet-checked question.
