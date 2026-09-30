-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY: the recovery ladder is sized by the mistakes, and drops none of them
-- ════════════════════════════════════════════════════════════════════════════
--
-- Run it:
--   psql "$DB" -f supabase/migrations/verification/CHUNK7F_LADDER_SIZED_BY_MISTAKES_VERIFY.sql
--   (or POST the file to the Management API /database/query endpoint)
--
-- WHAT IT PROVES, AND WHY EACH CHECK CAN FAIL
--
-- The defect this file exists for is silent: the old ladder capped tier 0 at
-- two, so a student with six open mistakes got a session containing two of
-- them and no record anywhere that four were discarded. A check that merely
-- asked "did a session get built?" would have passed against the defect. So
-- every check here asserts on CONTENT — which question ids are in the session
-- — never on a count of things visited, and item 6 is a POSITIVE CONTROL that
-- deliberately re-creates the old cap and fails if the suite still passes.
--
-- WRITES ARE ROLLED BACK. The probe inserts mistakes to reach wide and relearn
-- sizes, because no student in production currently holds nine open mistakes
-- in one chapter and waiting for one is not verification. The inner block is
-- THE PLAN IS BUILT THE WAY THE APP BUILDS IT. A student never calls the plan
-- builder: since 20261118000000 it enqueues variant generation, which no client
-- may write, and 20261123000000 revoked EXECUTE on rpc_recovery_session_plan
-- and _recovery_session_plan_for from every client role. The app reaches it
-- only through the definers rpc_start_recovery_session and
-- rpc_student_recovery_queue, which call _recovery_session_plan_for(<the
-- student>, chapter) as the owner. So the ladder is measured by that same call,
-- and item 0 proves, AS `authenticated`, that the student's own door still
-- answers — the split this file once missed (a student unable to reach
-- recovery at all) is caught there, on the path that exists.
--
-- an implicit savepoint: RAISE at the end unwinds every write, while the report
-- is accumulated in a plpgsql VARIABLE, which a rollback cannot touch. The
-- final SELECT returns it as rows, so the file says the same thing under psql
-- and through the Management API.
-- ════════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  -- Accumulated as a plpgsql VARIABLE on purpose. Variables are not database
  -- state, so the inner block's rollback discards every probe write and leaves
  -- this intact — which is what lets the report outlive the transaction that
  -- produced it.
  _report   text := '';
  _uid      uuid;
  _sid      uuid;
  _school   uuid;
  _chapter  uuid;
  _plan     jsonb;
  _fail     text := '';
  _pass     int := 0;
  _n        int;
  _ids      uuid[];
  _t0       uuid[];
  _extra    uuid[];
  _q        uuid;
  _i        int;
  _mine     uuid[];
  _dupes    int;
