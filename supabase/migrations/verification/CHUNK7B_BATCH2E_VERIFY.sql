-- ---------------------------------------------------------------------
-- CHUNK 7B VERIFICATION — batch 2e (item difficulty, at a participant floor)
--
-- The floor is the whole rule, so it is proven in BOTH directions. Checking
-- only that a small battle shows nothing would pass on an implementation that
-- never shows anything at all — the demo database's biggest battle has 2
-- participants, so "nothing is shown" is the state you get for free.
--
-- Items 1 and 2 therefore SEED two battles inside this transaction: one with
-- 4 participants (below the floor) and one with 5 (at it), run the real
-- rpc_finish_battle over every participant, and require opposite outcomes.
--
-- Self-rolling-back: one implicit transaction ending in a deliberate RAISE.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _demo  uuid := '00000000-0000-4000-8000-000000000001';
  _uids  uuid[];
  _b4    uuid; _b5 uuid;
  _q     uuid[];
  _pid   uuid;
  _n4 bigint; _n5 bigint;
  _correct_left bigint;
  _mon jsonb; _mon_q jsonb;
  _r1 text; _r2 text; _r3 text; _r4 text;
  _bid uuid; _part uuid; _u uuid;
  _ok int := 0; _bad int := 0; _firsterr text;
  i int; j int;
