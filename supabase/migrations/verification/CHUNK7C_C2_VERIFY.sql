-- ---------------------------------------------------------------------
-- CHUNK 7C-C part 2 VERIFICATION — the offer floor (§4.1a, resolved)
--
-- The rule: nobody is waiting, so a session that cannot be completed is not
-- offered — it retries. Once retries are exhausted, offer what EXISTS only if
-- it still holds RECOVERY_MIN_PROCEDURAL_TO_OFFER procedural questions
-- (tiers 0-1) AND RECOVERY_MIN_CONCEPTUAL_TO_OFFER conceptual ones (tiers 2-3).
--
-- Every item drives the real RPC as the real student. The floor is exercised in
-- BOTH directions, because a floor that is always cleared is indistinguishable
-- from no floor at all: item 3 raises the constants inside this transaction
-- until the same chapter stops being offerable, then item 4 proves the reason
-- names the half that actually ran short.
--
-- Self-rolling-back: one implicit transaction ending in a deliberate RAISE.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _demo uuid := '00000000-0000-4000-8000-000000000001';
  _uid uuid; _sid uuid; _chap uuid;
  _plan jsonb; _plan_lo jsonb; _plan_hi jsonb; _plan_conc jsonb;
  _proc int; _conc int; _min_p int; _min_c int;
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text;
BEGIN
  SELECT s.user_id, s.id INTO _uid, _sid FROM public.students s
   WHERE s.school_id = _demo AND s.user_id IS NOT NULL AND s.deleted_at IS NULL
   ORDER BY s.id LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'CHUNK7C_C2: no linked demo student. A skipped check is not a passing check.';
  END IF;

  ------------------------------------------------------------------
  -- 1. Both constants exist and are readable through the helper
  ------------------------------------------------------------------
  -- _recovery_const RAISES on a missing key, so this cannot pass by reading a
  -- null and calling it zero (G4).
  _min_p := public._recovery_const('RECOVERY_MIN_PROCEDURAL_TO_OFFER')::int;
  _min_c := public._recovery_const('RECOVERY_MIN_CONCEPTUAL_TO_OFFER')::int;

  _r1 := format('floors: procedural >= %s, conceptual >= %s', _min_p, _min_c)
      || CASE WHEN _min_p >= 2 AND _min_c >= 2
              THEN ' — both halves have a floor of at least 2; one question per rate is a coin flip, not a measurement (PASS)'
              ELSE ' — a floor below 2 cannot support a rate (FAIL)' END;

  ------------------------------------------------------------------
  -- Everything below runs AS THE STUDENT.
  ------------------------------------------------------------------
  -- This has to come BEFORE the chapter lookup, not after it. The first draft
  -- set it just before the RPC call, so the entitlement fallback
  -- _recovery_chapter_is_mine() ran with auth.uid() still NULL, found nothing,
  -- and the file aborted claiming the student had no reachable chapter. The
  -- function was right; the harness was asking as nobody.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid, 'role', 'authenticated')::text, true);

  ------------------------------------------------------------------
  -- 2. The plan reports both halves, and offerable agrees with them
  ------------------------------------------------------------------
  -- Pick a chapter the student actually has open mistakes in, so tier 0 is not
  -- empty for an uninteresting reason.
  SELECT sm.chapter_id INTO _chap
    FROM public.student_mistakes sm
   WHERE sm.user_id = _uid AND sm.chapter_id IS NOT NULL AND sm.status = 'open'
   GROUP BY sm.chapter_id ORDER BY count(*) DESC LIMIT 1;
  IF _chap IS NULL THEN
    -- No open mistakes: fall back to any chapter this student is entitled to,
    -- and say so, rather than silently testing nothing.
    SELECT c.id INTO _chap FROM public.chapters c
     WHERE public._recovery_chapter_is_mine(c.id) LIMIT 1;
  END IF;
  IF _chap IS NULL THEN
    RAISE EXCEPTION 'CHUNK7C_C2: no chapter reachable for this student — the check would prove nothing.';
  END IF;

  _plan := public.rpc_recovery_session_plan(_chap);
  _proc := (_plan->>'procedural_available')::int;
  _conc := (_plan->>'conceptual_available')::int;

  _r2 := format('plan: %s procedural (tiers 0-1), %s conceptual (tiers 2-3), offerable=%s',
                _proc, _conc, _plan->>'offerable_if_generation_exhausted')
      || CASE WHEN (_plan->>'offerable_if_generation_exhausted')::boolean
                   = (_proc >= _min_p AND _conc >= _min_c)
              THEN ' — the flag is computed from the two halves, not asserted separately (PASS)'
              ELSE ' — offerable disagrees with the counts it claims to be derived from (FAIL)' END;

  ------------------------------------------------------------------
  -- 3. NEGATIVE CONTROL — the floor is load-bearing
  ------------------------------------------------------------------
  -- A floor that is always cleared cannot be told apart from no floor — and the
  -- first draft of this item proved exactly nothing: it raised the floors to
  -- 9999 and asserted offerable=false, but this student already had 0
  -- procedural questions available, so the answer was false BEFORE the change
  -- and false after it. It would have passed against a build with the floor
  -- deleted entirely.
  --
  -- So drive it in BOTH directions on the same chapter. Floors at 0 must make
  -- it offerable; floors at 9999 must make it not. Only a flag actually derived
  -- from the constants can do both.
  UPDATE public.recovery_constants SET value = 0
   WHERE key IN ('RECOVERY_MIN_PROCEDURAL_TO_OFFER', 'RECOVERY_MIN_CONCEPTUAL_TO_OFFER');
  _plan_lo := public.rpc_recovery_session_plan(_chap);

  UPDATE public.recovery_constants SET value = 9999
   WHERE key IN ('RECOVERY_MIN_PROCEDURAL_TO_OFFER', 'RECOVERY_MIN_CONCEPTUAL_TO_OFFER');
  _plan_hi := public.rpc_recovery_session_plan(_chap);

  _r3 := format('same chapter, floors 0 -> offerable=%s; floors 9999 -> offerable=%s',
                _plan_lo->>'offerable_if_generation_exhausted',
                _plan_hi->>'offerable_if_generation_exhausted')
      || CASE WHEN (_plan_lo->>'offerable_if_generation_exhausted')::boolean IS TRUE
                   AND (_plan_hi->>'offerable_if_generation_exhausted')::boolean IS FALSE
              THEN ' — the decision follows the constants in both directions, so the floor is load-bearing (PASS)'
              WHEN (_plan_lo->>'offerable_if_generation_exhausted')::boolean IS NOT TRUE
              THEN ' — a floor of 0 still refused to offer, so the flag is not derived from the floor (FAIL)'
              ELSE ' — raising the floor changed nothing (FAIL)' END;

  ------------------------------------------------------------------
  -- 4. The reason names the half that ran short
  ------------------------------------------------------------------
  -- §4.2b's whole point is that "not ready" is useless without which rate
  -- failed. The same applies to not being offered at all.
  UPDATE public.recovery_constants SET value = 9999
   WHERE key = 'RECOVERY_MIN_CONCEPTUAL_TO_OFFER';
  UPDATE public.recovery_constants SET value = 0
   WHERE key = 'RECOVERY_MIN_PROCEDURAL_TO_OFFER';

  _plan_conc := public.rpc_recovery_session_plan(_chap);

  _r4 := format('procedural floor 0, conceptual floor 9999 -> reason: %s',
                coalesce(_plan_conc->>'not_offerable_reason', '(none)'))
      || CASE WHEN _plan_conc->>'not_offerable_reason' ILIKE '%conceptual%'
                   AND _plan_conc->>'not_offerable_reason' NOT ILIKE '%only % procedural%'
              THEN ' — it names the conceptual half specifically, not a bare refusal (PASS)'
              WHEN _plan_conc->>'not_offerable_reason' ILIKE '%conceptual%'
              THEN ' — names conceptual (PASS)'
              ELSE ' — the reason does not identify which half fell short (FAIL)' END;

  ------------------------------------------------------------------
  -- 5. Offerable is NOT the same statement as complete
  ------------------------------------------------------------------
  -- These answer different questions and conflating them is how a short session
  -- gets offered as though it were whole. `complete` means the ladder was
  -- filled; `offerable_if_generation_exhausted` means what remains can still
  -- produce a two-rate diagnosis.
  _r5 := format('complete=%s, generation_required=%s, offerable=%s, shortfall=%s',
                _plan->>'complete', _plan->>'generation_required',
                _plan->>'offerable_if_generation_exhausted', _plan->>'shortfall')
      || CASE WHEN (_plan ? 'complete') AND (_plan ? 'offerable_if_generation_exhausted')
                   AND (_plan ? 'not_offerable_reason')
              THEN ' — the plan reports fullness and offerability as separate facts (PASS)'
              ELSE ' — a field is missing (FAIL)' END;

  RAISE EXCEPTION E'CHUNK7C_C2\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n [all rolled back, constants included]',
    _r1, _r2, _r3, _r4, _r5;
END $verify$;
