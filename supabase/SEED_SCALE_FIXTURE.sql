-- =====================================================================
-- SCALE FIXTURE — realistic volume for the gates that measure volume
--
-- Why this exists, from the build doc's G8:
--   "The seed must cover every table the gates measure. tests, test_marks
--    and report_cards hold zero rows, so the timing gate measures nothing
--    for them — blind precisely where the newest tables are."
--
-- And from Chunk 6.6: candidates for a marks read scale with TOTAL MARKS
-- IN THE SCHOOL, not with the rows the reader can see. 26 demo marks hide
-- a defect that is an HTTP 500 at 2,500. A timing gate run against 26 rows
-- is not a weaker measurement — it is a measurement of the wrong thing.
--
-- Shape: 6 sections x 35 students = 210 students, 6 subjects each,
-- 2 exams each -> 210 x 6 x 2 = 2,520 marks. Plus 36 tests / 1,260 test
-- marks / 210 report cards, so no gate-measured table sits at zero.
--
-- DELIBERATELY IN ITS OWN SECTIONS. The pathology is driven by the school
-- total, so the fixture does not need to touch 10-A, 12-A or 9-A — and it
-- must not: those are the screens the demo is reviewed on. Every row here
-- is reachable from the fixed UUID prefixes below, so it is removable.
--
--   apply:  node q.mjs supabase/SEED_SCALE_FIXTURE.sql
--   remove: node q.mjs supabase/SEED_SCALE_FIXTURE_REMOVE.sql
--
-- Idempotent: every id is deterministic, every insert is ON CONFLICT.
-- =====================================================================

DO $$
DECLARE
  _school   uuid := '00000000-0000-4000-8000-000000000001';
  _ay       uuid := 'cffb95aa-1a8c-45a4-b9bb-6d558225c0a2';  -- 2025-26, is_current
  _cc       uuid := 'e84e62f8-54ae-4715-924f-dd81cff34ece';  -- Class 10 curriculum
  _grp      uuid := 'f6600000-0000-4000-8000-000000000001';
  _teacher  uuid;
  _marks    bigint;
