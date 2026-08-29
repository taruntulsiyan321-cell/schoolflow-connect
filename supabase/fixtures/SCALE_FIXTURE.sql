-- ---------------------------------------------------------------------
-- SCALE FIXTURE — a second institution at realistic volume (G8)
--
-- "Scale fixtures belong in their own institution. Do not inflate the demo
-- school to give the timing gate volume — that trades a readable demo for a
-- working gate."
--
-- This seeds Northfield Public School: 6 sections, 210 students, 6 subjects,
-- 2 exams, 2,520 exam marks, 2,520 test marks, and report cards. It exists so
-- the timing gate has real candidate volume, and so cross-institution
-- isolation is exercised at volume rather than across 13 students.
--
-- The demo school is left exactly as it is.
--
-- Three things this fixture buys at once:
--   1. Candidate volume. RLS cost is paid per CANDIDATE row, so a demo-school
--      parent now faces ~2,550 marks they cannot see. That is the number the
--      tenant fence actually has to survive.
--   2. Coverage of the tables the gates were blind on. tests, test_marks and
--      report_cards held zero rows, so the timing gate measured nothing there.
--   3. academic_events volume for free — trg_emit_marks_event writes one event
--      and one audit row per mark, so seeding marks also loads the table that
--      is the worst offender in Chunk 6.7.
--
-- Deterministic and idempotent: every id is md5(<stable label>)::uuid, and
-- every insert is ON CONFLICT DO NOTHING. Re-running changes nothing.
-- No random(), no now()-derived ids — a fixture that differs between runs
-- cannot be the baseline for a before/after measurement.
-- ---------------------------------------------------------------------

DO $fixture$
DECLARE
  _school   uuid := '00000000-0000-4000-8000-000000000002';
  _ay       uuid := md5('nf-ay-2025')::uuid;
  _cg       uuid := md5('nf-cg-10')::uuid;
  _cc       uuid;
  _n        bigint;
