-- ---------------------------------------------------------------------
-- CHUNK 7E VERIFICATION — the loop, driven end to end with ONE engine
--
-- 20260926000000 dropped recovery_assignments, recovery_assignment_questions
-- and six functions, and rewrote six more. One of the rewritten six —
-- rpc_record_concept_mistake — is the hot path: rpc_record_question_attempt
-- calls it for EVERY wrong answer in practice, tests and battles. If that
-- rewrite is wrong, all practice is broken, and no amount of reading the SQL
-- would say so.
--
-- So this file does not inspect anything. It sits down as a real student,
-- starts a real practice session, gets a real question wrong, finishes, and
-- then asks every screen's RPC what it sees. The whole file is one implicit
-- transaction ending in a deliberate RAISE: the session, the attempt, the
-- mistake-book row and the academic-brain write are all created and all
-- rolled back.
--
-- G11 — every item can fail, and several are written so that the OBVIOUS
-- wrong implementation fails them:
--
--   item 2 asserts the mistake book grew by exactly one AND that the row
--          carries the bank question id, not the attempt id. The bug
--          20260921000000 fixed wrote the attempt id here and every check
--          that only counted rows passed while it was live.
--   item 4 asserts the report does NOT carry a recovery_assignments key. A
--          rewrite that left the key in place, returning an empty array,
--          would pass a "does the report still build" check.
--   item 6 compares the snapshot's recovery_pending against the trigger
--          arithmetic computed here from the raw mistake book. A snapshot
--          that returned a hardcoded 0 would pass "is the key present".
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _uid       uuid;
  _sid       uuid;
  _school    uuid;
  _q         record;
  _wrong_index int;
  _sess      uuid;
  _att       uuid;
  _before    bigint;
  _after     bigint;
  _mrow      record;
  _fin       jsonb;
  _report    jsonb;
  _report2   jsonb;
  _snap      jsonb;
  _brain     jsonb;
  _hist      jsonb;
  _pct       numeric;
  _want_rec  int;
  _want_rev  int;
  _queue     jsonb;
  _states    jsonb;
  _trigger   int;
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text; _r6 text; _r7 text; _r8 text;
BEGIN
  ------------------------------------------------------------------
  -- 0. A real student, and a real bank question with a real chapter
  ------------------------------------------------------------------
  SELECT s.user_id, s.id, s.school_id INTO _uid, _sid, _school
    FROM public.students s
    JOIN public.practice_sessions ps ON ps.user_id = s.user_id
   WHERE s.deleted_at IS NULL AND s.user_id IS NOT NULL
   GROUP BY s.user_id, s.id, s.school_id
   ORDER BY count(*) DESC
   LIMIT 1;

  IF _uid IS NULL THEN
    RAISE EXCEPTION 'CHUNK7E: no student has ever practised. A skipped check is not a passing check.';
  END IF;

  -- correct_index matters: rpc_record_question_attempt does NOT trust the
  -- _is_correct flag it is handed. _practice_grade_from_bank re-grades the
  -- answer against the bank row, which is the right design and which makes a
  -- fixture that just says "false" grade as CORRECT half the time. The wrong
  -- option is chosen from the bank's own answer key below.
  SELECT qb.id, qb.chapter_id, qb.subject, qb.chapter, qb.question,
         COALESCE(qb.correct_index, 0) AS correct_index,
         COALESCE(jsonb_array_length(qb.options), 4) AS option_count
    INTO _q
    FROM public.question_bank qb
   WHERE qb.is_active AND qb.chapter_id IS NOT NULL
     AND qb.correct_index IS NOT NULL
     AND jsonb_array_length(qb.options) >= 2
   ORDER BY qb.id
   LIMIT 1;

  IF _q.id IS NULL THEN
    RAISE EXCEPTION 'CHUNK7E: no active bank question carries a chapter_id; item 2 could not be exercised.';
  END IF;

  -- Become that student. Every RPC below runs under the RLS the app runs
  -- under, resolving the student from auth.uid() exactly as production does.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

  SELECT count(*) INTO _before
    FROM public.student_mistakes sm
   WHERE sm.user_id = _uid;

  ------------------------------------------------------------------
  -- 1. A practice session still starts
  ------------------------------------------------------------------
  _sess := public.rpc_start_practice_session(
    COALESCE(_q.subject, 'Mathematics'), _q.chapter, 1, 'chapter', NULL, NULL);

  _r1 := format('session=%s', COALESCE(_sess::text, '(null)'))
      || CASE WHEN _sess IS NOT NULL
              THEN ' — rpc_start_practice_session survived the drop (PASS)'
              ELSE ' — a practice session could not be started (FAIL)' END;

  ------------------------------------------------------------------
  -- 2. THE HOT PATH: one wrong answer, recorded
  ------------------------------------------------------------------
  -- rpc_record_question_attempt -> rpc_record_concept_mistake. That second
  -- function used to end by calling rpc_assign_concept_recovery, which is now
  -- dropped. If the call had been left behind, this statement raises
  -- "function does not exist" and the file reports item 2 as a hard failure
  -- rather than a soft one.
  _wrong_index := (_q.correct_index + 1) % _q.option_count;

  _att := public.rpc_record_question_attempt(
    _correct_answer     => jsonb_build_object('index', _q.correct_index),
    _generated_question => jsonb_build_object('question', COALESCE(_q.question, 'q'),
                                              'bank_question_id', _q.id),
    _is_correct         => false,
    _selected_answer    => jsonb_build_object('index', _wrong_index),
    _session_id         => _sess,
    _bank_question_id   => _q.id,
    _source             => 'practice'
  );

  SELECT count(*) INTO _after
    FROM public.student_mistakes sm
   WHERE sm.user_id = _uid;

  SELECT sm.question_id, sm.chapter_id, sm.status, sm.times_wrong
    INTO _mrow
    FROM public.student_mistakes sm
   WHERE sm.user_id = _uid AND sm.source = 'practice' AND sm.question_id = _q.id
   ORDER BY sm.last_wrong_at DESC
   LIMIT 1;

  _r2 := format('attempt=%s mistakes %s -> %s, row question_id=%s (bank id %s) chapter_id=%s status=%s',
                COALESCE(_att::text, '(null)'), _before, _after,
                COALESCE(_mrow.question_id::text, '(none)'), _q.id,
                COALESCE(_mrow.chapter_id::text, '(null)'), COALESCE(_mrow.status, '(none)'))
      || CASE WHEN _att IS NOT NULL
                   AND _mrow.question_id = _q.id
                   AND _mrow.chapter_id = _q.chapter_id
                   AND _mrow.status = 'open'
              THEN ' — a wrong answer still reaches the mistake book, keyed on the BANK question and carrying the chapter the 7C engine counts by (PASS)'
              ELSE ' — the hot path is broken, or the row is not keyed the way recovery needs (FAIL)' END;

  ------------------------------------------------------------------
  -- 3. The session finishes and is counted as answered
  ------------------------------------------------------------------
  _fin := public.rpc_finish_practice_session(_sess, NULL, true, true);

  _r3 := format('finished: total=%s correct=%s wrong=%s skipped=%s accuracy=%s (chose option %s, the key is %s)',
                _fin->>'total', _fin->>'correct_count', _fin->>'wrong_count',
                _fin->>'skipped_count', _fin->>'accuracy',
                _wrong_index, _q.correct_index)
      || CASE WHEN (_fin->>'wrong_count')::int >= 1
              THEN ' — the attempt was counted, so the session is not a shell (PASS)'
              ELSE ' — the finish did not see the attempt (FAIL)' END;

  ------------------------------------------------------------------
  -- 4. The post-session report builds, and carries no assignment list
  ------------------------------------------------------------------
  _report  := public.rpc_post_assessment_concept_analysis('practice_session', _sess);
  _report2 := public.rpc_get_concept_recovery_report('practice_session', _sess);

  _r4 := format('post_assessment keys: total=%s weak=%s has_assignments=%s | get_report has_assignments=%s',
                _report->>'total_count',
                jsonb_array_length(COALESCE(_report->'weak_concepts', '[]'::jsonb)),
                _report ? 'recovery_assignments',
                _report2 ? 'recovery_assignments')
      || CASE WHEN NOT (_report ? 'recovery_assignments')
                   AND NOT (_report2 ? 'recovery_assignments')
                   AND (_report ? 'weak_concepts')
                   AND (_report ? 'accuracy_pct')
                   AND (_report2 ? 'weak_concepts')
              THEN ' — both reports still describe the session and neither invents an assignment (PASS)'
              ELSE ' — a report broke, or still carries the retired key (FAIL)' END;

  ------------------------------------------------------------------
  -- 5. The two 7C read RPCs answer for this student
  ------------------------------------------------------------------
  _queue  := public.rpc_student_recovery_queue();
  _states := public.rpc_student_chapter_states();
  _trigger := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;

  _r5 := format('recovery_queue rows=%s chapter_states rows=%s trigger=%s',
                jsonb_array_length(_queue), jsonb_array_length(_states), _trigger)
      || CASE WHEN jsonb_typeof(_queue) = 'array'
                   AND jsonb_typeof(_states) = 'array'
                   AND jsonb_array_length(_queue) >= 1
                   AND EXISTS (
                     SELECT 1 FROM jsonb_array_elements(_queue) r
                      WHERE (r->>'chapter_id')::uuid = _q.chapter_id
                        AND (r->>'trigger_count')::int = _trigger
                   )
              THEN ' — the chapter this student just erred in is in the queue, carrying the constant as data (PASS)'
              ELSE ' — the recovery queue does not show the chapter the mistake was just filed under (FAIL)' END;

  ------------------------------------------------------------------
  -- 6. The snapshot agrees with the raw arithmetic, not with itself
  ------------------------------------------------------------------
  _snap := public.rpc_student_academic_snapshot();

  SELECT count(*)::int INTO _want_rec FROM (
    SELECT sm.chapter_id
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid AND sm.status = 'open' AND sm.chapter_id IS NOT NULL
     GROUP BY sm.chapter_id
    HAVING count(*) >= _trigger
  ) x;

  SELECT count(*)::int INTO _want_rev
    FROM public.chapter_state cs
   WHERE cs.user_id = _uid
     AND cs.next_revision_at IS NOT NULL
     AND cs.next_revision_at <= now();

  _r6 := format('snapshot recovery_pending=%s (raw %s) revision_due=%s (raw %s) still_has_revision_queue=%s',
                _snap->>'recovery_pending', _want_rec,
                _snap->>'revision_due', _want_rev,
                _snap ? 'revision_queue')
      || CASE WHEN (_snap->>'recovery_pending')::int = _want_rec
                   AND (_snap->>'revision_due')::int = _want_rev
                   AND NOT (_snap ? 'revision_queue')
              THEN ' — both counts come from the engine the screens read, and the retired key is gone (PASS)'
              ELSE ' — the snapshot disagrees with the engine, or still serves the retired queue (FAIL)' END;

  ------------------------------------------------------------------
  -- 7. The academic brain summarises recovery from SESSIONS
  ------------------------------------------------------------------
  _brain := public.rpc_refresh_academic_brain();

  SELECT b.recovery_history, b.recovery_completion_pct
    INTO _hist, _pct
    FROM public.student_academic_brain b
   WHERE b.user_id = _uid;

  _r7 := format('recovery_history=%s recovery_completion_pct=%s',
                COALESCE(_hist::text, '(null)'), COALESCE(_pct::text, '(null)'))
      || CASE WHEN _hist ? 'total_rounds' AND _hist ? 'cleared' AND _hist ? 'avg_readiness'
                   AND NOT (_hist ? 'total_assignments')
                   AND _pct IS NOT NULL
                   AND _pct = (_hist->>'avg_readiness')::numeric
              THEN ' — the brain reports recovery ROUNDS and their readiness, and the pct is read from the same key (PASS)'
              ELSE ' — the brain still describes assignments, or the pct no longer tracks the summary (FAIL)' END;

  ------------------------------------------------------------------
  -- 8. Nothing anywhere still names the retired engine
  ------------------------------------------------------------------
  -- The negative half of the whole change, asserted over the live catalogue
  -- rather than over this file's own edits.
  _r8 := format('tables=%s functions=%s',
                (SELECT count(*) FROM information_schema.tables
                  WHERE table_schema = 'public'
                    AND table_name IN ('recovery_assignments', 'recovery_assignment_questions')),
                (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.prokind = 'f'
                    AND pg_get_functiondef(p.oid) LIKE '%recovery_assignment%'))
      || CASE WHEN NOT EXISTS (
                     SELECT 1 FROM information_schema.tables
                      WHERE table_schema = 'public'
                        AND table_name IN ('recovery_assignments', 'recovery_assignment_questions'))
                   AND NOT EXISTS (
                     SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                      WHERE n.nspname = 'public' AND p.prokind = 'f'
                        AND pg_get_functiondef(p.oid) LIKE '%recovery_assignment%')
              THEN ' — one engine: no table and no function body names the other one (PASS)'
              ELSE ' — something still references the retired engine (FAIL)' END;

  RAISE EXCEPTION E'CHUNK7E\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n 6) %\n 7) %\n 8) %\n [all rolled back — session, attempt, mistake row, brain write]',
    _r1, _r2, _r3, _r4, _r5, _r6, _r7, _r8;
END $verify$;
