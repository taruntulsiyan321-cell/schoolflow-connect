-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY: weak means "worse than you usually do", and one wrong answer is not
-- ════════════════════════════════════════════════════════════════════════════
--
-- Run it:
--   psql "$DB" -f supabase/migrations/verification/CHUNK7F_WEAK_IS_RELATIVE_VERIFY.sql
--   (or POST the file to the Management API /database/query endpoint)
--
-- WHY THIS FILE EXISTS RATHER THAN A BEFORE/AFTER COUNT
--
-- The obvious check is "how many rows changed from weak to not weak". Measured
-- on production, that number is almost nothing: 202 weak before, 201 after. It
-- would read as a change that did nothing.
--
-- It is not. The cohort is bimodal — 203 chapter rows sit at EXACTLY 0%
-- accuracy with a mean of 18.7 attempts each, and 43 sit above 75%, with
-- almost nothing in between. Those 0% chapters are weak under any definition,
-- so the count cannot distinguish a fixed bar from a relative one.
--
-- So this file builds the cases the production data does not contain, and
-- asserts the BEHAVIOUR:
--
--   2  a strong student's 65% chapter IS weak         (a 60% bar misses it)
--   3  a struggling student's 55% chapter is NOT weak (a 60% bar flags it)
--
-- Those two are the whole claim. One of them fails under any fixed threshold,
-- whatever value is chosen, which is what makes them a real test of "dynamic".
--
-- WRITES ARE ROLLED BACK. Every fixture here is synthetic and must be: the
-- point is to test shapes production does not hold.
-- ════════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  _report  text := '';
  _fail    text := '';
  _pass    int := 0;
  _uid     uuid;
  _sid     uuid;
  _school  uuid;
  _psid    uuid;
  _i       int;
  _r       record;
  _min     int;
  _margin  numeric;
