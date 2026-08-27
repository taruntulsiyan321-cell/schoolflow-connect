-- =====================================================================
-- REVERSE OF: 20260827110000_chunk6_tests_exams_report_cards.sql
--
-- WHAT THIS COSTS, plainly. Read before running:
--
--  1. DATA LOSS. tests, test_marks, exam_subjects and report_cards are
--     dropped. Every recorded class test, every per-subject exam row and
--     every generated report card goes with them. There is no other copy.
--     marks.exam_subject_id is dropped too, so the per-subject grain of
--     existing marks is destroyed even though the marks rows survive.
--
--  2. "NOT MARKED" BECOMES INEXPRESSIBLE AGAIN. Restoring the NOT NULL on
--     marks.marks_obtained is only possible if no NULL rows exist. If any
--     student is genuinely unmarked, this script STOPS rather than writing
--     a false 0 to satisfy the constraint (G4). Resolve those rows first,
--     deliberately, or leave the column nullable.
--
--  3. PARTIAL REPORT CARDS BECOME POSSIBLE AGAIN. The never-partial
--     trigger is dropped along with its table.
--
--  4. THE G12 COST COMES BACK. The restored "exams school read" and marks
--     policies are the originals, with nested EXISTS over students /
--     parent_students / parents evaluated per candidate row. Measured
--     before Chunk 6: marks-as-parent 1138 ms on 5 rows, ~227 ms/row.
--     That sits inside the 8 s statement timeout only because the demo
--     data is tiny; at a real roster it is an HTTP 500.
--
-- Reverse to isolate a problem, not as a resting state.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Refuse to proceed if reversing would require inventing data (G4).
-- ---------------------------------------------------------------------
DO $$
DECLARE _unmarked bigint;
BEGIN
  SELECT count(*) INTO _unmarked FROM public.marks WHERE marks_obtained IS NULL;
  IF _unmarked > 0 THEN
    RAISE EXCEPTION
      'refusing to reverse Chunk 6: % mark row(s) are NULL (not marked). Restoring NOT NULL would require writing a false 0 for a student who was never marked. Resolve those rows deliberately, then re-run.', _unmarked;
  END IF;
END $$;

-- ---------------------------------------------------------------------
-- 1. Policies and helpers introduced by Chunk 6, in reverse order.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "marks read"           ON public.marks;
DROP POLICY IF EXISTS "marks teacher manage" ON public.marks;
DROP POLICY IF EXISTS "exams school read"    ON public.exams;

DROP FUNCTION IF EXISTS public.can_read_mark(uuid, uuid);
DROP FUNCTION IF EXISTS public.my_children_student_ids();
DROP FUNCTION IF EXISTS public.my_children_class_ids();
DROP FUNCTION IF EXISTS public.can_upload_exam_marks(uuid);
DROP FUNCTION IF EXISTS public.can_manage_exam(uuid);
DROP FUNCTION IF EXISTS public.can_read_test(uuid);
DROP FUNCTION IF EXISTS public.can_manage_test(uuid);

-- ---------------------------------------------------------------------
-- 2. The pre-Chunk-6 policies, restored verbatim from the migrations that
--    last defined them (20260802510000, 20260802530000, 20260804000000,
--    20260820170000, 20260503085055). Their cost is item 4 above.
-- ---------------------------------------------------------------------
CREATE POLICY "exams school read" ON public.exams
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.teacher_teaches_class(auth.uid(), class_id)
      OR public.student_class_id(auth.uid()) = class_id
      OR EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.parent_user_id = auth.uid() AND s.class_id = exams.class_id
      )
      OR EXISTS (
        SELECT 1 FROM public.parent_students ps
        JOIN public.students s ON s.id = ps.student_id
        JOIN public.parents p ON p.id = ps.parent_id
        WHERE p.user_id = auth.uid() AND s.class_id = exams.class_id
      )
    )
  );

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

CREATE POLICY "marks student read" ON public.marks
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.students s
      JOIN public.exams e ON e.id = marks.exam_id
      WHERE s.id = marks.student_id
        AND s.user_id = auth.uid()
        AND e.results_published_at IS NOT NULL
    )
  );

CREATE POLICY "marks principal read" ON public.marks
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    AND public.same_school(school_id)
  );

CREATE POLICY "marks teacher manage" ON public.marks FOR ALL
  USING (EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND public.teacher_teaches_class(auth.uid(), e.class_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.exams e WHERE e.id = exam_id AND public.teacher_teaches_class(auth.uid(), e.class_id)));

-- ---------------------------------------------------------------------
-- 3. marks: back to the exam-level grain.
--    The UNIQUE swap reverses only if no exam holds two marked subjects
--    for the same student -- the coarser key cannot represent those.
--    Check, do not assume, and never delete rows to make it fit.
-- ---------------------------------------------------------------------
DO $$
DECLARE _dupes bigint;
BEGIN
  SELECT count(*) INTO _dupes FROM (
    SELECT exam_id, student_id FROM public.marks
     GROUP BY exam_id, student_id HAVING count(*) > 1
  ) d;
  IF _dupes > 0 THEN
    RAISE EXCEPTION
      'refusing to reverse Chunk 6: % (exam, student) pair(s) hold marks for more than one subject. The old UNIQUE (exam_id, student_id) cannot represent them, and dropping rows to fit would destroy real marks.', _dupes;
  END IF;
END $$;

ALTER TABLE public.marks DROP CONSTRAINT IF EXISTS marks_exam_subject_student_key;
ALTER TABLE public.marks
  ADD CONSTRAINT marks_exam_id_student_id_key UNIQUE (exam_id, student_id);

DROP INDEX IF EXISTS public.marks_exam_subject_idx;
ALTER TABLE public.marks DROP COLUMN IF EXISTS exam_subject_id;
ALTER TABLE public.marks ALTER COLUMN marks_obtained SET NOT NULL;
COMMENT ON COLUMN public.marks.marks_obtained IS NULL;

-- ---------------------------------------------------------------------
-- 4. Tables introduced by Chunk 6. Item 1 above: this is the data loss.
-- ---------------------------------------------------------------------
DROP TRIGGER  IF EXISTS trg_report_card_requires_every_subject ON public.report_cards;
DROP FUNCTION IF EXISTS public.tg_report_card_requires_every_subject();

DROP TABLE IF EXISTS public.report_cards;
DROP TABLE IF EXISTS public.exam_subjects;
DROP TABLE IF EXISTS public.test_marks;
DROP TABLE IF EXISTS public.tests;

-- ---------------------------------------------------------------------
-- 5. exams: the columns Chunk 6 added.
--    exam_group_id is deliberately NOT touched here. Section 3 dropped it
--    and Section 17 restored it, so Chunk 6 nets out to leaving it exactly
--    as it found it. Dropping it in the reverse would remove a column that
--    predates this chunk (20260731140000) and is still read and written by
--    the admin Examinations screen, the teacher live panel and
--    marksService.
-- ---------------------------------------------------------------------
-- Section 18's composite-FK target on students. report_cards_student_fk goes
-- with the table in step 4; this is the key it pointed at, which did not exist
-- before Chunk 6. Dropping it is safe: id is the primary key, so it never
-- carried a uniqueness guarantee of its own.
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_id_school_key;

ALTER TABLE public.exams DROP CONSTRAINT IF EXISTS exams_id_school_key;
ALTER TABLE public.exams
  DROP COLUMN IF EXISTS previous_exam_id,
  DROP COLUMN IF EXISTS academic_year_id;
COMMENT ON COLUMN public.exams.passing_marks IS NULL;

DELETE FROM public.schema_migrations WHERE version = '20260827110000';

COMMIT;