BEGIN

  -- The curriculum is global (G2) and already seeded. Class 10 is used because
  -- it carries the most subjects; the fixture takes the first six by name.
  SELECT id INTO _cc FROM public.curriculum_classes WHERE label = 'Class 10' LIMIT 1;
  IF _cc IS NULL THEN
    RAISE EXCEPTION 'SCALE_FIXTURE: no Class 10 in curriculum_classes — seed the curriculum first.';
  END IF;

  SELECT count(*) INTO _n FROM public.curriculum_subjects WHERE curriculum_class_id = _cc;
  IF _n < 6 THEN
    RAISE EXCEPTION 'SCALE_FIXTURE: Class 10 has only % curriculum subjects, need 6.', _n;
  END IF;

  ----------------------------------------------------------------------
  -- Institution, year, class group
  ----------------------------------------------------------------------
  INSERT INTO public.schools (id, name, slug, is_active, board,
                              session_start_date, session_end_date, status)
  VALUES (_school, 'Northfield Public School (scale fixture)', 'northfield-scale',
          true, 'rbse', DATE '2025-04-01', DATE '2026-03-31', 'active')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.academic_years (id, school_id, name, starts_on, ends_on, is_current)
  VALUES (_ay, _school, '2025-26', DATE '2025-04-01', DATE '2026-03-31', true)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.class_groups (id, school_id, academic_year_id, curriculum_class_id, label)
  VALUES (_cg, _school, _ay, _cc, 'Class 10')
  ON CONFLICT (id) DO NOTHING;

  ----------------------------------------------------------------------
  -- 6 sections, 6 teachers (one class teacher each)
  ----------------------------------------------------------------------
  INSERT INTO public.teachers (id, school_id, full_name, status, employee_id)
  SELECT md5('nf-teacher-' || i)::uuid, _school,
         'Northfield Teacher ' || chr(64 + i), 'active', 'NF-T-' || lpad(i::text, 3, '0')
    FROM generate_series(1, 6) i
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.classes (id, school_id, name, section, academic_year, academic_year_id,
                              class_group_id, class_teacher_id, is_active)
  SELECT md5('nf-sec-' || i)::uuid, _school, '10', chr(64 + i), '2025-26', _ay,
         _cg, md5('nf-teacher-' || i)::uuid, true
    FROM generate_series(1, 6) i
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.teachers t
     SET class_teacher_of = md5('nf-sec-' || i)::uuid, is_class_teacher = true
    FROM generate_series(1, 6) i
   WHERE t.id = md5('nf-teacher-' || i)::uuid
     AND t.class_teacher_of IS DISTINCT FROM md5('nf-sec-' || i)::uuid;

  ----------------------------------------------------------------------
  -- section_subjects: the canonical teaching identity. 6 subjects x 6 sections
  ----------------------------------------------------------------------
  INSERT INTO public.section_subjects (id, school_id, section_id, curriculum_subject_id)
  SELECT md5('nf-ss-' || i || '-' || s.rn)::uuid, _school, md5('nf-sec-' || i)::uuid, s.id
    FROM generate_series(1, 6) i
    CROSS JOIN (
      SELECT id, row_number() OVER (ORDER BY name) AS rn
        FROM public.curriculum_subjects WHERE curriculum_class_id = _cc ORDER BY name LIMIT 6
    ) s
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.teacher_classes (teacher_id, class_id, school_id, subject)
  SELECT md5('nf-teacher-' || i)::uuid, md5('nf-sec-' || i)::uuid, _school, cs.name
    FROM generate_series(1, 6) i
    CROSS JOIN (
      SELECT name, row_number() OVER (ORDER BY name) AS rn
        FROM public.curriculum_subjects WHERE curriculum_class_id = _cc ORDER BY name LIMIT 6
    ) cs
  ON CONFLICT DO NOTHING;

  ----------------------------------------------------------------------
  -- 210 students: 35 per section
  ----------------------------------------------------------------------
  INSERT INTO public.students (id, school_id, academic_year_id, full_name, admission_number,
                               class_id, status, enrolment_date)
  SELECT md5('nf-student-' || n)::uuid, _school, _ay,
         'Northfield Student ' || lpad(n::text, 3, '0'),
         'NF-' || lpad(n::text, 4, '0'),
         md5('nf-sec-' || (((n - 1) / 35) + 1))::uuid,
         'active', DATE '2025-04-01'
    FROM generate_series(1, 210) n
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_enrolments (id, school_id, student_id, academic_year_id,
                                         section_id, roll_number, from_date)
  SELECT md5('nf-enrol-' || n)::uuid, _school, md5('nf-student-' || n)::uuid, _ay,
         md5('nf-sec-' || (((n - 1) / 35) + 1))::uuid,
         (((n - 1) % 35) + 1)::text, DATE '2025-04-01'
    FROM generate_series(1, 210) n
  ON CONFLICT (id) DO NOTHING;

  ----------------------------------------------------------------------
  -- 12 exams (2 per section), 72 exam_subjects
  ----------------------------------------------------------------------
  INSERT INTO public.exams (id, school_id, academic_year_id, class_id, name, subject,
                            max_marks, passing_marks, exam_date, start_date, end_date,
                            exam_type, status, marks_locked)
  SELECT md5('nf-exam-' || i || '-' || e)::uuid, _school, _ay, md5('nf-sec-' || i)::uuid,
         CASE e WHEN 1 THEN 'Half Yearly 2025' ELSE 'Annual 2026' END,
         NULL,                                   -- multi-subject sitting has no single subject
         100, 33,
         CASE e WHEN 1 THEN DATE '2025-09-15' ELSE DATE '2026-02-10' END,
         CASE e WHEN 1 THEN DATE '2025-09-15' ELSE DATE '2026-02-10' END,
         CASE e WHEN 1 THEN DATE '2025-09-22' ELSE DATE '2026-02-17' END,
         'half_yearly', 'completed', true
    FROM generate_series(1, 6) i, generate_series(1, 2) e
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.exam_subjects (id, school_id, exam_id, section_subject_id, scheduled_at)
  SELECT md5('nf-es-' || i || '-' || e || '-' || s.rn)::uuid, _school,
         md5('nf-exam-' || i || '-' || e)::uuid,
         md5('nf-ss-' || i || '-' || s.rn)::uuid,
         (CASE e WHEN 1 THEN TIMESTAMPTZ '2025-09-15 09:00+05:30'
                 ELSE TIMESTAMPTZ '2026-02-10 09:00+05:30' END) + (s.rn || ' days')::interval
    FROM generate_series(1, 6) i, generate_series(1, 2) e,
         (SELECT row_number() OVER (ORDER BY name) AS rn
            FROM public.curriculum_subjects WHERE curriculum_class_id = _cc ORDER BY name LIMIT 6) s
  ON CONFLICT (id) DO NOTHING;

  ----------------------------------------------------------------------
  -- 2,520 exam marks: 210 students x 6 subjects x 2 exams
  --
  -- Deterministic spread 25..85 out of 100. Roughly 1 in 27 left NULL, because
  -- "not marked" must be representable and must be excluded from every
  -- aggregate (G4) — a fixture with no NULLs cannot exercise that.
  ----------------------------------------------------------------------
  INSERT INTO public.marks (id, school_id, exam_id, exam_subject_id, student_id, marks_obtained)
  SELECT md5('nf-mark-' || n || '-' || e || '-' || s.rn)::uuid,
         _school,
         md5('nf-exam-' || (((n - 1) / 35) + 1) || '-' || e)::uuid,
         md5('nf-es-' || (((n - 1) / 35) + 1) || '-' || e || '-' || s.rn)::uuid,
         md5('nf-student-' || n)::uuid,
         CASE WHEN (n * 3 + s.rn * 5 + e) % 27 = 0 THEN NULL
              ELSE ((n * 7 + s.rn * 13 + e * 5) % 61) + 25 END
    FROM generate_series(1, 210) n, generate_series(1, 2) e,
         (SELECT row_number() OVER (ORDER BY name) AS rn
            FROM public.curriculum_subjects WHERE curriculum_class_id = _cc ORDER BY name LIMIT 6) s
  ON CONFLICT (id) DO NOTHING;

  ----------------------------------------------------------------------
  -- 72 tests + 2,520 test marks — tables the timing gate was blind on
  ----------------------------------------------------------------------
  INSERT INTO public.tests (id, school_id, academic_year_id, section_subject_id,
                            topic, date, max_mark, status, submitted_at)
  SELECT md5('nf-test-' || i || '-' || s.rn || '-' || t)::uuid, _school, _ay,
         md5('nf-ss-' || i || '-' || s.rn)::uuid,
         'Unit ' || t, DATE '2025-07-01' + (t * 30), 20, 'submitted',
         (DATE '2025-07-01' + (t * 30))::timestamptz
    FROM generate_series(1, 6) i, generate_series(1, 2) t,
         (SELECT row_number() OVER (ORDER BY name) AS rn
            FROM public.curriculum_subjects WHERE curriculum_class_id = _cc ORDER BY name LIMIT 6) s
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.test_marks (id, school_id, test_id, student_id, mark)
  SELECT md5('nf-tm-' || n || '-' || s.rn || '-' || t)::uuid, _school,
         md5('nf-test-' || (((n - 1) / 35) + 1) || '-' || s.rn || '-' || t)::uuid,
         md5('nf-student-' || n)::uuid,
         CASE WHEN (n + s.rn * 3 + t) % 23 = 0 THEN NULL
              ELSE ((n * 5 + s.rn * 7 + t * 3) % 15) + 5 END
    FROM generate_series(1, 210) n, generate_series(1, 2) t,
         (SELECT row_number() OVER (ORDER BY name) AS rn
            FROM public.curriculum_subjects WHERE curriculum_class_id = _cc ORDER BY name LIMIT 6) s
  ON CONFLICT (id) DO NOTHING;

  ----------------------------------------------------------------------
  -- Report cards — only where EVERY subject of the sitting is marked.
  -- The never-partial trigger enforces this; the WHERE clause makes the
  -- fixture agree with it rather than fight it.
  ----------------------------------------------------------------------
  INSERT INTO public.report_cards (id, school_id, exam_id, student_id, generated_at)
  SELECT md5('nf-rc-' || n || '-' || e)::uuid, _school,
         md5('nf-exam-' || (((n - 1) / 35) + 1) || '-' || e)::uuid,
         md5('nf-student-' || n)::uuid,
         TIMESTAMPTZ '2026-03-01 10:00+05:30'
    FROM generate_series(1, 210) n, generate_series(1, 2) e
   WHERE NOT EXISTS (
     SELECT 1 FROM public.marks m
      WHERE m.exam_id = md5('nf-exam-' || (((n - 1) / 35) + 1) || '-' || e)::uuid
        AND m.student_id = md5('nf-student-' || n)::uuid
        AND m.marks_obtained IS NULL
   )
  ON CONFLICT (id) DO NOTHING;

  ----------------------------------------------------------------------
  -- Report what was built. A fixture that silently seeds nothing is worse
  -- than no fixture: the timing gate would report comfortable numbers on
  -- volume that is not there.
  ----------------------------------------------------------------------
  DECLARE
    _students bigint; _marks bigint; _tests bigint; _tm bigint; _rc bigint; _ev bigint;
  BEGIN
    SELECT count(*) INTO _students FROM public.students     WHERE school_id = _school;
    SELECT count(*) INTO _marks    FROM public.marks        WHERE school_id = _school;
    SELECT count(*) INTO _tests    FROM public.tests        WHERE school_id = _school;
    SELECT count(*) INTO _tm       FROM public.test_marks   WHERE school_id = _school;
    SELECT count(*) INTO _rc       FROM public.report_cards WHERE school_id = _school;
    SELECT count(*) INTO _ev       FROM public.academic_events WHERE school_id = _school;

    IF _marks < 2500 THEN
      RAISE EXCEPTION
        'SCALE_FIXTURE seeded only % marks; the gate needs 2,500+ to be meaningful (students=%, tests=%).',
        _marks, _students, _tests;
    END IF;

    RAISE NOTICE 'SCALE FIXTURE: students=% marks=% tests=% test_marks=% report_cards=% academic_events=%',
      _students, _marks, _tests, _tm, _rc, _ev;
  END;
