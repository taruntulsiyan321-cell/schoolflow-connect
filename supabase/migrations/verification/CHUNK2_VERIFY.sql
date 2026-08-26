-- =====================================================================
-- CHUNK 2 — verification, all seven items.
--
-- SAFETY: creates a second institution and test structure, proves against it,
-- then RAISEs deliberately so every fixture rolls back. Nothing persists.
-- =====================================================================

DO $v$
DECLARE
  _out text := E'\n===== CHUNK 2 VERIFICATION =====\n';
  _ok  boolean := true;
  _schoolA uuid; _schoolB uuid;
  _cc12 uuid; _grp uuid;
  _secA uuid; _secB uuid;
  _subAcc uuid; _subBst uuid; _subEco uuid;
  _ssA1 uuid; _ssA2 uuid; _ssB1 uuid; _ssBfor uuid;
  _t1 uuid; _t2 uuid; _t3 uuid;
  _n int; _txt text; _ay date;
BEGIN
  SELECT id INTO _schoolA FROM public.schools ORDER BY created_at LIMIT 1;
  SELECT starts_on INTO _ay FROM public.academic_years
   WHERE school_id = _schoolA AND is_current LIMIT 1;

  SELECT cc.id INTO _cc12 FROM public.curriculum_classes cc WHERE cc.level = 12;
  SELECT id INTO _subAcc FROM public.curriculum_subjects
   WHERE curriculum_class_id = _cc12 AND name = 'Accountancy';
  SELECT id INTO _subBst FROM public.curriculum_subjects
   WHERE curriculum_class_id = _cc12 AND name = 'Business Studies';
  SELECT id INTO _subEco FROM public.curriculum_subjects
   WHERE curriculum_class_id = _cc12 AND name = 'Economics';

  -- =================================================================
  -- 1. TWO SECTIONS OF ONE CLASS WITH DIFFERENT SUBJECT LISTS
  -- =================================================================
  _out := _out || format('%s1. TWO SECTIONS OF ONE CLASS, DIFFERENT SUBJECTS%s', E'\n', E'\n');

  INSERT INTO public.class_groups (school_id, academic_year_id, curriculum_class_id, label)
  VALUES (_schoolA,
          (SELECT id FROM public.academic_years WHERE school_id = _schoolA AND is_current LIMIT 1),
          _cc12, 'ZZ Proof Class 12')
  RETURNING id INTO _grp;

  INSERT INTO public.classes (school_id, name, section, class_group_id, kind, is_active)
  VALUES (_schoolA, 'ZZ Proof Class 12', 'A', _grp, 'class', true) RETURNING id INTO _secA;
  INSERT INTO public.classes (school_id, name, section, class_group_id, kind, is_active)
  VALUES (_schoolA, 'ZZ Proof Class 12', 'B', _grp, 'class', true) RETURNING id INTO _secB;

  -- Section A studies Accountancy + Business Studies; Section B studies Economics.
  INSERT INTO public.section_subjects (school_id, section_id, curriculum_subject_id)
  VALUES (_schoolA, _secA, _subAcc) RETURNING id INTO _ssA1;
  INSERT INTO public.section_subjects (school_id, section_id, curriculum_subject_id)
  VALUES (_schoolA, _secA, _subBst) RETURNING id INTO _ssA2;
  INSERT INTO public.section_subjects (school_id, section_id, curriculum_subject_id)
  VALUES (_schoolA, _secB, _subEco) RETURNING id INTO _ssB1;

  SELECT string_agg(cs.name, ', ' ORDER BY cs.name) INTO _txt
    FROM public.section_subjects ss
    JOIN public.curriculum_subjects cs ON cs.id = ss.curriculum_subject_id
   WHERE ss.section_id = _secA;
  _out := _out || format('  section A subjects .................. %s%s', _txt, E'\n');
  IF _txt <> 'Accountancy, Business Studies' THEN _ok := false; END IF;

  SELECT string_agg(cs.name, ', ' ORDER BY cs.name) INTO _txt
    FROM public.section_subjects ss
    JOIN public.curriculum_subjects cs ON cs.id = ss.curriculum_subject_id
   WHERE ss.section_id = _secB;
  _out := _out || format('  section B subjects .................. %s%s', _txt, E'\n');
  IF _txt <> 'Economics' THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.classes WHERE class_group_id = _grp;
  _out := _out || format('  sections under one class group ..... %s   (expected 2)%s', _n, E'\n');
  IF _n <> 2 THEN _ok := false; END IF;

  -- =================================================================
  -- 2. THREE TEACHERS ON ONE SECTION-SUBJECT
  -- =================================================================
  _out := _out || format('%s2. THREE TEACHERS ON ONE SECTION-SUBJECT%s', E'\n', E'\n');

  INSERT INTO public.teachers (school_id, full_name, email)
  VALUES (_schoolA, 'ZZ Proof Teacher 1', 'zz1.proof@example.invalid') RETURNING id INTO _t1;
  INSERT INTO public.teachers (school_id, full_name, email)
  VALUES (_schoolA, 'ZZ Proof Teacher 2', 'zz2.proof@example.invalid') RETURNING id INTO _t2;
  INSERT INTO public.teachers (school_id, full_name, email)
  VALUES (_schoolA, 'ZZ Proof Teacher 3', 'zz3.proof@example.invalid') RETURNING id INTO _t3;

  INSERT INTO public.teacher_assignments (school_id, section_subject_id, teacher_id, is_primary, start_date)
  VALUES (_schoolA, _ssA1, _t1, true,  _ay),
         (_schoolA, _ssA1, _t2, false, _ay),
         (_schoolA, _ssA1, _t3, false, _ay);

  SELECT count(*), string_agg(t.full_name, ', ' ORDER BY t.full_name) INTO _n, _txt
    FROM public.teacher_assignments ta
    JOIN public.teachers t ON t.id = ta.teacher_id
   WHERE ta.section_subject_id = _ssA1 AND ta.end_date IS NULL;
  _out := _out || format('  teachers returned .................. %s   (expected 3)%s', _n, E'\n');
  _out := _out || format('  names .............................. %s%s', _txt, E'\n');
  IF _n <> 3 THEN _ok := false; END IF;

  -- =================================================================
  -- 3. END ONE ASSIGNMENT MID-YEAR, START ANOTHER — HISTORY PRESERVED
  -- =================================================================
  _out := _out || format('%s3. MID-YEAR HANDOVER%s', E'\n', E'\n');

  UPDATE public.teacher_assignments
     SET end_date = _ay + 120
   WHERE section_subject_id = _ssA1 AND teacher_id = _t1;

  -- The same teacher can be assigned again later: the partial unique index
  -- only forbids two OPEN assignments, not a second historical one.
  INSERT INTO public.teacher_assignments (school_id, section_subject_id, teacher_id, is_primary, start_date)
  VALUES (_schoolA, _ssA1, _t1, true, _ay + 121);

  SELECT count(*) INTO _n FROM public.teacher_assignments
   WHERE section_subject_id = _ssA1 AND teacher_id = _t1;
  _out := _out || format('  rows for that teacher .............. %s   (expected 2 — history kept, not overwritten)%s',
                         _n, E'\n');
  IF _n <> 2 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.teacher_assignments
   WHERE section_subject_id = _ssA1 AND end_date IS NOT NULL;
  _out := _out || format('  closed assignments ................. %s   (expected 1)%s', _n, E'\n');
  IF _n <> 1 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.teacher_assignments
   WHERE section_subject_id = _ssA1 AND end_date IS NULL;
  _out := _out || format('  open assignments ................... %s   (expected 3)%s', _n, E'\n');
  IF _n <> 3 THEN _ok := false; END IF;

  BEGIN
    INSERT INTO public.teacher_assignments (school_id, section_subject_id, teacher_id, start_date)
    VALUES (_schoolA, _ssA1, _t2, _ay);
    _out := _out || format('  duplicate OPEN assignment .......... ACCEPTED   (expected rejected)%s', E'\n');
    _ok := false;
  EXCEPTION WHEN others THEN
    _out := _out || format('  duplicate OPEN assignment .......... rejected%s', E'\n');
  END;

  -- =================================================================
  -- 4. HOMEWORK CANNOT ATTACH TO ANOTHER INSTITUTION'S SECTION-SUBJECT
  -- =================================================================
  _out := _out || format('%s4. CROSS-INSTITUTION ATTACHMENT%s', E'\n', E'\n');

  INSERT INTO public.schools (name, slug, is_active, board)
  VALUES ('ZZ Proof Institution B', 'zz-proof-inst-b', true, 'rbse') RETURNING id INTO _schoolB;

  INSERT INTO public.class_groups (school_id, curriculum_class_id, label)
  VALUES (_schoolB, _cc12, 'ZZ B Class 12') RETURNING id INTO _grp;
  INSERT INTO public.classes (school_id, name, section, class_group_id, kind, is_active)
  VALUES (_schoolB, 'ZZ B Class 12', 'A', _grp, 'class', true) RETURNING id INTO _secB;
  INSERT INTO public.section_subjects (school_id, section_id, curriculum_subject_id)
  VALUES (_schoolB, _secB, _subAcc) RETURNING id INTO _ssBfor;

  -- Institution A's homework naming institution B's section_subject.
  BEGIN
    INSERT INTO public.homework (school_id, class_id, title, subject, due_date, section_subject_id)
    VALUES (_schoolA, _secA, 'ZZ cross-tenant homework', 'Accountancy', current_date + 7, _ssBfor);
    _out := _out || format('  homework -> other institution ...... ACCEPTED   (expected rejected)%s', E'\n');
    _ok := false;
  EXCEPTION WHEN others THEN
    _out := _out || format('  homework -> other institution ...... rejected (composite FK)%s', E'\n');
  END;

  -- And a section_subject cannot name a section from another institution.
  BEGIN
    INSERT INTO public.section_subjects (school_id, section_id, curriculum_subject_id)
    VALUES (_schoolA, _secB, _subBst);
    _out := _out || format('  section_subject -> other inst ...... ACCEPTED   (expected rejected)%s', E'\n');
    _ok := false;
  EXCEPTION WHEN others THEN
    _out := _out || format('  section_subject -> other inst ...... rejected (trigger)%s', E'\n');
  END;

  -- The student-section constraint rejects at write time.
  BEGIN
    INSERT INTO public.attendance (school_id, student_id, class_id, date, status)
    VALUES (_schoolA,
            (SELECT id FROM public.students WHERE school_id = _schoolA AND class_id IS NOT NULL LIMIT 1),
            _secA, current_date, 'present');
    _out := _out || format('  attendance in wrong section ........ ACCEPTED   (expected rejected)%s', E'\n');
    _ok := false;
  EXCEPTION WHEN others THEN
    _out := _out || format('  attendance in wrong section ........ rejected (trigger)%s', E'\n');
  END;

  -- =================================================================
  -- 5. CHAPTERS HAVE STABLE IDS; NO TOPIC NAME IS USED FOR TRACKING
  -- =================================================================
  _out := _out || format('%s5. STABLE CHAPTER IDS%s', E'\n', E'\n');

  SELECT count(*) INTO _n FROM public.chapters;
  _out := _out || format('  chapters with stable uuid ids ...... %s%s', _n, E'\n');

  SELECT count(*) INTO _n FROM public.question_bank WHERE chapter_id IS NOT NULL;
  _out := _out || format('  questions keyed on chapter_id ...... %s of %s%s',
                         _n, (SELECT count(*) FROM public.question_bank), E'\n');
  IF _n = 0 THEN _ok := false; END IF;

  -- A question can only be placed in the tree if it says which class and
  -- subject it belongs to. 15 rows carry a chapter string but no class_level
  -- or subject, so there is nowhere to hang them; that is a pre-existing data
  -- gap, not a mapping failure. What must be zero is rows that had both and
  -- still did not map.
  SELECT count(*) INTO _n FROM public.question_bank
   WHERE chapter_id IS NULL AND btrim(coalesce(chapter, '')) <> ''
     AND class_level IS NOT NULL AND btrim(coalesce(subject, '')) <> '';
  _out := _out || format('  mappable questions left unmapped ... %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.question_bank
   WHERE chapter_id IS NULL AND btrim(coalesce(chapter, '')) <> ''
     AND (class_level IS NULL OR btrim(coalesce(subject, '')) = '');
  _out := _out || format('  unmappable (no class or subject) ... %s   (pre-existing data gap)%s', _n, E'\n');

  -- No topics table exists, so nothing downstream can key on a topic id or name.
  SELECT count(*) INTO _n FROM information_schema.tables
   WHERE table_schema = 'public' AND table_name = 'topics';
  _out := _out || format('  topics table ....................... %s   (expected 0 — chapter is the unit)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'topic_id';
  _out := _out || format('  topic_id columns anywhere .......... %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  -- =================================================================
  -- 6. NEAR-DUPLICATE CHAPTER NAMES
  -- =================================================================
  _out := _out || format('%s6. CHAPTER NAME FRAGMENTATION%s', E'\n', E'\n');

  SELECT count(DISTINCT chapter) INTO _n FROM public.question_bank
   WHERE btrim(coalesce(chapter, '')) <> '';
  _out := _out || format('  distinct chapter strings in bank ... %s%s', _n, E'\n');

  SELECT count(*) INTO _n FROM (
    SELECT class_level, btrim(subject) subj,
           regexp_replace(lower(translate(btrim(chapter), '’‘“”–—', '''''""--')),
                          '[^[:alnum:]]+', '', 'g') k
      FROM public.question_bank
     WHERE btrim(coalesce(chapter, '')) <> '' AND class_level IS NOT NULL
     GROUP BY 1, 2, 3 HAVING count(DISTINCT btrim(chapter)) > 1) t;
  _out := _out || format('  near-duplicate groups in source .... %s   (all typographic)%s', _n, E'\n');

  SELECT count(*) INTO _n FROM (
    SELECT cs.curriculum_class_id, cs.name,
           regexp_replace(lower(translate(btrim(ch.name), '’‘“”–—', '''''""--')),
                          '[^[:alnum:]]+', '', 'g') k
      FROM public.chapters ch
      JOIN public.curriculum_subjects cs ON cs.id = ch.curriculum_subject_id
     GROUP BY 1, 2, 3 HAVING count(*) > 1) t;
  _out := _out || format('  surviving in the seeded tree ....... %s   (expected 0 — merged)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM public.chapters WHERE sequence IS NOT NULL;
  _out := _out || format('  chapters with an invented sequence . %s   (expected 0 — G4)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  -- =================================================================
  -- 7. ALL 18 EXISTING FKs TO public.classes STILL RESOLVE
  -- =================================================================
  _out := _out || format('%s7. THE 18 FOREIGN KEYS TO public.classes%s', E'\n', E'\n');

  -- Counting is weaker than naming: check each of the original 18 referencing
  -- tables is still there, pointing at public.classes, and validated.
  SELECT count(*), string_agg(t.tbl, ', ') INTO _n, _txt
    FROM (VALUES ('academic_events'),('attendance'),('attendance_audit'),('attendance_locks'),
                 ('battles'),('chat_conversations'),('class_timetables'),('exams'),
                 ('homework'),('learning_resources'),('leave_requests'),('notices'),
                 ('school_calendar_events'),('students'),('teacher_classes'),
                 ('teacher_remarks'),('teachers'),('timetable_slots')) AS t(tbl)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_constraint k
      JOIN pg_class c ON c.oid = k.conrelid
     WHERE k.contype = 'f' AND k.confrelid = 'public.classes'::regclass
       AND k.convalidated AND c.relname = t.tbl);
  _out := _out || format('  of the original 18, missing ........ %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; _out := _out || format('    missing: %s%s', _txt, E'\n'); END IF;

  SELECT count(*) INTO _n FROM pg_constraint
   WHERE contype = 'f' AND confrelid = 'public.classes'::regclass AND convalidated;
  _out := _out || format('  total FKs to classes now ........... %s   (18 original + section_subjects.section_id)%s',
                         _n, E'\n');
  IF _n <> 19 THEN _ok := false; END IF;

  SELECT count(*) INTO _n FROM pg_constraint
   WHERE contype = 'f' AND confrelid = 'public.class_groups'::regclass;
  _out := _out || format('  FKs to the new class_groups ........ %s   (only classes.class_group_id)%s', _n, E'\n');

  SELECT count(*) INTO _n FROM public.classes WHERE class_group_id IS NULL;
  _out := _out || format('  sections without a class group ..... %s   (expected 0)%s', _n, E'\n');
  IF _n <> 0 THEN _ok := false; END IF;

  _out := _out || format('%s===== RESULT: %s =====%s', E'\n',
                         CASE WHEN _ok THEN 'ALL SEVEN VERIFIED' ELSE 'AT LEAST ONE CHECK FAILED' END, E'\n');
  _out := _out || 'Every fixture is being rolled back by the deliberate abort below.';
  RAISE EXCEPTION '%', _out;
END;
$v$;
