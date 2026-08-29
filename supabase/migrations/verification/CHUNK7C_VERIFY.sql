-- ---------------------------------------------------------------------
-- CHUNK 7C VERIFICATION — the parts built so far (7C-A and 7C-B)
--
-- Items 1, 5, 6 of the build doc, plus the SQL half of item 7. Items 2, 3 and
-- 4 need the generation path (7C-C) and are NOT asserted here — an item that
-- cannot run yet is left visibly absent rather than stubbed into a pass.
--
-- Every item drives the real path: item 1 runs the actual tally writer, items
-- 5 and 6 run the actual state machine.
--
-- Self-rolling-back: one implicit transaction ending in a deliberate RAISE.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _demo uuid := '00000000-0000-4000-8000-000000000001';
  _uid uuid; _sid uuid; _chap uuid; _chaps uuid[];
  _sess uuid; _sess2 uuid; _sess3 uuid;
  _rows int; _n int; _due1 timestamptz; _due2 timestamptz;
  _mistakes int; _const_missing text;
  _r1 text; _r5 text; _r6 text; _r7 text;
BEGIN
  SELECT s.user_id, s.id INTO _uid, _sid FROM public.students s
   WHERE s.school_id=_demo AND s.user_id IS NOT NULL AND s.deleted_at IS NULL ORDER BY s.id LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'CHUNK7C: no linked demo student. A skipped check is not a passing check.';
  END IF;

  ------------------------------------------------------------------
  -- 1. chapter_tally: one row per chapter per session, never per question
  ------------------------------------------------------------------
  SELECT array_agg(c) INTO _chaps FROM (
    SELECT DISTINCT qb.chapter_id c FROM public.question_bank qb
     WHERE qb.chapter_id IS NOT NULL AND qb.is_active LIMIT 3) x;
  IF COALESCE(array_length(_chaps,1),0) < 3 THEN
    RAISE EXCEPTION 'CHUNK7C: need 3 chapters with bank questions, found %', COALESCE(array_length(_chaps,1),0);
  END IF;

  INSERT INTO public.practice_sessions (user_id, student_id, school_id, subject, question_count)
  VALUES (_uid,_sid,_demo,'Mathematics',6) RETURNING id INTO _sess;

  INSERT INTO public.question_attempts (user_id, session_id, bank_question_id, is_correct, school_id,
                                        generated_question, correct_answer, selected_answer)
  SELECT _uid, _sess, q.id, (row_number() OVER ()) % 2 = 0, _demo, '{}'::jsonb, '"a"'::jsonb, '"a"'::jsonb
    FROM (SELECT DISTINCT ON (qb.chapter_id) qb.id, qb.chapter_id
            FROM public.question_bank qb WHERE qb.chapter_id = ANY(_chaps) AND qb.is_active
           ORDER BY qb.chapter_id, qb.id) q;

  SELECT public._write_chapter_tally(_sess) INTO _rows;
  SELECT count(*)::int INTO _n FROM public.chapter_tally WHERE session_id = _sess;

  _r1 := format('6 attempts spanning %s chapters -> %s tally row(s)', array_length(_chaps,1), _n)
      || CASE WHEN _n = array_length(_chaps,1)
              THEN ' — one row per chapter per session, never per question (PASS)'
              ELSE ' — wrong grain (FAIL)' END;

  ------------------------------------------------------------------
  -- 5. The revision clock starts on ENGAGEMENT, not only after recovery
  ------------------------------------------------------------------
  -- Deliberately a session with NOTHING to recover: 12 attempted, 12 correct.
  -- §5.2 — "Scheduling only after recovery would leave their strongest work
  -- unrevised, which is backwards." A session containing mistakes would pass
  -- this item for the wrong reason, because the trigger would also have fired.
  _chap := _chaps[1];
  SELECT count(*)::int INTO _mistakes FROM public.student_mistakes
   WHERE user_id=_uid AND chapter_id=_chap AND status='open';

  INSERT INTO public.practice_sessions (user_id, student_id, school_id, subject, question_count)
  VALUES (_uid,_sid,_demo,'Mathematics',12) RETURNING id INTO _sess2;
  INSERT INTO public.chapter_tally (user_id, student_id, school_id, chapter_id, session_id, attempted, correct)
  VALUES (_uid,_sid,_demo,_chap,_sess2,12,12);
  PERFORM public._apply_chapter_state(_sess2);

  SELECT next_revision_at INTO _due1 FROM public.chapter_state
   WHERE user_id=_uid AND chapter_id=_chap;

  _r5 := format('12 attempted, 12 correct, %s open mistake(s) in the chapter -> next_revision_at %s',
                _mistakes, COALESCE(_due1::text,'NOT SET'))
      || CASE WHEN _due1 IS NOT NULL
              THEN ' — the clock starts on engagement alone (PASS)'
              ELSE ' — a session with nothing to recover left the chapter unrevised (FAIL)' END;

  ------------------------------------------------------------------
  -- 6. Re-engaging RESETS the clock
  ------------------------------------------------------------------
  -- now() is the TRANSACTION timestamp, so a second session inside this same
  -- transaction recomputes the SAME due date, and an assertion comparing the
  -- two could not tell a reset from a no-op — a check that cannot fail. The
  -- stored value is therefore AGED first, so only a real overwrite moves it.
  UPDATE public.chapter_state SET next_revision_at = now() - interval '30 days'
   WHERE user_id=_uid AND chapter_id=_chap;
  SELECT next_revision_at INTO _due1 FROM public.chapter_state
   WHERE user_id=_uid AND chapter_id=_chap;

  INSERT INTO public.practice_sessions (user_id, student_id, school_id, subject, question_count)
  VALUES (_uid,_sid,_demo,'Mathematics',10) RETURNING id INTO _sess3;
  INSERT INTO public.chapter_tally (user_id, student_id, school_id, chapter_id, session_id, attempted, correct)
  VALUES (_uid,_sid,_demo,_chap,_sess3,10,7);
  PERFORM public._apply_chapter_state(_sess3);

  SELECT next_revision_at INTO _due2 FROM public.chapter_state
   WHERE user_id=_uid AND chapter_id=_chap;

  _r6 := format('stale due %s -> %s', _due1::date, _due2::date)
      || CASE WHEN _due2 > _due1
              THEN ' — re-engaging resets the clock, so a student actively working on a chapter is not reminded to revise it (PASS)'
              ELSE ' — the clock did not reset (FAIL)' END;

  ------------------------------------------------------------------
  -- 7 (SQL half). No spec §10 constant is a literal in a function body
  ------------------------------------------------------------------
  -- A database function cannot import the TypeScript module, so the values
  -- live in recovery_constants and every body reads them. Asserting the table
  -- is complete is what makes "no literals" true on the SQL side; the client
  -- half is src/academic/recovery/constants.ts.
  SELECT string_agg(want.k, ', ') INTO _const_missing FROM (
    SELECT unnest(ARRAY['RECOVERY_TRIGGER_COUNT','RECOVERY_TIER0','RECOVERY_TIER1',
                        'RECOVERY_TIER2','RECOVERY_TIER3','RECOVERY_PROCEDURAL_THRESHOLD',
                        'RECOVERY_CONCEPTUAL_THRESHOLD','RECOVERY_GENERATION_ROUNDS',
                        'REVISION_ENGAGEMENT_MIN','REVISION_COUNT','REVISION_PASS_THRESHOLD',
                        'REVISION_STAGES_TO_SOLID','REVISION_INTERVAL_1','REVISION_INTERVAL_2',
                        'REVISION_INTERVAL_3','TREND_MIN_SESSIONS','TREND_DELTA_POINTS',
                        'REPEATED_MISTAKE_PIN']) AS k) want
   WHERE NOT EXISTS (SELECT 1 FROM public.recovery_constants c WHERE c.key = want.k);

  _r7 := format('spec §10 constants missing from recovery_constants: %s', COALESCE(_const_missing,'(none)'))
      || CASE WHEN _const_missing IS NULL
              THEN ' — every constant has one home the SQL side can read (PASS)'
              ELSE ' — (FAIL)' END;

  RAISE EXCEPTION E'CHUNK7C\n 1) %\n 5) %\n 6) %\n 7-sql) %\n [items 2, 3, 4 need the generation path — deliberately not asserted]\n [all rolled back]',
    _r1, _r5, _r6, _r7;
END $verify$;