END
$fixture$;


-- ═══════════════════════════════════════════════════════════════════════════
-- Chunk 7.5 tables — test_questions and test_attempts
--
-- Added when Chunk 7.5 item 7 (timing per role at fixture volume) was cleared.
-- The fixture already carried 72 tests and 2,520 test_marks; these two tables
-- arrived with 7.5a and the fixture predated them, so a timing run measured an
-- empty table — the same "verified against zero rows is verified against
-- nothing" defect the chapter_tally finding produced, wearing a timing gate.
-- ═══════════════════════════════════════════════════════════════════════════
DO $scale_tests$
DECLARE _scale uuid := '00000000-0000-4000-8000-000000000002';
BEGIN
  INSERT INTO public.test_questions (test_id, school_id, order_index, question, options, correct, marks)
  SELECT t.id, t.school_id, g, 'Scale Q' || g, '["a","b","c","d"]'::jsonb, '"a"'::jsonb, 1
    FROM public.tests t CROSS JOIN generate_series(1, 8) g
   WHERE t.school_id = _scale
  ON CONFLICT (test_id, order_index) DO NOTHING;

  INSERT INTO public.test_attempts (test_id, student_id, user_id, school_id, score, max_score,
                                    correct_count, total_count, status, submitted_at)
  SELECT tm.test_id, tm.student_id, s.user_id, tm.school_id, tm.mark, 8, tm.mark::int, 8, 'submitted', now()
    FROM public.test_marks tm
    JOIN public.students s ON s.id = tm.student_id
   WHERE tm.school_id = _scale
     AND s.user_id IS NOT NULL
     -- test_marks.mark is NULLABLE by design (G4: not marked is not zero). An
     -- unmarked test means there is no attempt to seed, NOT an attempt that
     -- scored 0 — and the NOT NULL on test_attempts.score caught the shortcut.
     AND tm.mark IS NOT NULL
  ON CONFLICT (test_id, user_id) DO NOTHING;
END
$scale_tests$;
