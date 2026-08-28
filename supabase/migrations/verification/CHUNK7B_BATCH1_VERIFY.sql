-- ---------------------------------------------------------------------
-- CHUNK 7B VERIFICATION — batch 1 (practice tables, question_records retired)
--
-- G11, every item seeds the rows it then measures. The three new tables are
-- empty in production, and "a teacher sees 0 rows" from an empty table is the
-- check that proved nothing in CHUNK66 item 8. Items 4-7 therefore INSERT as
-- owner first, so every zero below is a zero the fence produced.
--
-- G11, ground truth is captured from the OLD world, not from the new code.
-- Item 3's three question ids are the literal rows measured in
-- question_records before the migration dropped it, so the check cannot pass
-- by agreeing with itself.
--
-- Self-rolling-back: one implicit transaction ending in a deliberate RAISE,
-- which is what lets item 6 open a policy without production seeing the hole.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _demo  uuid := '00000000-0000-4000-8000-000000000001';

  _uid_student   uuid; _uid_teacher uuid; _uid_parent uuid;
  _uid_principal uuid; _uid_admin   uuid;
  _sid_student   uuid;

  _qrec_exists  int;  _upsert_fn int;                    -- 1
  _bad_cols     text;                                    -- 2
  _truth_q      uuid[]; _actual_q uuid[];                -- 3
  _q1 uuid; _q2 uuid;
  _own_bm bigint; _own_sk bigint; _own_ct bigint;        -- 4
  _t_bm bigint; _p_bm bigint; _pr_bm bigint; _a_bm bigint; -- 5
  _nc_before bigint; _nc_open bigint;                    -- 6
  _w_own bigint; _w_other bigint;                        -- 7
  _other_uid uuid;
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text; _r6 text; _r7 text;
BEGIN
  SELECT id INTO _uid_student   FROM auth.users WHERE email='arjun.mehta@wisdomcampus.com';
  SELECT id INTO _uid_teacher   FROM auth.users WHERE email='priya.sharma@wisdomcampus.com';
  SELECT id INTO _uid_parent    FROM auth.users WHERE email='mehta.parent@wisdomcampus.com';
  SELECT id INTO _uid_principal FROM auth.users WHERE email='principal@wisdomcampus.com';
  SELECT id INTO _uid_admin     FROM auth.users WHERE email='admin@wisdomcampus.com';
  SELECT id INTO _sid_student   FROM public.students WHERE user_id=_uid_student AND deleted_at IS NULL LIMIT 1;

  SELECT id INTO _q1 FROM public.question_bank WHERE is_active ORDER BY id LIMIT 1;
  SELECT id INTO _q2 FROM public.question_bank WHERE is_active ORDER BY id DESC LIMIT 1;

  ------------------------------------------------------------------
  -- 1. question_records is retired, and its writer with it
  ------------------------------------------------------------------
  SELECT count(*) INTO _qrec_exists FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='question_records';
  SELECT count(*) INTO _upsert_fn FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='_upsert_question_record';

  _r1 := 'question_records tables=' || _qrec_exists || ', _upsert_question_record=' || _upsert_fn
      || CASE WHEN _qrec_exists=0 AND _upsert_fn=0
              THEN ' — retired, and the 7 correct-only rows with it (PASS)'
              ELSE ' — the forbidden table or its writer survives (FAIL)' END;

  ------------------------------------------------------------------
  -- 2. Sweep the WHOLE schema for per-question correctness storage
  ------------------------------------------------------------------
  -- Not "did I remove the column I was thinking of" but "does any table
  -- anywhere still record, per question, that a student was right".
  -- A table qualifies as per-question if it carries a question id column.
  -- homework_answers is deliberately NOT excluded by name below; it is
  -- excluded by the doc's own separation rule. "Test and homework answers are
  -- school data; practice answers are private." A teacher-set assessment is
  -- allowed to record who got what right — that is the mark. The storage rule
  -- constrains PRACTICE.
  --
  -- This sweep found six columns on first run when the author expected two.
  -- The four practice-side ones are listed explicitly as the declared gap, so
  -- that a SEVENTH appearing later fails this item instead of blending in.
  SELECT string_agg(c.table_name || '.' || c.column_name, ', ' ORDER BY c.table_name, c.column_name)
    INTO _bad_cols
    FROM information_schema.columns c
   WHERE c.table_schema='public'
     AND c.column_name IN ('is_correct','correct_count','correct_index_chosen','was_correct','current_status','score')
     AND EXISTS (
       SELECT 1 FROM information_schema.columns q
        WHERE q.table_schema='public' AND q.table_name=c.table_name
          AND q.column_name IN ('question_id','bank_question_id')
     )
     -- school data, per the separation rule — not practice, not in scope
     AND c.table_name NOT IN ('homework_answers','test_answers');

  _r2 := 'practice-side per-question correctness still stored: ' || COALESCE(_bad_cols,'(none)')
      || CASE WHEN _bad_cols IS NULL THEN ' (PASS)'
              WHEN _bad_cols = 'battle_answers.is_correct, dpp_answers.is_correct,'
                            || ' question_attempts.is_correct, question_attempts.score,'
                            || ' recovery_assignment_questions.is_correct'
              THEN ' — KNOWN GAP, declared not fixed, and WIDER than first reported.'
                || ' question_attempts alone is read by 14 SECURITY DEFINER functions'
                || ' including the analytics engine (7C); dpp_answers and'
                || ' recovery_assignment_questions are 7C surfaces; battle_answers'
                || ' needs a ruling since §10.16 makes battles public effort.'
                || ' Batch 1 removed question_records only. Reported, not passed.'
              ELSE ' — an UNDECLARED practice correctness column exists (FAIL)' END;

  ------------------------------------------------------------------
  -- 3. The diverged mistakes were carried across, not lost
  ------------------------------------------------------------------
  -- Ground truth: the exact three (user, question) pairs that existed in
  -- question_records with current_status='wrong' and were absent from
  -- student_mistakes, measured on production before the migration ran.
  _truth_q := ARRAY[
    '2d25f736-e3ec-424f-8e2e-05f2751f2d4c'::uuid,
    'd7a0406f-8234-44cb-a747-8a9cdcbf312b'::uuid,
    '71fd7850-745a-4697-8747-483e72fc80b0'::uuid
  ];
  SELECT array_agg(sm.question_id ORDER BY sm.question_id) INTO _actual_q
    FROM public.student_mistakes sm
   WHERE sm.user_id='d1000003-0001-4000-8000-000000000001'::uuid
     AND sm.question_id = ANY(_truth_q);

  _r3 := 'mistakes carried into student_mistakes: '
      || COALESCE(array_length(_actual_q,1),0) || ' of 3'
      || CASE WHEN COALESCE(array_length(_actual_q,1),0)=3
              THEN ' — the two mistake books had diverged and no mistake was lost (PASS)'
              ELSE ' — dropping question_records LOST a real mistake (FAIL)' END;

  ------------------------------------------------------------------
  -- 4. Seed, then: the student sees exactly their own rows
  ------------------------------------------------------------------
  INSERT INTO public.practice_bookmarks (user_id, student_id, school_id, question_id)
       VALUES (_uid_student, _sid_student, _demo, _q1);
  INSERT INTO public.practice_skipped   (user_id, student_id, school_id, question_id)
       VALUES (_uid_student, _sid_student, _demo, _q2);
  INSERT INTO public.chapter_tally (user_id, student_id, school_id, attempted, correct)
       VALUES (_uid_student, _sid_student, _demo, 5, 3);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _own_bm FROM public.practice_bookmarks;
    SELECT count(*) INTO _own_sk FROM public.practice_skipped;
    SELECT count(*) INTO _own_ct FROM public.chapter_tally;
  RESET ROLE;

  _r4 := 'student sees bookmarks=' || _own_bm || ' skipped=' || _own_sk || ' tally=' || _own_ct
      || CASE WHEN _own_bm=1 AND _own_sk=1 AND _own_ct=1
              THEN ' — own practice rows readable (PASS)'
              ELSE ' — a student cannot read their own practice data (FAIL)' END;

  ------------------------------------------------------------------
  -- 5. Every other role sees ZERO — §10.8, no exceptions
  ------------------------------------------------------------------
  -- The rows seeded in item 4 are live and in these roles' own institution,
  -- so each zero below is the fence refusing, not an empty table.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _t_bm FROM public.practice_bookmarks;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_parent, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _p_bm FROM public.practice_bookmarks;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_principal, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _pr_bm FROM public.practice_bookmarks;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_admin, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _a_bm FROM public.practice_bookmarks;
  RESET ROLE;

  _r5 := 'bookmarks visible to teacher=' || _t_bm || ' parent=' || _p_bm
      || ' principal=' || _pr_bm || ' admin=' || _a_bm
      || CASE WHEN _t_bm=0 AND _p_bm=0 AND _pr_bm=0 AND _a_bm=0
              THEN ' — practice is student-only (PASS)'
              ELSE ' — a non-student role reads practice data (FAIL)' END;

  ------------------------------------------------------------------
  -- 6. Negative control — does item 5 actually catch a hole?
  ------------------------------------------------------------------
  _nc_before := _t_bm;
  CREATE POLICY practice_bookmarks_negctl ON public.practice_bookmarks
    FOR SELECT TO authenticated USING (true);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
    SELECT count(*) INTO _nc_open FROM public.practice_bookmarks;
  RESET ROLE;

  DROP POLICY practice_bookmarks_negctl ON public.practice_bookmarks;

  _r6 := 'teacher saw ' || _nc_before || ' fenced, ' || _nc_open || ' with a permissive SELECT policy added'
      || CASE WHEN _nc_before=0 AND _nc_open>0
              THEN ' — the check detects a real hole, so item 5''s zero is meaningful (PASS)'
              ELSE ' — opening the table changed nothing, so item 5 proves nothing (FAIL)' END;

  ------------------------------------------------------------------
  -- 7. Write path — own row writable, another student's refused
  ------------------------------------------------------------------
  SELECT u.id INTO _other_uid
    FROM auth.users u
    JOIN public.students s ON s.user_id=u.id AND s.school_id=_demo AND s.deleted_at IS NULL
   WHERE u.id <> _uid_student
   ORDER BY u.id LIMIT 1;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
    BEGIN
      DELETE FROM public.practice_bookmarks WHERE user_id=_uid_student;
      GET DIAGNOSTICS _w_own = ROW_COUNT;
    EXCEPTION WHEN others THEN _w_own := -1;
    END;
    BEGIN
      INSERT INTO public.practice_bookmarks (user_id, student_id, school_id, question_id)
           VALUES (_other_uid, NULL, _demo, _q1);
      GET DIAGNOSTICS _w_other = ROW_COUNT;
    EXCEPTION WHEN others THEN _w_other := 0;
    END;
  RESET ROLE;

  _r7 := 'student deleted own bookmark rows=' || _w_own
      || ', inserted a row owned by another student=' || _w_other
      || CASE WHEN _w_own=1 AND _w_other=0
              THEN ' — own writable, forging another student refused (PASS)'
              WHEN _w_own<>1 THEN ' — student cannot manage their own bookmark (FAIL)'
              ELSE ' — a student WROTE a row owned by someone else (FAIL)' END;

  RAISE EXCEPTION E'CHUNK7B_BATCH1\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n 6) %\n 7) %\n [all rolled back]',
    _r1, _r2, _r3, _r4, _r5, _r6, _r7;
END $verify$;
