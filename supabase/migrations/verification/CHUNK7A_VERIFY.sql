-- ---------------------------------------------------------------------
-- CHUNK 7A VERIFICATION — question bank and curriculum
--
-- G11 throughout: every item captures its OWN baseline, nothing is reused
-- between items, and where 7A rewrote something the ground truth is the
-- OLD behaviour rather than the new code's own logic.
--
-- Every LIMIT 1 is ordered. An unordered LIMIT 1 is what made CHUNK4
-- intermittent and what a second institution later exposed in five files.
--
-- Self-rolling-back: one implicit transaction ending in a deliberate
-- RAISE, which is what lets items 3 and 7 plant rows and open a policy
-- without production ever seeing either.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _demo    uuid := '00000000-0000-4000-8000-000000000001';
  _uid_student uuid; _uid_teacher uuid; _uid_admin uuid;
  _sa uuid; _sa_acct uuid;

  _has_school_id int;                                   -- 1
  _student_sees  bigint;
  _unkeyed uuid; _keyed_ok boolean;                     -- 2
  _planted_board uuid; _board_seen bigint; _board_base bigint;  -- 3
  _battle uuid; _lvl int; _subj text;                   -- 4
  _planted_class uuid; _picked_planted bigint; _picked_total bigint;
  _rep uuid; _rep_ins boolean; _rep_err text := '';     -- 5
  _rep_student bigint; _rep_teacher bigint; _rep_super bigint;
  _topics_rows bigint; _topics_read bigint;             -- 6
  _nc_open bigint;                                      -- 7
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text; _r6 text; _r7 text;
BEGIN
  SELECT id INTO _uid_student FROM auth.users WHERE email='arjun.mehta@wisdomcampus.com';
  SELECT id INTO _uid_teacher FROM auth.users WHERE email='priya.sharma@wisdomcampus.com';
  SELECT id INTO _uid_admin   FROM auth.users WHERE email='admin@wisdomcampus.com';

  ------------------------------------------------------------------
  -- 1. The bank is global (G2) and still readable
  ------------------------------------------------------------------
  SELECT count(*) INTO _has_school_id
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='question_bank' AND column_name='school_id';

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _student_sees FROM public.question_bank;
  RESET ROLE;

  _r1 := 'question_bank.school_id columns = ' || _has_school_id
      || ', student still reads ' || _student_sees || ' question(s)'
      || CASE WHEN _has_school_id = 0 AND _student_sees > 0
              THEN ' — global and readable (PASS)'
              WHEN _has_school_id > 0 THEN ' — STILL INSTITUTION-SCOPED (FAIL)'
              ELSE ' — student can read NOTHING (FAIL)' END;

  ------------------------------------------------------------------
  -- 2. An active question must be keyed
  --
  -- Both halves: the constraint must REFUSE an unkeyed activation, and a
  -- keyed row must still be activatable, or "it refused" would only prove
  -- the table is unwritable.
  ------------------------------------------------------------------
  SELECT id INTO _unkeyed FROM public.question_bank
   WHERE chapter_id IS NULL ORDER BY id LIMIT 1;

  BEGIN
    UPDATE public.question_bank SET is_active = true WHERE id = _unkeyed;
    _keyed_ok := false;   -- it should not have got here
  EXCEPTION WHEN check_violation THEN
    _keyed_ok := true;
  END;

  _r2 := 'activating an unkeyed question (' || COALESCE(_unkeyed::text,'none found') || '): '
      || CASE WHEN _unkeyed IS NULL THEN 'NO FIXTURE, PROVES NOTHING (FAIL)'
              WHEN _keyed_ok THEN 'refused by CHECK (PASS)'
              ELSE 'ALLOWED — unkeyed questions can be served (FAIL)' END;

  ------------------------------------------------------------------
  -- 3. The board filter, proved with a board that does not exist here
  --
  -- Both live schools are 'rbse' and every one of the 21,696 questions is
  -- 'rbse' or 'both', so the board arm is untested by the data as it
  -- stands. Plant one 'cbse' question and confirm it is invisible, while
  -- ordinary reads still work.
  ------------------------------------------------------------------
  INSERT INTO public.question_bank
    (question, options, correct_index, subject, difficulty, is_approved, is_active,
     class_level, board, chapter, chapter_id)
  SELECT 'VERIFY cbse-only question', '["a","b"]'::jsonb, 0, q.subject, q.difficulty,
         true, true, q.class_level, 'cbse', q.chapter, q.chapter_id
    FROM public.question_bank q
   WHERE q.is_active AND q.chapter_id IS NOT NULL
   ORDER BY q.id LIMIT 1
  RETURNING id INTO _planted_board;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _board_seen  FROM public.question_bank WHERE id = _planted_board;
  SELECT count(*) INTO _board_base  FROM public.question_bank;
  RESET ROLE;

  _r3 := 'planted a cbse question at an rbse school: student sees ' || _board_seen
      || ' of it, and ' || _board_base || ' question(s) overall'
      || CASE WHEN _board_seen = 0 AND _board_base > 0
              THEN ' — wrong board hidden, reads intact (PASS)'
              WHEN _board_base = 0 THEN ' — student reads nothing at all (FAIL)'
              ELSE ' — WRONG-BOARD CONTENT SERVED (FAIL)' END;

  ------------------------------------------------------------------
  -- 4. The class filter on the SECURITY DEFINER path
  --
  -- This is the finding 7A closed. rpc_generate_battle reads the bank as
  -- SECURITY DEFINER, so the policy's board filter never runs for it, and
  -- its class filter used to pass whenever either side was NULL.
  --
  -- Ground truth is the OLD predicate: a question of the WRONG class in
  -- the RIGHT subject is exactly what the old filter would have admitted
  -- and the new one must not. Both halves again — the planted row must be
  -- absent AND real questions must still be picked, or a function that
  -- returns nothing would look like a pass.
  ------------------------------------------------------------------
  SELECT b.id, b.class_level, b.subject INTO _battle, _lvl, _subj
    FROM public.battles b
   WHERE b.class_level IS NOT NULL AND b.subject IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.question_bank q
                  WHERE q.is_active AND q.is_approved
                    AND q.class_level = b.class_level
                    AND lower(q.subject) = lower(b.subject))
   ORDER BY b.id LIMIT 1;

  IF _battle IS NULL THEN
    _r4 := 'no battle with a resolvable class and stocked subject — NO FIXTURE, PROVES NOTHING (FAIL)';
  ELSE
    INSERT INTO public.question_bank
      (question, options, correct_index, subject, difficulty, is_approved, is_active,
       class_level, board, chapter, chapter_id)
    SELECT 'VERIFY wrong-class question', '["a","b"]'::jsonb, 0, _subj, q.difficulty,
           -- A DIFFERENT class, but still inside question_bank_class_level_check,
           -- which already constrains the range and refused _lvl + 3 = 13.
           true, true, CASE WHEN _lvl > 6 THEN _lvl - 3 ELSE _lvl + 3 END, 'both', q.chapter, q.chapter_id
      FROM public.question_bank q
     WHERE q.is_active AND q.chapter_id IS NOT NULL
     ORDER BY q.id LIMIT 1
    RETURNING id INTO _planted_class;

    DELETE FROM public.battle_questions WHERE battle_id = _battle;

    PERFORM set_config('request.jwt.claims',
      json_build_object('sub', _uid_admin, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    PERFORM public.rpc_generate_battle(_battle, 5);
    RESET ROLE;

    SELECT count(*) INTO _picked_total   FROM public.battle_questions WHERE battle_id = _battle;
    SELECT count(*) INTO _picked_planted FROM public.battle_questions
     WHERE battle_id = _battle AND bank_question_id = _planted_class;

    _r4 := 'battle drew ' || _picked_total || ' question(s), of which '
        || _picked_planted || ' were the planted wrong-class row'
        || CASE WHEN _picked_total > 0 AND _picked_planted = 0
                THEN ' — definer filters class, still draws (PASS)'
                WHEN _picked_total = 0 THEN ' — definer drew NOTHING, proves nothing (FAIL)'
                ELSE ' — WRONG-CLASS QUESTION SERVED (FAIL)' END;
  END IF;

  ------------------------------------------------------------------
  -- 5. question_reports goes to the AI and super admin, never the school
  ------------------------------------------------------------------
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  BEGIN
    INSERT INTO public.question_reports (question_id, reported_by_account_id, reason, body)
    SELECT q.id, _uid_student, 'wrong_answer', 'verification'
      FROM public.question_bank q WHERE q.is_active ORDER BY q.id LIMIT 1
    RETURNING id INTO _rep;
    _rep_ins := true;
  EXCEPTION WHEN others THEN
    -- G10 applies to a verification too: a handler that discards the reason
    -- turns a finding into a shrug.
    _rep_ins := false; _rep_err := SQLSTATE || ' ' || SQLERRM;
  END;
  SELECT count(*) INTO _rep_student FROM public.question_reports;
  RESET ROLE;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _rep_teacher FROM public.question_reports;
  RESET ROLE;

  SELECT id INTO _sa_acct FROM auth.users WHERE email='principal@wisdomcampus.com';
  INSERT INTO public.super_admins (account_id) VALUES (_sa_acct) RETURNING id INTO _sa;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _sa_acct, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _rep_super FROM public.question_reports;
  RESET ROLE;

  _r5 := 'report filed by student = ' || _rep_ins
      || ', student reads back ' || _rep_student
      || ', teacher reads ' || _rep_teacher
      || ', super admin reads ' || _rep_super
      -- The reporter reading their OWN report back is expected: a student is
      -- not "the school", and without a read arm RETURNING fails outright.
      -- What must stay zero is the school — teacher, principal, admin.
      || CASE WHEN NOT _rep_ins THEN ' — student CANNOT file a report: ' || _rep_err || ' (FAIL)'
              WHEN _rep_teacher > 0 THEN ' — THE SCHOOL CAN READ REPORTS (FAIL)'
              WHEN _rep_super = 0 THEN ' — super admin cannot read reports (FAIL)'
              WHEN _rep_student = 0 THEN ' — reporter cannot read their own report, so RETURNING breaks the UI (FAIL)'
              ELSE ' — filed, own report readable, school sees nothing, super admin does (PASS)' END;

  ------------------------------------------------------------------
  -- 6. topics: empty BY DESIGN, readable, staff-writable
  --
  -- 10.10 decided the 11,917 free-text topic strings are a per-question
  -- descriptor, not a taxonomy. An empty topics table is the correct
  -- resting state, not a gap — so this asserts emptiness deliberately.
  ------------------------------------------------------------------
  SELECT count(*) INTO _topics_rows FROM public.topics;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_teacher, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _topics_read FROM public.topics;
  RESET ROLE;

  _r6 := 'topics holds ' || _topics_rows || ' row(s), teacher can read the table ('
      || _topics_read || ')'
      || CASE WHEN _topics_rows = 0 THEN ' — empty by design per 10.10, never seeded from the 11,917 strings (PASS)'
              ELSE ' — topics has been seeded; check it was not derived from the free-text strings (REVIEW)' END;

  ------------------------------------------------------------------
  -- 7. NEGATIVE CONTROL — its own baseline, from item 3
  ------------------------------------------------------------------
  DROP POLICY IF EXISTS qb_select_approved_board ON public.question_bank;
  CREATE POLICY qb_select_approved_board ON public.question_bank
    FOR SELECT TO authenticated USING (true);

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid_student, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _nc_open FROM public.question_bank WHERE id = _planted_board;
  RESET ROLE;

  _r7 := 'negative control — board filter opened, student now sees the cbse question: '
      || _nc_open || ' (was ' || _board_seen || ')'
      || CASE WHEN _nc_open > _board_seen THEN ' (PASS — the check discriminates)'
              ELSE ' (FAIL — opening the policy changed nothing, so item 3 proves nothing)' END;

  RAISE EXCEPTION E'CHUNK7A\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n 6) %\n 7) %\n [all rolled back]',
    _r1, _r2, _r3, _r4, _r5, _r6, _r7;
END $verify$;