BEGIN
  SELECT id INTO _teacher FROM public.teachers WHERE school_id = _school LIMIT 1;

  -- ---- class group -------------------------------------------------
  INSERT INTO public.class_groups (id, school_id, academic_year_id, curriculum_class_id, label)
  VALUES (_grp, _school, _ay, _cc, 'Class 10 (scale fixture)')
  ON CONFLICT (id) DO NOTHING;

  -- ---- 6 sections --------------------------------------------------
  INSERT INTO public.classes
    (id, school_id, name, section, academic_year, academic_year_id, class_group_id,
     kind, is_active, class_teacher_id)
  SELECT ('f6600001-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
         _school, '10', 'S' || i, '2025-26', _ay, _grp, 'class', true, _teacher
    FROM generate_series(1, 6) AS i
  ON CONFLICT (id) DO NOTHING;

  -- ---- 6 subjects per section --------------------------------------
  -- Six of Class 10's eight curriculum subjects, chosen by name order so
  -- the same six resolve on every run.
  INSERT INTO public.section_subjects (school_id, section_id, curriculum_subject_id)
  SELECT _school, c.id, cs.id
    FROM public.classes c
    CROSS JOIN LATERAL (
      SELECT id FROM public.curriculum_subjects
       WHERE curriculum_class_id = _cc ORDER BY name LIMIT 6
    ) cs
   WHERE c.class_group_id = _grp
  ON CONFLICT DO NOTHING;

  -- ---- 35 students per section = 210 -------------------------------
  INSERT INTO public.students
    (id, school_id, full_name, admission_number, class_id, academic_year_id,
     status, gender, enrolment_date)
  SELECT ('f6600002-0000-4000-8000-' || lpad(((s - 1) * 35 + n)::text, 12, '0'))::uuid,
         _school,
         'Scale Student ' || s || '-' || n,
         'SCALE-' || lpad(((s - 1) * 35 + n)::text, 4, '0'),
         ('f6600001-0000-4000-8000-' || lpad(s::text, 12, '0'))::uuid,
         _ay, 'active', 'unspecified', CURRENT_DATE - 120
    FROM generate_series(1, 6) AS s, generate_series(1, 35) AS n
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_enrolments
    (school_id, student_id, academic_year_id, section_id, roll_number, from_date)
  SELECT _school, st.id, _ay, st.class_id, row_number() OVER (PARTITION BY st.class_id ORDER BY st.admission_number),
         CURRENT_DATE - 120
    FROM public.students st
    JOIN public.classes c ON c.id = st.class_id
   WHERE c.class_group_id = _grp
  ON CONFLICT DO NOTHING;

  -- ---- 2 exams per section = 12 ------------------------------------
  -- Exam 1 is published (parents and students can see it — that is the
  -- read path being measured). Exam 2 is unpublished, so the published
  -- filter is actually exercised rather than trivially true.
  INSERT INTO public.exams
    (id, school_id, name, exam_type, class_id, academic_year_id, max_marks,
     passing_marks, exam_date, status, marks_locked, results_published_at, created_by)
  SELECT ('f6600003-0000-4000-8000-' || lpad(((s - 1) * 2 + e)::text, 12, '0'))::uuid,
         _school,
         CASE e WHEN 1 THEN 'Half Yearly (scale)' ELSE 'Unit Test 2 (scale)' END,
         (CASE e WHEN 1 THEN 'half_yearly' ELSE 'unit_test' END)::public.exam_type,
         ('f6600001-0000-4000-8000-' || lpad(s::text, 12, '0'))::uuid,
         _ay, 100, 33, CURRENT_DATE - (30 * e), 'completed',
         (e = 1),
         CASE WHEN e = 1 THEN now() - interval '20 days' ELSE NULL END,
         NULL
    FROM generate_series(1, 6) AS s, generate_series(1, 2) AS e
  ON CONFLICT (id) DO NOTHING;

  -- ---- 6 exam_subjects per exam = 72 -------------------------------
  INSERT INTO public.exam_subjects (school_id, exam_id, section_subject_id, scheduled_at)
  SELECT _school, ex.id, ss.id, ex.exam_date::timestamptz
    FROM public.exams ex
    JOIN public.classes c        ON c.id = ex.class_id AND c.class_group_id = _grp
    JOIN public.section_subjects ss ON ss.section_id = c.id
  ON CONFLICT (exam_id, section_subject_id) DO NOTHING;

  -- ---- 2,520 marks --------------------------------------------------
  -- G4: exam 2 leaves ~1 in 20 unmarked as NULL, so "not marked" is
  -- present in the fixture rather than only in the rules. Exam 1 is fully
  -- marked because report cards below require every subject.
  INSERT INTO public.marks (school_id, exam_id, exam_subject_id, student_id, marks_obtained)
  SELECT _school, ex.id, es.id, st.id,
         CASE
           WHEN ex.results_published_at IS NULL
            AND (('x' || substr(md5(st.id::text || es.id::text), 1, 7))::bit(28)::int % 20) = 0
           THEN NULL
           ELSE 33 + (('x' || substr(md5(st.id::text || es.id::text), 1, 7))::bit(28)::int % 67)
         END
    FROM public.exams ex
    JOIN public.classes c          ON c.id = ex.class_id AND c.class_group_id = _grp
    JOIN public.exam_subjects es   ON es.exam_id = ex.id
    JOIN public.students st        ON st.class_id = c.id
  ON CONFLICT (exam_subject_id, student_id) DO NOTHING;

  -- ---- 36 tests + 1,260 test marks ---------------------------------
  INSERT INTO public.tests
    (id, school_id, academic_year_id, section_subject_id, topic, date, max_mark, status, submitted_at)
  SELECT ('f6600004-0000-4000-8000-' || lpad(row_number() OVER (ORDER BY ss.id)::text, 12, '0'))::uuid,
         _school, _ay, ss.id, 'Chapter revision', CURRENT_DATE - 10, 20, 'submitted', now() - interval '10 days'
    FROM public.section_subjects ss
    JOIN public.classes c ON c.id = ss.section_id AND c.class_group_id = _grp
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.test_marks (school_id, test_id, student_id, mark, uploaded_at)
  SELECT _school, t.id, st.id,
         (('x' || substr(md5(st.id::text || t.id::text), 1, 7))::bit(28)::int % 21),
         now() - interval '9 days'
    FROM public.tests t
    JOIN public.section_subjects ss ON ss.id = t.section_subject_id
    JOIN public.classes c           ON c.id = ss.section_id AND c.class_group_id = _grp
    JOIN public.students st         ON st.class_id = c.id
  ON CONFLICT DO NOTHING;

  -- ---- 210 report cards --------------------------------------------
  -- Only for the published, fully-marked exam. The never-partial trigger
  -- refuses anything else, which is the point of it.
  INSERT INTO public.report_cards (school_id, exam_id, student_id)
  SELECT _school, ex.id, st.id
    FROM public.exams ex
    JOIN public.classes c   ON c.id = ex.class_id AND c.class_group_id = _grp
    JOIN public.students st ON st.class_id = c.id
   WHERE ex.results_published_at IS NOT NULL
  ON CONFLICT (exam_id, student_id) DO NOTHING;

  SELECT count(*) INTO _marks FROM public.marks;
  IF _marks < 2500 THEN
    RAISE EXCEPTION
      'scale fixture did not reach the volume it exists to create: % marks in school, needed 2500+. Measuring against this would repeat the mistake the fixture is here to fix.', _marks;
  END IF;
END $$;

ANALYZE public.marks;
ANALYZE public.exams;
ANALYZE public.exam_subjects;
ANALYZE public.students;
ANALYZE public.tests;
ANALYZE public.test_marks;
ANALYZE public.report_cards;

SELECT (SELECT count(*) FROM public.marks)        AS marks,
       (SELECT count(*) FROM public.exams)        AS exams,
       (SELECT count(*) FROM public.students)     AS students,
       (SELECT count(*) FROM public.tests)        AS tests,
       (SELECT count(*) FROM public.test_marks)   AS test_marks,
       (SELECT count(*) FROM public.report_cards) AS report_cards;