BEGIN
  -- Five real users in the demo school, so finishing is authentic rather than
  -- a hand-written insert into battle_question_stats.
  SELECT array_agg(s.user_id ORDER BY s.id) INTO _uids
    FROM (SELECT user_id, id FROM public.students
           WHERE school_id = _demo AND user_id IS NOT NULL AND deleted_at IS NULL
           ORDER BY id LIMIT 5) s;

  IF _uids IS NULL OR array_length(_uids, 1) < 5 THEN
    RAISE EXCEPTION 'CHUNK7B_BATCH2E: need 5 linked demo students to test the floor, found %. A skipped check is not a passing check.',
      COALESCE(array_length(_uids, 1), 0);
  END IF;

  ------------------------------------------------------------------
  -- Build two battles: 4 participants and 5.
  ------------------------------------------------------------------
  FOR j IN 4..5 LOOP
    INSERT INTO public.battles (school_id, title, subject, status, question_count, creator_user_id, source)
    -- source is passed explicitly: battles.source DEFAULTS to 'manual', which
    -- its own CHECK constraint rejects, so any insert omitting it fails.
    VALUES (_demo, 'verify-floor-' || j, 'Mathematics', 'live', 2, _uids[1], 'class')
    RETURNING id INTO _bid;
    IF j = 4 THEN _b4 := _bid; ELSE _b5 := _bid; END IF;

    INSERT INTO public.battle_questions (battle_id, order_index, question, options, correct_index)
    SELECT _bid, g, 'Q' || g, '["a","b"]'::jsonb, 0 FROM generate_series(1, 2) g;

    -- Everyone JOINS first, then everyone finishes. That is the real
    -- sequence: participants gather in the lobby, play, and finish one by
    -- one. Inserting-then-finishing one at a time instead makes
    -- _maybe_finish_battle close the battle after participant 1 (at that
    -- instant every existing participant IS done), which closes a
    -- five-player battle five separate times at counts 1..5 — an ordering
    -- that cannot occur in the app, and which produced a 1/1 aggregate that
    -- looked like an accumulation bug.
    FOR i IN 1..j LOOP
      INSERT INTO public.battle_participants (battle_id, user_id, display_name, score, correct_count, answered_count, total_time_ms)
      VALUES (_bid, _uids[i], 'P' || i, 10, 1, 2, 1000);
    END LOOP;

    -- Every participant answers Q1 right and Q2 wrong, so the expected
    -- aggregate at the floor is exactly 5/5 and 0/5.
    INSERT INTO public.battle_answers (participant_id, question_id, is_correct, selected_index)
    SELECT bp.id, bq.id, (bq.order_index = 1), 0
      FROM public.battle_participants bp
      CROSS JOIN public.battle_questions bq
     WHERE bp.battle_id = _bid AND bq.battle_id = _bid;

    FOR _part IN SELECT id FROM public.battle_participants WHERE battle_id = _bid ORDER BY joined_at LOOP
      SELECT user_id INTO _u FROM public.battle_participants WHERE id = _part;
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _u, 'role', 'authenticated')::text, true);
      BEGIN
        PERFORM public.rpc_finish_battle(_part);
        _ok := _ok + 1;
      EXCEPTION WHEN others THEN
        -- Counted and reported, not swallowed into a NOTICE nobody reads (G10).
        _bad := _bad + 1;
        IF _firsterr IS NULL THEN _firsterr := SQLSTATE || ' ' || SQLERRM; END IF;
      END;
    END LOOP;
  END LOOP;

  ------------------------------------------------------------------
  -- 1. Below the floor: nothing stored, so nothing can be shown
  ------------------------------------------------------------------
  SELECT count(*) INTO _n4 FROM public.battle_question_stats WHERE battle_id = _b4;
  _r1 := format('4-participant battle: %s stored item-difficulty row(s)', _n4)
      || CASE WHEN _n4 = 0
              THEN ' — below the floor nothing is retained, not merely hidden (PASS)'
              ELSE ' — a sub-floor aggregate survives and could be read later (FAIL)' END;

  ------------------------------------------------------------------
  -- 2. At the floor: the aggregate exists and is correct
  ------------------------------------------------------------------
  SELECT count(*) INTO _n5 FROM public.battle_question_stats WHERE battle_id = _b5;

  _r2 := format('finishes: %s ok, %s failed%s. 5-participant battle: %s stored row(s)', _ok, _bad, COALESCE(' (first error: '||_firsterr||')',''), _n5);
  IF _n5 = 2 THEN
    -- Each of the 5 answered Q1 correctly and Q2 wrongly, so the aggregate
    -- must read 5/5 and 0/5. Anything else means the per-participant
    -- accumulation lost rows to the purge.
    IF EXISTS (
      SELECT 1 FROM public.battle_question_stats s
       JOIN public.battle_questions q ON q.id = s.question_id
      WHERE s.battle_id = _b5 AND q.order_index = 1 AND (s.attempts <> 5 OR s.correct <> 5)
    ) OR EXISTS (
      SELECT 1 FROM public.battle_question_stats s
       JOIN public.battle_questions q ON q.id = s.question_id
      WHERE s.battle_id = _b5 AND q.order_index = 2 AND (s.attempts <> 5 OR s.correct <> 0)
    ) THEN
      _r2 := _r2 || format(' but the counts are wrong: %s',
        (SELECT string_agg(q.order_index || ': ' || s.correct || '/' || s.attempts, ', ' ORDER BY q.order_index)
           FROM public.battle_question_stats s JOIN public.battle_questions q ON q.id = s.question_id
          WHERE s.battle_id = _b5))
        || ' — expected 1: 5/5 and 2: 0/5 (FAIL)';
    ELSE
      _r2 := _r2 || ' reading 5/5 and 0/5 — accumulated per participant BEFORE each purge, so no finisher was undercounted (PASS)';
    END IF;
  ELSE
    _r2 := _r2 || ' — expected 2 (one per question) (FAIL)';
  END IF;

  ------------------------------------------------------------------
  -- 3. The per-student record is still destroyed either way
  ------------------------------------------------------------------
  SELECT count(*) INTO _correct_left
    FROM public.battle_answers ba
    JOIN public.battle_participants bp ON bp.id = ba.participant_id
   WHERE bp.battle_id IN (_b4, _b5) AND bp.finished_at IS NOT NULL AND ba.is_correct IS TRUE;

  _r3 := format('correct per-question rows retained across both battles: %s', _correct_left)
      || CASE WHEN _correct_left = 0
              THEN ' — item difficulty survives, per-student correctness does not (PASS)'
              ELSE ' — a finished participant still records what they got right (FAIL)' END;

  ------------------------------------------------------------------
  -- 4. The monitor reads the stored aggregate, not live answers
  ------------------------------------------------------------------
  -- This is the 0%-after-finish bug: before 2e the monitor recomputed from
  -- battle_answers, which 2c had already emptied of correct rows.
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uids[1], 'role', 'authenticated')::text, true);
  BEGIN
    SELECT public.rpc_battle_monitor(_b5) INTO _mon;
  EXCEPTION WHEN others THEN _mon := NULL;
  END;

  IF _mon IS NULL OR jsonb_array_length(COALESCE(_mon->'questions','[]'::jsonb)) = 0 THEN
    _r4 := 'monitor returned no questions block — cannot prove the repoint (SKIPPED, not passed)';
  ELSE
    _mon_q := _mon->'questions'->0;
    _r4 := format('monitor question 1 after every participant finished: correct=%s attempts=%s',
                  _mon_q->>'correct', _mon_q->>'attempts')
        || CASE WHEN COALESCE((_mon_q->>'correct')::int, 0) > 0
                THEN ' — non-zero after finish, so it is reading the stored aggregate (PASS)'
                ELSE ' — reads 0 after finish, the pre-2e bug (FAIL)' END;
  END IF;

  RAISE EXCEPTION E'CHUNK7B_BATCH2E\n 1) %\n 2) %\n 3) %\n 4) %\n [all rolled back]',
    _r1, _r2, _r3, _r4;
END $verify$;
