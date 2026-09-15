-- ════════════════════════════════════════════════════════════════════════════
-- VERIFY: the missing rungs get queued, deduplicated, and resolved from the bank
-- ════════════════════════════════════════════════════════════════════════════
--
-- Run it:
--   psql "$DB" -f supabase/migrations/verification/CHUNK7F_GENERATION_WIRING_VERIFY.sql
--   (or POST the file to the Management API /database/query endpoint)
--
-- WHAT THIS ASSERTS, AND WHAT IT DELIBERATELY DOES NOT
--
-- It asserts the WIRING: that a plan which came up short enqueues exactly the
-- right jobs, that the same question enqueued twice produces one job, that a
-- question whose variant already exists is never enqueued, and that a job is
-- resolved by the variant APPEARING IN THE BANK rather than by a request
-- having been sent.
--
-- It does NOT call the AI. Every run would otherwise spend money, and a
-- verification file that costs money per run is one people stop running. The
-- generator itself was proven against production on 2026-09-15 with two real
-- calls, and both are recorded in the commit: a tier-1 variant of "diameter
-- 14 m, find the area" produced "diameter 21 m, find the area" (same method,
-- new values, difficulty mirrored), and a tier-2 variant produced "area is
-- 154 m², find the diameter" — the original's ANSWER as the new input, which
-- is rule (a) of the tier-2 prompt and cannot be answered from memory.
--
-- Item 5 is the POSITIVE CONTROL. Every other item here would pass against an
-- _enqueue_variant_generation that always returned 0 and wrote nothing, since
-- "no duplicate rows" and "nothing enqueued for a cached question" are both
-- satisfied by doing nothing at all. Item 5 requires that a genuine shortfall
-- DOES produce a job.
--
-- WRITES ARE ROLLED BACK. The inner block is an implicit savepoint; the report
-- is accumulated in a plpgsql variable, which a rollback cannot touch.
-- ════════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  _report  text := '';
  _fail    text := '';
  _pass    int := 0;
  _orig    uuid;
  _fake    uuid;
  _plan    jsonb;
  _n       int;
  _added   int;
  _added2  int;
  _max_try int;
