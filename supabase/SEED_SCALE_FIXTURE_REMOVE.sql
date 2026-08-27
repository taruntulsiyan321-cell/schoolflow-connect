-- =====================================================================
-- REVERSE OF: SEED_SCALE_FIXTURE.sql
--
-- Removes every row the scale fixture created, in FK order, reaching them
-- through the fixture's class group rather than by guessing at name
-- patterns. Nothing outside that group is touched, so 10-A, 12-A and 9-A
-- and their marks are unaffected.
--
-- Run this to put the demo school back to its reviewable size. Note that
-- doing so makes the timing gate blind again — the fixture is what stops
-- it measuring 26 rows and calling that a pass.
-- =====================================================================

DO $$
DECLARE
  _grp uuid := 'f6600000-0000-4000-8000-000000000001';
  _sections uuid[];
  _before bigint;
  _after  bigint;
BEGIN
  SELECT count(*) INTO _before FROM public.marks;

  SELECT array_agg(id) INTO _sections FROM public.classes WHERE class_group_id = _grp;
  IF _sections IS NULL THEN
    RAISE NOTICE 'scale fixture not present — nothing to remove';
    RETURN;
  END IF;

  DELETE FROM public.report_cards rc
   USING public.students st
   WHERE rc.student_id = st.id AND st.class_id = ANY (_sections);

  DELETE FROM public.test_marks tm
   USING public.students st
   WHERE tm.student_id = st.id AND st.class_id = ANY (_sections);

  DELETE FROM public.tests t
   USING public.section_subjects ss
   WHERE t.section_subject_id = ss.id AND ss.section_id = ANY (_sections);

  DELETE FROM public.marks m
   USING public.exams ex
   WHERE m.exam_id = ex.id AND ex.class_id = ANY (_sections);

  DELETE FROM public.exam_subjects es
   USING public.exams ex
   WHERE es.exam_id = ex.id AND ex.class_id = ANY (_sections);

  DELETE FROM public.exams WHERE class_id = ANY (_sections);

  DELETE FROM public.student_enrolments WHERE section_id = ANY (_sections);
  DELETE FROM public.students           WHERE class_id   = ANY (_sections);
  DELETE FROM public.section_subjects   WHERE section_id = ANY (_sections);
  DELETE FROM public.classes            WHERE class_group_id = _grp;
  DELETE FROM public.class_groups       WHERE id = _grp;

  SELECT count(*) INTO _after FROM public.marks;
  RAISE NOTICE 'scale fixture removed: marks % -> %', _before, _after;
END $$;

SELECT (SELECT count(*) FROM public.marks)    AS marks,
       (SELECT count(*) FROM public.students) AS students,
       (SELECT count(*) FROM public.classes WHERE class_group_id = 'f6600000-0000-4000-8000-000000000001') AS fixture_sections;
