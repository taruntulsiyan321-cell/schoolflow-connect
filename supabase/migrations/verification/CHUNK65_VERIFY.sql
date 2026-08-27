-- ---------------------------------------------------------------------
-- CHUNK 6.5 VERIFICATION — converge exam_group_id
--
-- Self-rolling-back: builds its own fixtures, asserts, then RAISEs a marker
-- so the whole file is undone. Getting the marker back means every check
-- above it ran and passed.
--
-- G11: each item asserts the GUARANTEE, not a snapshot. Item 2 in particular
-- asserts observable behaviour — finalise one subject, then check that a
-- teacher can no longer write to a DIFFERENT subject of the same sitting.
-- Checking only that finalisation "did not error" is exactly how this broke
-- silently the first time: the fan-out UPDATE matched zero rows, returned
-- success, and locked nothing.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _school      uuid;
  _section     uuid;
  _ss_a        uuid;
  _ss_b        uuid;
  _exam        uuid;
  _es_a        uuid;
  _es_b        uuid;
  _student_1   uuid;
  _student_2   uuid;
  _teacher     uuid;
  _n           bigint;
  _txt         text;
  _locked      boolean;
  _wrote_open  boolean;
  _wrote_shut  boolean;
  _fail        text := '';
BEGIN

  -- =================================================================
  -- ITEM 1 — exam_group_id appears nowhere.
  -- Schema and functions are checkable here; client and generated types
  -- are checked by the repo-wide grep in the chunk report.
  -- =================================================================

  SELECT count(*) INTO _n
    FROM information_schema.columns
   WHERE column_name = 'exam_group_id';
  IF _n <> 0 THEN
    _fail := _fail || format('(FAIL) item 1: exam_group_id still exists on %s column(s). ', _n);
  END IF;

  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.prokind IN ('f', 'p')
     AND p.prosrc ILIKE '%exam_group_id%';
  IF _n <> 0 THEN
    _fail := _fail || format('(FAIL) item 1: %s function(s) still reference exam_group_id. ', _n);
  END IF;

  SELECT count(*) INTO _n
    FROM pg_policy pol
   WHERE pg_get_expr(pol.polqual, pol.polrelid) ILIKE '%exam_group_id%'
      OR pg_get_expr(pol.polwithcheck, pol.polrelid) ILIKE '%exam_group_id%';
  IF _n <> 0 THEN
    _fail := _fail || format('(FAIL) item 1: %s policy expression(s) reference exam_group_id. ', _n);
  END IF;

  SELECT count(*) INTO _n
    FROM pg_views WHERE schemaname = 'public' AND definition ILIKE '%exam_group_id%';
  IF _n <> 0 THEN
    _fail := _fail || format('(FAIL) item 1: %s view(s) reference exam_group_id. ', _n);
  END IF;


  -- =================================================================
  -- FIXTURE — a genuinely multi-subject sitting.
  --
  -- The live data has none: every exam covers one subject. Items 2 and 3 are
  -- about what happens when a sitting covers SEVERAL, so the fixture builds
  -- that case rather than asserting against data that cannot exercise it.
  -- =================================================================

  SELECT c.id, c.school_id INTO _section, _school
    FROM public.classes c
   WHERE (SELECT count(*) FROM public.section_subjects ss WHERE ss.section_id = c.id) >= 2
   ORDER BY c.id
   LIMIT 1;

  IF _section IS NULL THEN
    RAISE EXCEPTION 'CHUNK65_VERIFY: no section teaches 2+ subjects, so a multi-subject sitting cannot be built. Items 2 and 3 would be vacuous.';
  END IF;

  SELECT id INTO _ss_a FROM public.section_subjects
   WHERE section_id = _section ORDER BY id LIMIT 1;
  SELECT id INTO _ss_b FROM public.section_subjects
   WHERE section_id = _section AND id <> _ss_a ORDER BY id LIMIT 1;

  INSERT INTO public.exams (school_id, class_id, name, subject, max_marks, exam_date,
                            exam_type, status, marks_locked)
  VALUES (_school, _section, 'CHUNK65_VERIFY sitting', NULL, 100, current_date,
          'unit_test', 'scheduled', false)
  RETURNING id INTO _exam;

  INSERT INTO public.exam_subjects (school_id, exam_id, section_subject_id, scheduled_at)
  VALUES (_school, _exam, _ss_a, now()) RETURNING id INTO _es_a;
  INSERT INTO public.exam_subjects (school_id, exam_id, section_subject_id, scheduled_at)
  VALUES (_school, _exam, _ss_b, now()) RETURNING id INTO _es_b;

  SELECT id INTO _student_1 FROM public.students
   WHERE class_id = _section AND school_id = _school ORDER BY id LIMIT 1;
  SELECT id INTO _student_2 FROM public.students
   WHERE class_id = _section AND school_id = _school AND id <> _student_1 ORDER BY id LIMIT 1;

  IF _student_1 IS NULL OR _student_2 IS NULL THEN
    RAISE EXCEPTION 'CHUNK65_VERIFY: need 2 students in section % to test one-mark-per-student-per-subject.', _section;
  END IF;

  -- A real teacher of this section, with exactly one active membership so
  -- active_membership_id() resolves without a sessions row. Item 2 runs as
  -- this account under RLS; asserting the lock any other way would only be
  -- re-reading the flag we just wrote.
  SELECT t.user_id INTO _teacher
    FROM public.teachers t
   WHERE t.school_id = _school
     AND t.user_id IS NOT NULL
     AND (t.class_teacher_of = _section
          OR EXISTS (SELECT 1 FROM public.teacher_classes tc
                      WHERE tc.teacher_id = t.id AND tc.class_id = _section))
     AND (SELECT count(*) FROM public.memberships m
           WHERE m.account_id = t.user_id AND m.status = 'active') = 1
   ORDER BY t.id
   LIMIT 1;

  IF _teacher IS NULL THEN
    RAISE EXCEPTION 'CHUNK65_VERIFY: no teacher of section % resolves to a single active membership, so item 2 cannot be run as a real teacher. Reporting incomplete rather than passing.', _section;
  END IF;


  -- =================================================================
  -- ITEM 3 — a multi-subject sitting holds one mark per student PER SUBJECT.
  --
  -- Two halves, both required:
  --   (a) the same student CAN hold a mark in each subject of the sitting;
  --   (b) the same student CANNOT hold two marks in the SAME subject.
  -- Asserting only (b) would pass on a schema that forbids (a) too, which is
  -- precisely the pre-Chunk-6 (exam_id, student_id) key this replaced.
  -- =================================================================

  INSERT INTO public.marks (school_id, exam_id, exam_subject_id, student_id, marks_obtained)
  VALUES (_school, _exam, _es_a, _student_1, 71),
         (_school, _exam, _es_b, _student_1, 62),
         (_school, _exam, _es_a, _student_2, 55);

  SELECT count(*) INTO _n
    FROM public.marks WHERE exam_id = _exam AND student_id = _student_1;
  IF _n <> 2 THEN
    _fail := _fail || format(
      '(FAIL) item 3a: one student should hold 2 marks in a 2-subject sitting, found %s. ', _n);
  END IF;

  BEGIN
    INSERT INTO public.marks (school_id, exam_id, exam_subject_id, student_id, marks_obtained)
    VALUES (_school, _exam, _es_a, _student_1, 99);
    _fail := _fail || '(FAIL) item 3b: a second mark for the same student in the SAME subject was accepted. ';
  EXCEPTION WHEN unique_violation THEN
    NULL;  -- expected
  END;

  -- And the anchor cannot be dropped to escape that key.
  BEGIN
    INSERT INTO public.marks (school_id, exam_id, exam_subject_id, student_id, marks_obtained)
    VALUES (_school, _exam, NULL, _student_1, 99);
    _fail := _fail || '(FAIL) item 3c: a mark with no exam_subject_id was accepted, so the per-subject key is escapable. ';
  EXCEPTION WHEN not_null_violation THEN
    NULL;  -- expected
  END;


  -- =================================================================
  -- ITEM 2 — finalising ONE subject finalises its SITTING.
  --
  -- Behaviour, not absence of an error. The sequence is:
  --   1. before finalising, a teacher of subject B may write to subject B;
  --   2. finalise through subject A (the path the UI takes: it holds one
  --      subject and asks for the sitting to be closed);
  --   3. after that, the same teacher may NO LONGER write to subject B.
  --
  -- Step 3 is the whole point. When this broke, step 2 succeeded silently and
  -- step 3 still allowed the write.
  --
  -- can_upload_exam_marks() is the predicate the marks write policy uses, so
  -- asking it directly is asking the real gate. It is evaluated for a teacher
  -- who genuinely teaches the section, so a `false` from it means locked, not
  -- merely unauthorised.
  -- =================================================================

  SELECT e.marks_locked INTO _locked FROM public.exams e WHERE e.id = _exam;
  IF _locked THEN
    _fail := _fail || '(FAIL) item 2 setup: the fixture sitting was already locked before finalising. ';
  END IF;

  -- (a) OPEN sitting: the teacher CAN write to subject B.
  -- Without this half, (b) proves nothing — a teacher who could never write
  -- would also "fail to write" after the lock, and the test would pass for
  -- entirely the wrong reason.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.marks (school_id, exam_id, exam_subject_id, student_id, marks_obtained)
    VALUES (_school, _exam, _es_b, _student_2, 48);
    _wrote_open := true;
  EXCEPTION WHEN insufficient_privilege THEN
    _wrote_open := false;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _wrote_open IS NOT TRUE THEN
    _fail := _fail ||
      '(FAIL) item 2 setup: the teacher could not write to subject B while the sitting was OPEN, so the post-lock check below would prove nothing. ';
  END IF;

  -- Finalise through subject A only — the sitting is resolved FROM that
  -- subject, exactly as the client now does. Subject B is never named.
  UPDATE public.exams
     SET marks_locked = true
   WHERE id = (SELECT es.exam_id FROM public.exam_subjects es WHERE es.id = _es_a);

  SELECT e.marks_locked INTO _locked
    FROM public.exam_subjects es
    JOIN public.exams e ON e.id = es.exam_id
   WHERE es.id = _es_b;
  IF _locked IS NOT TRUE THEN
    _fail := _fail ||
      '(FAIL) item 2: finalising through subject A did not close subject B of the same sitting. ';
  END IF;

  -- (b) FINALISED sitting: the SAME teacher can no longer write to subject B.
  -- An RLS-blocked UPDATE does not raise — it simply matches no rows — so the
  -- row count is the assertion, not the absence of an exception.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    UPDATE public.marks SET marks_obtained = 49
     WHERE exam_subject_id = _es_b AND student_id = _student_2;
    GET DIAGNOSTICS _n = ROW_COUNT;
    _wrote_shut := _n > 0;
  EXCEPTION WHEN insufficient_privilege THEN
    _wrote_shut := false;
  END;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _wrote_shut IS NOT FALSE THEN
    _fail := _fail ||
      '(FAIL) item 2: after finalising through subject A, the teacher could STILL write to subject B of the same sitting. Finalising one subject did not finalise its sitting. ';
  END IF;


  -- =================================================================
  -- ITEM 4 — existing exams keep their groupings; no marks moved.
  --
  -- The convergence was only safe because no exam group spanned more than one
  -- exams row, so no rows were merged and no mark changed hands. That is
  -- asserted as a guarantee about the surviving data rather than a recorded
  -- count: every mark still sits on the exam it was written for, and its
  -- subject anchor belongs to that same exam.
  -- =================================================================

  SELECT count(*) INTO _n
    FROM public.marks m
    JOIN public.exam_subjects es ON es.id = m.exam_subject_id
   WHERE es.exam_id <> m.exam_id;
  IF _n <> 0 THEN
    _fail := _fail || format(
      '(FAIL) item 4: %s mark(s) are anchored to a subject belonging to a DIFFERENT exam — a mark moved. ', _n);
  END IF;

  SELECT count(*) INTO _n
    FROM public.marks m
   WHERE NOT EXISTS (SELECT 1 FROM public.exams e WHERE e.id = m.exam_id);
  IF _n <> 0 THEN
    _fail := _fail || format('(FAIL) item 4: %s mark(s) point at an exam that no longer exists. ', _n);
  END IF;

  -- Every sitting still resolves to at least one subject, so nothing was
  -- stranded by the drop.
  SELECT string_agg(e.id::text, ', ') INTO _txt
    FROM public.exams e
   WHERE NOT EXISTS (SELECT 1 FROM public.exam_subjects es WHERE es.exam_id = e.id);
  IF _txt IS NOT NULL THEN
    _fail := _fail || format('(FAIL) item 4: exams with no subject at all: %s. ', _txt);
  END IF;


  -- =================================================================
  -- ITEM 5 (G12) — role dispatch on can_upload_exam_marks, and the
  -- super-admin arm it must not have dropped.
  -- =================================================================

  SELECT p.prosrc INTO _txt
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'can_upload_exam_marks';

  IF _txt IS NULL THEN
    _fail := _fail || '(FAIL) item 5: can_upload_exam_marks does not exist. ';
  ELSE
    IF _txt NOT ILIKE '%active_membership_role()%' THEN
      _fail := _fail || '(FAIL) item 5: can_upload_exam_marks does not dispatch on the active membership role. ';
    END IF;
    -- has_role() carries a super-admin arm. Dispatching on membership role
    -- alone would silently revoke super-admin upload; it must be restated.
    IF _txt NOT ILIKE '%is_super_admin()%' THEN
      _fail := _fail || '(FAIL) item 5: can_upload_exam_marks dropped has_role()''s super-admin arm. ';
    END IF;
    -- The lock must still be read, or finalising stops meaning anything.
    IF _txt NOT ILIKE '%marks_locked%' THEN
      _fail := _fail || '(FAIL) item 5: can_upload_exam_marks no longer reads marks_locked, so item 2 cannot hold. ';
    END IF;
  END IF;


  -- =================================================================
  -- Report.
  -- =================================================================

  IF _fail <> '' THEN
    RAISE EXCEPTION 'CHUNK65_VERIFY — AT LEAST ONE CHECK FAILED: %', _fail;
  END IF;

  RAISE EXCEPTION 'CHUNK65_VERIFY_OK — all items passed; rolling back fixtures.';
END
$verify$;