BEGIN
  BEGIN
    ----------------------------------------------------------------------
    -- Fixture: a real bank question to stand as the source.
    ----------------------------------------------------------------------
    SELECT qb.id INTO _orig
      FROM public.question_bank qb
     WHERE qb.is_active AND qb.is_approved
       AND qb.options IS NOT NULL AND qb.correct_index IS NOT NULL
       AND qb.source_question_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.question_bank v
                        WHERE v.source_question_id = qb.id AND v.variant_tier = 1)
     LIMIT 1;

    IF _orig IS NULL THEN
      RAISE EXCEPTION 'NO FIXTURE: no bank question without a tier-1 variant. NOT a pass.';
    END IF;

    DELETE FROM public.variant_generation_queue WHERE source_question_id = _orig;

    -- A plan shaped exactly as _recovery_session_plan_for returns one, short
    -- at both generated rungs. Built by hand rather than taken from a live
    -- student so the shortfall is unambiguous and the item cannot pass by
    -- accident on a chapter that happens to be full.
    _plan := jsonb_build_object(
      'mode', 'deep',
      'open_mistakes', 1,
      'sources', jsonb_build_array(
        jsonb_build_object('question_id', _orig, 'difficulty', 'easy', 'times_wrong', 1)),
      'tiers', jsonb_build_object(
        '0', jsonb_build_object('needed', 1, 'filled', 1, 'shortfall', 0),
        '1', jsonb_build_object('needed', 1, 'filled', 0, 'shortfall', 1),
        '2', jsonb_build_object('needed', 1, 'filled', 0, 'shortfall', 1),
        '3', jsonb_build_object('needed', 1, 'filled', 1, 'shortfall', 0)));

    ----------------------------------------------------------------------
    -- 5 FIRST, because every item below leans on it: does it enqueue at all?
    ----------------------------------------------------------------------
    _added := public._enqueue_variant_generation(_plan);

    SELECT count(*)::int INTO _n
      FROM public.variant_generation_queue
     WHERE source_question_id = _orig AND status = 'pending';

    IF _added <> 2 OR _n <> 2 THEN
      _fail := _fail || format('(FAIL) 5: POSITIVE CONTROL — a plan short at tiers 1 and 2 enqueued %s job(s) and left %s pending; expected 2 and 2. Every other item here passes against a function that does nothing. ',
        _added, _n);
    ELSE
      _pass := _pass + 1;
      _report := _report || '(PASS) 5: positive control — a genuine shortfall at tiers 1 and 2 produces exactly two jobs, so the items below are measuring something.' || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 1. Only the SHORT rungs. Tiers 0 and 3 are never generated.
    ----------------------------------------------------------------------
    SELECT count(*)::int INTO _n
      FROM public.variant_generation_queue
     WHERE source_question_id = _orig AND tier NOT IN (1, 2);

    IF _n <> 0 THEN
      _fail := _fail || format('(FAIL) 1: %s job(s) queued outside tiers 1 and 2. Tier 0 IS the student''s own question and tier 3 comes from the bank; neither can be generated. ', _n);
    ELSE
      _pass := _pass + 1;
      _report := _report || '(PASS) 1: only tiers 1 and 2 are queued — tier 0 is the original and tier 3 comes from the bank.' || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 2. ONE JOB PER (QUESTION, TIER), across every student.
    --    §4.2a's economics depend on this: forty students failing the same
    --    question must pay for one generation, not forty.
    ----------------------------------------------------------------------
    _added2 := public._enqueue_variant_generation(_plan);

    SELECT count(*)::int INTO _n
      FROM public.variant_generation_queue
     WHERE source_question_id = _orig AND status = 'pending';

    IF _n <> 2 THEN
      _fail := _fail || format('(FAIL) 2: enqueuing the same shortfall twice left %s pending job(s), so a popular wrong question would be generated once per student. ', _n);
    ELSIF _added2 <> 0 THEN
      _fail := _fail || format('(FAIL) 2: the second enqueue reported %s new job(s) while writing none — the count lies. ', _added2);
    ELSE
      _pass := _pass + 1;
      _report := _report || '(PASS) 2: the same shortfall enqueued twice still leaves two jobs — one per (question, tier), shared across students.' || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 3. BANK FIRST. A question that already has its variant is not queued.
    ----------------------------------------------------------------------
    DELETE FROM public.variant_generation_queue WHERE source_question_id = _orig;

    INSERT INTO public.question_bank
      (id, subject, chapter, chapter_id, class_level, difficulty, question, options,
       correct_index, is_approved, is_active, source_question_id, variant_tier)
    SELECT gen_random_uuid(), o.subject, o.chapter, o.chapter_id, o.class_level, o.difficulty,
           'VERIFY cached tier-1 variant — rolled back', o.options, o.correct_index,
           true, true, o.id, 1
      FROM public.question_bank o WHERE o.id = _orig
    RETURNING id INTO _fake;

    _added := public._enqueue_variant_generation(_plan);

    SELECT count(*)::int INTO _n
      FROM public.variant_generation_queue
     WHERE source_question_id = _orig AND tier = 1 AND status = 'pending';

    IF _n <> 0 THEN
      _fail := _fail || '(FAIL) 3: tier 1 was queued although the bank already holds a variant — generation is the default, not the fallback. ';
    ELSIF _added <> 1 THEN
      _fail := _fail || format('(FAIL) 3: expected only tier 2 to be queued (1 job), got %s. ', _added);
    ELSE
      _pass := _pass + 1;
      _report := _report || '(PASS) 3: with a tier-1 variant already banked, only tier 2 is queued — the bank is checked before anything is paid for.' || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 4. RESOLVED FROM THE BANK, not from a dispatch.
    --    pg_net is fire-and-forget. A queue that believed its own sends would
    --    mark work done that never happened.
    ----------------------------------------------------------------------
    DELETE FROM public.variant_generation_queue WHERE source_question_id = _orig;
    INSERT INTO public.variant_generation_queue (source_question_id, tier, attempts, dispatched_at)
    VALUES (_orig, 1, 1, now());

    PERFORM public.dispatch_variant_generation();

    SELECT count(*)::int INTO _n
      FROM public.variant_generation_queue
     WHERE source_question_id = _orig AND tier = 1 AND status = 'done' AND resolved_at IS NOT NULL;

    IF _n <> 1 THEN
      _fail := _fail || '(FAIL) 4: a job whose variant IS in the bank was not resolved. ';
    ELSE
      _pass := _pass + 1;
      _report := _report || '(PASS) 4: a job is closed because the variant exists in the bank, never because a request was sent.' || E'\n';
    END IF;

    ----------------------------------------------------------------------
    -- 6. RETRIES ARE BOUNDED. A job that never produces anything stops
    --    costing money instead of being retried for ever.
    ----------------------------------------------------------------------
    _max_try := public._recovery_const('GENERATION_MAX_RETRIES')::int;

    DELETE FROM public.variant_generation_queue WHERE source_question_id = _orig;
    DELETE FROM public.question_bank WHERE id = _fake;
    INSERT INTO public.variant_generation_queue (source_question_id, tier, attempts)
    VALUES (_orig, 1, _max_try);

    PERFORM public.dispatch_variant_generation();

    SELECT count(*)::int INTO _n
      FROM public.variant_generation_queue
     WHERE source_question_id = _orig AND tier = 1 AND status = 'failed';

    IF _n <> 1 THEN
      _fail := _fail || format('(FAIL) 6: a job at %s attempts with no variant was not retired — it would be retried for ever. ', _max_try);
    ELSE
      _pass := _pass + 1;
      _report := _report || format('(PASS) 6: a job that reached GENERATION_MAX_RETRIES (%s) with nothing in the bank is retired, not retried for ever.', _max_try) || E'\n';
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

  -- The house contract: end in a deliberate RAISE. It rolls the fixtures back,
  -- it is how run-verification-files.mjs tells a file that ran from one that
  -- has rotted, and it is the only channel that survives the Management API,
  -- which discards NOTICEs.
  RAISE EXCEPTION E'\n%', _report;
END $verify$;