BEGIN
  BEGIN
    SELECT st.user_id, st.id, st.school_id INTO _uid, _sid, _school
      FROM public.students st WHERE st.school_id IS NOT NULL LIMIT 1;
    IF _uid IS NULL THEN
      RAISE EXCEPTION 'NO FIXTURE: no student with a school. NOT a pass.';
    END IF;

    _min    := public._recovery_const('WEAK_MIN_ATTEMPTS')::int;
    _margin := public._recovery_const('WEAK_MARGIN_POINTS')::numeric;

    -- Clear this student's graded history so the baseline is the fixture's,
    -- not production's. Rolled back with everything else.
    DELETE FROM public.question_attempts WHERE user_id = _uid;
    DELETE FROM public.student_mistakes  WHERE user_id = _uid AND source = 'test';

    ----------------------------------------------------------------------
    -- 1. ONE WRONG ANSWER OUT OF TWO IS NOT A WEAKNESS.
    --    The old floor was attempts >= 2, so 1 of 2 was 50% and therefore
    --    weak under a 60% bar. This is the rule stated in the product brief.
    ----------------------------------------------------------------------
    INSERT INTO public.practice_sessions (user_id, student_id, school_id, subject, chapter)
    VALUES (_uid, _sid, _school, 'Mathematics', 'Thin Chapter') RETURNING id INTO _psid;

    INSERT INTO public.question_attempts
        (user_id, school_id, session_id, is_correct, skipped, generated_question, correct_answer)
      VALUES (_uid, _school, _psid, true,  false, '{"q": "weak probe"}'::jsonb, '{"a": 0}'::jsonb),
             (_uid, _school, _psid, false, false, '{"q": "weak probe"}'::jsonb, '{"a": 0}'::jsonb);

    SELECT * INTO _r FROM public._weak_topics_for_user(_uid) w
     WHERE w.chapter = 'Thin Chapter';

    IF _r.chapter IS NULL THEN
      _fail := _fail || '(FAIL) 1: the chapter vanished entirely — "not enough evidence" must still be reported, not dropped. ';
    ELSIF _r.attempts <> 2 OR _r.correct <> 1 THEN
      -- The fixture itself is asserted. An earlier version of this file was
      -- rewritten by a careless regex into ONE attempt, and the item passed
      -- while measuring 0 of 1 — the exact rule it exists to test never ran.
      _fail := _fail || format('(FAIL) 1: the fixture is wrong — expected 1 correct of 2 attempts, got %s of %s. ',
        _r.correct, _r.attempts);
    ELSIF _r.is_weak THEN
      _fail := _fail || format('(FAIL) 1: one wrong answer out of two was called weak (accuracy %s, attempts %s). ',
        _r.accuracy, _r.attempts);
    ELSIF NOT _r.thin THEN
      _fail := _fail || format('(FAIL) 1: two attempts should be reported thin (min is %s), thin=%s. ', _min, _r.thin);
    ELSE
      _pass := _pass + 1;
      _report := _report || format(
        '(PASS) 1: one wrong of two is NOT weak — reported thin at %s%% on %s attempt(s), below the floor of %s.',
        _r.accuracy, _r.attempts, _min) || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 2. A STRONG STUDENT'S 65% CHAPTER IS WEAK.
    --    A fixed 60% bar cannot see this, at any value that also satisfies
    --    item 3. Baseline: 90% over 40 attempts, then one chapter at 65%.
    ----------------------------------------------------------------------
    DELETE FROM public.question_attempts WHERE user_id = _uid;

    INSERT INTO public.practice_sessions (user_id, student_id, school_id, subject, chapter)
    VALUES (_uid, _sid, _school, 'Mathematics', 'Strong Baseline') RETURNING id INTO _psid;
    FOR _i IN 1 .. 40 LOOP
      INSERT INTO public.question_attempts
        (user_id, school_id, session_id, is_correct, skipped, generated_question, correct_answer)
      VALUES (_uid, _school, _psid, _i <= 36, false, '{"q": "weak probe"}'::jsonb, '{"a": 0}'::jsonb);          -- 36/40 = 90%
    END LOOP;

    INSERT INTO public.practice_sessions (user_id, student_id, school_id, subject, chapter)
    VALUES (_uid, _sid, _school, 'Mathematics', 'The Gap') RETURNING id INTO _psid;
    FOR _i IN 1 .. 20 LOOP
      INSERT INTO public.question_attempts
        (user_id, school_id, session_id, is_correct, skipped, generated_question, correct_answer)
      VALUES (_uid, _school, _psid, _i <= 13, false, '{"q": "weak probe"}'::jsonb, '{"a": 0}'::jsonb);          -- 13/20 = 65%
    END LOOP;

    SELECT * INTO _r FROM public._weak_topics_for_user(_uid) w WHERE w.chapter = 'The Gap';

    IF _r.chapter IS NULL THEN
      _fail := _fail || '(FAIL) 2: the 65% chapter was not returned at all. ';
    ELSIF NOT _r.is_weak THEN
      _fail := _fail || format('(FAIL) 2: a 65%% chapter for a student whose baseline is %s%% was NOT called weak. A fixed 60%% bar would also miss it — this is the case that proves the threshold moved. ',
        _r.baseline_accuracy);
    ELSE
      _pass := _pass + 1;
      _report := _report || format(
        '(PASS) 2: 65%% IS weak for a student at %s%% — a fixed 60%% bar would have called it fine.',
        _r.baseline_accuracy) || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 3. A STRUGGLING STUDENT'S 55% CHAPTER IS NOT WEAK.
    --    The mirror case, and the reason item 2 cannot be satisfied by simply
    --    lowering the fixed bar. Baseline ~50%, one chapter at 55%.
    ----------------------------------------------------------------------
    DELETE FROM public.question_attempts WHERE user_id = _uid;

    INSERT INTO public.practice_sessions (user_id, student_id, school_id, subject, chapter)
    VALUES (_uid, _sid, _school, 'Mathematics', 'Low Baseline') RETURNING id INTO _psid;
    FOR _i IN 1 .. 40 LOOP
      INSERT INTO public.question_attempts
        (user_id, school_id, session_id, is_correct, skipped, generated_question, correct_answer)
      VALUES (_uid, _school, _psid, _i <= 19, false, '{"q": "weak probe"}'::jsonb, '{"a": 0}'::jsonb);          -- 19/40 = 47.5%
    END LOOP;

    INSERT INTO public.practice_sessions (user_id, student_id, school_id, subject, chapter)
    VALUES (_uid, _sid, _school, 'Mathematics', 'Their Best') RETURNING id INTO _psid;
    FOR _i IN 1 .. 20 LOOP
      INSERT INTO public.question_attempts
        (user_id, school_id, session_id, is_correct, skipped, generated_question, correct_answer)
      VALUES (_uid, _school, _psid, _i <= 11, false, '{"q": "weak probe"}'::jsonb, '{"a": 0}'::jsonb);          -- 11/20 = 55%
    END LOOP;

    SELECT * INTO _r FROM public._weak_topics_for_user(_uid) w WHERE w.chapter = 'Their Best';

    IF _r.chapter IS NULL THEN
      _fail := _fail || '(FAIL) 3: the 55% chapter was not returned at all. ';
    ELSIF _r.is_weak THEN
      _fail := _fail || format('(FAIL) 3: a 55%% chapter was called weak for a student whose baseline is %s%% — it is one of their BEST. A fixed 60%% bar makes exactly this mistake. ',
        _r.baseline_accuracy);
    ELSE
      _pass := _pass + 1;
      _report := _report || format(
        '(PASS) 3: 55%% is NOT weak for a student at %s%% — it is above their own average, and a fixed 60%% bar would have flagged it.',
        _r.baseline_accuracy) || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 4. SKIPS ARE NOT WRONG ANSWERS.
    --    rpc_record_question_attempt forces is_correct false on a skip, so
    --    leaving them in the denominator silently lowered every chapter a
    --    student skipped in. 241 such attempts exist in production.
    ----------------------------------------------------------------------
    DELETE FROM public.question_attempts WHERE user_id = _uid;

    INSERT INTO public.practice_sessions (user_id, student_id, school_id, subject, chapter)
    VALUES (_uid, _sid, _school, 'Mathematics', 'Skipped Half') RETURNING id INTO _psid;
    FOR _i IN 1 .. 10 LOOP
      INSERT INTO public.question_attempts
        (user_id, school_id, session_id, is_correct, skipped, generated_question, correct_answer)
      VALUES (_uid, _school, _psid, true, false, '{"q": "weak probe"}'::jsonb, '{"a": 0}'::jsonb);              -- 10 answered, all right
    END LOOP;
    FOR _i IN 1 .. 10 LOOP
      INSERT INTO public.question_attempts
        (user_id, school_id, session_id, is_correct, skipped, generated_question, correct_answer)
      VALUES (_uid, _school, _psid, false, true, '{"q": "weak probe"}'::jsonb, '{"a": 0}'::jsonb);              -- 10 skipped
    END LOOP;

    SELECT * INTO _r FROM public._weak_topics_for_user(_uid) w WHERE w.chapter = 'Skipped Half';

    IF _r.attempts <> 10 OR _r.accuracy <> 100 THEN
      _fail := _fail || format('(FAIL) 4: ten right and ten skipped read as %s attempt(s) at %s%%; skips are being counted as wrong answers. ',
        _r.attempts, _r.accuracy);
    ELSE
      _pass := _pass + 1;
      _report := _report || '(PASS) 4: ten right and ten skipped reads 10 attempts at 100% — a skip is not a wrong answer.' || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 5. A TEST-ONLY CHAPTER IS THIN, NOT 0%.
    --    Only a test's WRONG answers survive submission, so it can say a
    --    chapter was missed but not how often it was right. The old body
    --    emitted "0 correct of N", which put 200 of its 202 weak rows on the
    --    list at a fabricated zero.
    ----------------------------------------------------------------------
    INSERT INTO public.student_mistakes
      (user_id, student_id, school_id, subject, chapter, source, status, question_text, times_wrong, last_wrong_at)
    VALUES (_uid, _sid, _school, 'Science', 'Test Only Chapter', 'test', 'open',
            'weak probe — rolled back', 1, now());

    SELECT * INTO _r FROM public._weak_topics_for_user(_uid) w WHERE w.chapter = 'Test Only Chapter';

    IF _r.chapter IS NULL THEN
      _fail := _fail || '(FAIL) 5: a chapter a test flagged disappeared entirely. ';
    ELSIF _r.is_weak THEN
      _fail := _fail || '(FAIL) 5: a test-only chapter was called weak on a fabricated accuracy — nobody measured how often this student got it right. ';
    ELSIF NOT _r.thin THEN
      _fail := _fail || '(FAIL) 5: a test-only chapter must be reported thin, since there is no denominator. ';
    ELSE
      _pass := _pass + 1;
      _report := _report || '(PASS) 5: a chapter only a test flagged is reported thin — surfaced, but never given an accuracy nobody measured.' || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 6. POSITIVE CONTROL — can is_weak ever be true at all?
    --
    -- Items 1, 3 and 5 all assert is_weak is FALSE. They would every one of
    -- them pass against a function that hardcoded false. Item 2 is the
    -- counterweight; this makes the requirement explicit and independent.
    ----------------------------------------------------------------------
    DELETE FROM public.question_attempts WHERE user_id = _uid;

    INSERT INTO public.practice_sessions (user_id, student_id, school_id, subject, chapter)
    VALUES (_uid, _sid, _school, 'Mathematics', 'Control Good') RETURNING id INTO _psid;
    FOR _i IN 1 .. 20 LOOP
      INSERT INTO public.question_attempts
        (user_id, school_id, session_id, is_correct, skipped, generated_question, correct_answer)
      VALUES (_uid, _school, _psid, true, false, '{"q": "weak probe"}'::jsonb, '{"a": 0}'::jsonb);
    END LOOP;

    INSERT INTO public.practice_sessions (user_id, student_id, school_id, subject, chapter)
    VALUES (_uid, _sid, _school, 'Mathematics', 'Control Bad') RETURNING id INTO _psid;
    FOR _i IN 1 .. 20 LOOP
      INSERT INTO public.question_attempts
        (user_id, school_id, session_id, is_correct, skipped, generated_question, correct_answer)
      VALUES (_uid, _school, _psid, false, false, '{"q": "weak probe"}'::jsonb, '{"a": 0}'::jsonb);
    END LOOP;

    SELECT count(*)::int INTO _i
      FROM public._weak_topics_for_user(_uid) w
     WHERE w.chapter = 'Control Bad' AND w.is_weak;

    IF _i <> 1 THEN
      _fail := _fail || '(FAIL) 6: POSITIVE CONTROL BROKEN — a chapter at 0% against a baseline of 50% was not called weak, so items 1, 3 and 5 prove nothing. ';
    ELSE
      _pass := _pass + 1;
      _report := _report || '(PASS) 6: positive control — 0% against a 50% baseline IS weak, so the false verdicts above are real verdicts.' || E'\n';
    END IF;

    ----------------------------------------------------------------------
    IF _fail <> '' THEN
      _report := _report || format('════ %s of 6 PASSED ════', _pass) || E'\n';
      _report := _report || 'VERIFICATION FAILED: ' || _fail;
    ELSE
      _report := _report || '════ ALL 6 CHECKS PASSED ════' || E'\n';
    END IF;

    RAISE EXCEPTION 'ROLLBACK_AFTER_PROOF';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ROLLBACK_AFTER_PROOF' THEN
        _report := _report || 'probe writes rolled back; the results above stand.';
      ELSE
        RAISE;
      END IF;
  END;

  RAISE EXCEPTION E'\n%', _report;
END $verify$;