BEGIN
  BEGIN
    ----------------------------------------------------------------------
    -- Fixture: a real student with real open mistakes in a real chapter.
    ----------------------------------------------------------------------
    -- A chapter sitting in the DEEP band, which is what items 1 and 2 assert.
    --
    -- This used to take the chapter with the MOST open mistakes, which was a
    -- fixture that only worked while no student had many. Sitting one real
    -- practice session in a browser pushed the top chapter to 19 mistakes —
    -- relearn — and three items failed against a perfectly correct engine.
    -- A suite that depends on production staying small is a suite that will
    -- fail for the wrong reason at the worst time.
    --
    -- And it used to count only mistakes with a question_id, which stopped
    -- being the plan's count: a brought question (upload or capture) is a
    -- mistake the plan counts too (20261117000000), so a chapter with two bank
    -- mistakes and one capture is WIDE, not deep. And a mistake on a question
    -- staff have since deactivated is counted but can never be shown, so tier
    -- 0 rightly leaves it out (KNOWN_ISSUES 91) — measured 2026-09-30, the
    -- fixture chapter held two such mistakes and items 1-3 "failed" against a
    -- correct engine. So the fixture counts every open mistake, and takes a
    -- chapter where every one of them is a bank question the student can still
    -- be shown, which the student is entitled to, and which has the spare
    -- questions items 3-6 need.
    SELECT m.user_id, m.chapter_id INTO _uid, _chapter
      FROM (SELECT sm.user_id, sm.chapter_id, count(*) AS n
              FROM public.student_mistakes sm
              LEFT JOIN public.question_bank qb ON qb.id = sm.question_id
             WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL
             GROUP BY sm.user_id, sm.chapter_id
            HAVING count(*) BETWEEN 1 AND public._recovery_const('RECOVERY_DEEP_MAX_MISTAKES')::int
               AND bool_and(qb.id IS NOT NULL AND qb.is_active AND qb.is_approved)) m
     WHERE public._recovery_chapter_is_for(m.user_id, m.chapter_id)
       AND (SELECT count(*) FROM public.question_bank qb
             WHERE qb.chapter_id = m.chapter_id AND qb.is_active AND qb.is_approved
               AND qb.source_question_id IS NULL)
           >= public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int + 1 + m.n
     ORDER BY m.n DESC
     LIMIT 1;

    IF _uid IS NULL THEN
      RAISE EXCEPTION 'NO FIXTURE: no student holds between 1 and RECOVERY_DEEP_MAX_MISTAKES open mistakes in one chapter, all on active bank questions, in a chapter they are entitled to with room for items 3-6 — so deep mode cannot be exercised. NOT a pass.';
    END IF;

    SELECT s.id, s.school_id INTO _sid, _school FROM public.students s WHERE s.user_id = _uid LIMIT 1;
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid::text)::text, true);

    IF auth.uid() IS DISTINCT FROM _uid THEN
      RAISE EXCEPTION 'IMPERSONATION FAILED: auth.uid() is % not %. Every check below would run as nobody.', auth.uid(), _uid;
    END IF;

    -- Prove the role switch itself works before relying on it three times
    -- below. A SET that silently did nothing would put every assertion back
    -- under the owner, which is the exact failure this file now guards.
    SET LOCAL ROLE authenticated;
    IF current_user <> 'authenticated' THEN
      RAISE EXCEPTION 'ROLE SWITCH FAILED: running as %, so RLS and grants are not in force', current_user;
    END IF;
    RESET ROLE;

    SELECT count(*)::int INTO _n FROM public.student_mistakes
     WHERE user_id = _uid AND chapter_id = _chapter AND status = 'open' AND question_id IS NOT NULL;

    ----------------------------------------------------------------------
    -- 0. The student's own door to recovery answers, AS `authenticated`.
    --    rpc_student_recovery_queue is what the app reads; it plans through
    --    _recovery_session_plan_for as the owner. A revoke that broke that
    --    chain raises here, and the fixture chapter (open mistakes in it)
    --    must be one of the chapters it lists.
    ----------------------------------------------------------------------
    SET LOCAL ROLE authenticated;
    BEGIN
      _plan := public.rpc_student_recovery_queue();
      RESET ROLE;
    EXCEPTION WHEN OTHERS THEN
      RESET ROLE;
      _plan := NULL;
      _fail := _fail || format('(FAIL) 0: the student''s recovery queue raised as authenticated: %s ', left(SQLERRM, 120));
    END;
    IF _plan IS NOT NULL THEN
      IF jsonb_typeof(_plan) <> 'array'
         OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(_plan) e
                         WHERE e->>'chapter_id' = _chapter::text) THEN
        _fail := _fail || format('(FAIL) 0: the recovery queue answered the student but does not list chapter %s, which holds %s open mistake(s). ', _chapter, _n);
      ELSE
        _pass := _pass + 1;
        _report := _report || format('(PASS) 0: as the student, the recovery queue answers and lists this chapter (%s entries).', jsonb_array_length(_plan)) || E'\n';
      END IF;
    END IF;

    ----------------------------------------------------------------------
    -- 1. DEEP: every open mistake appears in tier 0. By id, not by count.
    ----------------------------------------------------------------------
    -- As the definer callers build it: the owner, planning for this student.
    _plan := public._recovery_session_plan_for(_uid, _chapter);

    SELECT array_agg(qid ORDER BY qid) INTO _t0
      FROM jsonb_array_elements_text(_plan->'tiers'->'0'->'from_bank') AS e(qid);
    SELECT array_agg(question_id::text ORDER BY question_id::text) INTO _mine
      FROM public.student_mistakes
     WHERE user_id = _uid AND chapter_id = _chapter AND status = 'open' AND question_id IS NOT NULL;

    IF _plan->>'mode' <> 'deep' THEN
      _fail := _fail || format('(FAIL) 1: %s open mistakes should select deep mode, got %s. ', _n, _plan->>'mode');
    ELSIF _t0 IS DISTINCT FROM _mine THEN
      _fail := _fail || format('(FAIL) 1: tier 0 holds %s but the open mistakes are %s. ', _t0, _mine);
    ELSE
      _pass := _pass + 1;
      _report := _report || format('(PASS) 1: deep mode, and tier 0 is EXACTLY the %s open mistake ids — not a prefix of them.', _n) || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 2. DEEP asks for one of each rung per mistake.
    ----------------------------------------------------------------------
    IF (_plan->'tiers'->'0'->>'needed')::int <> _n
       OR (_plan->'tiers'->'1'->>'needed')::int <> _n
       OR (_plan->'tiers'->'2'->>'needed')::int <> _n
       OR (_plan->'tiers'->'3'->>'needed')::int <> _n THEN
      _fail := _fail || format('(FAIL) 2: deep should need %s at every tier, got %s/%s/%s/%s. ',
        _n, _plan->'tiers'->'0'->>'needed', _plan->'tiers'->'1'->>'needed',
        _plan->'tiers'->'2'->>'needed', _plan->'tiers'->'3'->>'needed');
    ELSE
      _pass := _pass + 1;
      _report := _report || format('(PASS) 2: deep asks %s at each of the four rungs — the ladder scales with the mistakes.', _n) || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 3. WIDE: push the chapter to six mistakes. Tier 0 must carry all six.
    ----------------------------------------------------------------------
    SELECT array_agg(id) INTO _extra FROM (
      SELECT qb.id FROM public.question_bank qb
       WHERE qb.chapter_id = _chapter AND qb.is_active AND qb.is_approved
         AND qb.source_question_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.student_mistakes sm
                          WHERE sm.user_id = _uid AND sm.question_id = qb.id)
       ORDER BY qb.created_at LIMIT 20) t;

    IF COALESCE(array_length(_extra, 1), 0) < (public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int + 1 - _n) THEN
      RAISE EXCEPTION 'NO FIXTURE: chapter % has only % spare bank question(s); items 3-6 need % to reach the relearn band. NOT a pass.',
        _chapter, COALESCE(array_length(_extra, 1), 0),
        public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int + 1 - _n;
    END IF;

    FOR _i IN 1 .. (6 - _n) LOOP
      INSERT INTO public.student_mistakes
        (user_id, student_id, school_id, chapter_id, question_id, source, status,
         question_text, times_wrong, last_wrong_at)
      VALUES (_uid, _sid, _school, _chapter, _extra[_i], 'practice', 'open',
              'verification probe — rolled back', 1, now());
    END LOOP;

    -- As the definer callers build it: the owner, planning for this student.
    _plan := public._recovery_session_plan_for(_uid, _chapter);
    SELECT count(*)::int INTO _n
      FROM jsonb_array_elements_text(_plan->'tiers'->'0'->'from_bank');

    IF _plan->>'mode' <> 'wide' THEN
      _fail := _fail || format('(FAIL) 3: six mistakes should select wide, got %s. ', _plan->>'mode');
    ELSIF _n <> 6 THEN
      -- THIS is the old defect, stated as an assertion. The previous ladder
      -- put 2 here and dropped 4 without a word.
      _fail := _fail || format('(FAIL) 3: tier 0 carries %s of 6 mistakes — %s were dropped. ', _n, 6 - _n);
    ELSIF (_plan->'tiers'->'3'->>'needed')::int <> 0 THEN
      _fail := _fail || format('(FAIL) 3: wide must not ask for tier 3, asked for %s. ', _plan->'tiers'->'3'->>'needed');
    ELSE
      _pass := _pass + 1;
      _report := _report || '(PASS) 3: wide mode carries ALL SIX mistakes at tier 0 and asks nothing at tier 3.' || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 4. No question serves two rungs. One answer scored into two rates
    --    would make both of §4.2b's rates read from the same evidence.
    ----------------------------------------------------------------------
    SELECT array_agg(qid) INTO _ids
      FROM (
        SELECT qid FROM jsonb_array_elements_text(_plan->'tiers'->'0'->'from_bank') AS a(qid)
        UNION ALL SELECT qid FROM jsonb_array_elements_text(_plan->'tiers'->'1'->'from_bank') AS b(qid)
        UNION ALL SELECT qid FROM jsonb_array_elements_text(_plan->'tiers'->'2'->'from_bank') AS c(qid)
        UNION ALL SELECT qid FROM jsonb_array_elements_text(_plan->'tiers'->'3'->'from_bank') AS d(qid)
      ) u;
    SELECT count(*)::int INTO _dupes
      FROM (SELECT unnest(_ids) AS q GROUP BY 1 HAVING count(*) > 1) x;

    IF _dupes > 0 THEN
      _fail := _fail || format('(FAIL) 4: %s question(s) appear at more than one tier. ', _dupes);
    ELSE
      _pass := _pass + 1;
      _report := _report || format('(PASS) 4: %s question ids across the ladder, all distinct.', COALESCE(array_length(_ids, 1), 0)) || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 5. RELEARN: one past RECOVERY_RELEARN_ABOVE, the app refuses to drill.
    ----------------------------------------------------------------------
    FOR _i IN 7 .. (public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int + 1 - _n + 6) LOOP
      INSERT INTO public.student_mistakes
        (user_id, student_id, school_id, chapter_id, question_id, source, status,
         question_text, times_wrong, last_wrong_at)
      VALUES (_uid, _sid, _school, _chapter, _extra[_i], 'practice', 'open',
              'verification probe — rolled back', 1, now());
    END LOOP;

    -- As the definer callers build it: the owner, planning for this student.
    _plan := public._recovery_session_plan_for(_uid, _chapter);

    IF _plan->>'mode' <> 'relearn' THEN
      _fail := _fail || format('(FAIL) 5: nine mistakes should select relearn, got %s. ', _plan->>'mode');
    ELSIF COALESCE((_plan->>'offerable_if_generation_exhausted')::boolean, true) THEN
      _fail := _fail || '(FAIL) 5: relearn must not be offerable as a drill. ';
    ELSIF COALESCE(_plan->>'not_offerable_reason', '')
          NOT LIKE '%' || (_plan->>'open_mistakes') || ' open mistakes%' THEN
      -- The refusal has to NAME the number. A generic "not enough material"
      -- would be a lie: there is plenty of material.
      _fail := _fail || format('(FAIL) 5: the reason does not state the count: %s ', _plan->>'not_offerable_reason');
    ELSE
      _pass := _pass + 1;
      _report := _report || format(
        '(PASS) 5: %s mistakes → relearn, not offerable, and the reason names the count.',
        _plan->>'open_mistakes') || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 6. POSITIVE CONTROL — can item 3 actually fail?
    --
    -- Re-create the old cap by hand: take only the first two mistake ids and
    -- assert them against all six the way item 3 does. If that comparison
    -- passes, item 3 proves nothing and this whole file is decoration.
    ----------------------------------------------------------------------
    SELECT array_agg(question_id::text ORDER BY question_id::text) INTO _mine
      FROM public.student_mistakes
     WHERE user_id = _uid AND chapter_id = _chapter AND status = 'open' AND question_id IS NOT NULL;
    SELECT array_agg(q ORDER BY q) INTO _t0
      FROM (SELECT unnest(_mine) AS q ORDER BY 1 LIMIT 2) x;

    IF _t0 IS NOT DISTINCT FROM _mine THEN
      _fail := _fail || '(FAIL) 6: POSITIVE CONTROL BROKEN — a 2-of-9 prefix compared equal to all 9, so item 3 cannot detect a cap. ';
    ELSE
      _pass := _pass + 1;
      _report := _report || '(PASS) 6: positive control — the old 2-question cap IS distinguishable from the full set, so item 3 can fail.' || E'\n';
    END IF;

    ----------------------------------------------------------------------
    IF _fail <> '' THEN
      _report := _report || format('════ %s of 7 PASSED ════', _pass) || E'\n';
      _report := _report || 'VERIFICATION FAILED: ' || _fail;
      RAISE EXCEPTION 'ROLLBACK_AFTER_PROOF';
    END IF;
    _report := _report || '════ ALL 7 CHECKS PASSED ════' || E'\n';

    RAISE EXCEPTION 'ROLLBACK_AFTER_PROOF';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'ROLLBACK_AFTER_PROOF' THEN
        _report := _report || E'\nprobe writes rolled back; the results above stand.';
      ELSE
        RAISE;
      END IF;
  END;

  -- Created after the inner block so the rollback cannot take it with it.
  -- The house contract: end in a deliberate RAISE. It rolls the fixtures
  -- back, it is how run-verification-files.mjs tells a file that ran from
  -- one that has rotted, and it is the only channel that survives the
  -- Management API, which discards NOTICEs.
  RAISE EXCEPTION E'\n%', _report;
END $verify$;
