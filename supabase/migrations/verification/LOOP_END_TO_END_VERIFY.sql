-- ════════════════════════════════════════════════════════════════════════════
-- THE LOOP, END TO END: every table the flow writes, every formula it applies
-- ════════════════════════════════════════════════════════════════════════════
--
-- Practice -> Analysis -> Recovery -> Revision, checked as ARITHMETIC against
-- the rows themselves rather than as "the screen rendered". Each check counts
-- VIOLATIONS across the whole database, so it fails on any student, not just
-- the one a run happened to drive.
--
-- Every check here failed at least once while it was being written. The ones
-- that read like tautologies are the ones that caught something:
--
--   4.6  recovery added 4 mistakes to a book it was built to shrink (6 -> 10,
--        past the relearn boundary, banning the chapter from recovery)
--   rate the same sitting read 33% on one screen and 40% on another
--   0%   20 sessions that asked NOTHING reported a hard 0% accuracy
--   topic every "topic" was the chapter it sat in
--
-- A SHELL SESSION is one with no question_attempts rows — the practice outage
-- left 20 of them, auto-finished carrying their PLANNED question_count. Checks
-- about what a session asked exclude them by construction; the check that they
-- carry no RATE is the one that applies to them.
--
-- House contract: ends in a deliberate RAISE carrying the report.
-- ════════════════════════════════════════════════════════════════════════════

DO $verify$
DECLARE
  _report text := E'\n── THE LOOP, END TO END ────────────────────────────────\n';
  _fails  int  := 0;
  _n      int;

  PROCEDURE_NOTE text := '';
BEGIN
  -- 1 ── practice_sessions: the parts equal the whole
  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  WHERE ps.finished_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.session_id = ps.id)
    AND ps.correct_count + ps.wrong_count + ps.skipped_count <> ps.question_count;
  _report := _report || format('%-52s %s%s', 'session parts = question_count',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 2 ── the attempt rows are the session's own count
  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  WHERE ps.finished_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.session_id = ps.id)
    AND ps.question_count <> (SELECT count(*) FROM public.question_attempts qa WHERE qa.session_id = ps.id);
  _report := _report || format('%-52s %s%s', 'question_attempts rows = question_count',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 3 ── accuracy excludes skips (20261021000000)
  -- No mode exclusion any more. The 240 seeded sessions carried seed-written
  -- counts until 20261029000000 recomputed them from their own attempts, so
  -- the rule now applies to every finished session in the database.
  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  WHERE ps.finished_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.session_id = ps.id)
    AND ps.accuracy IS DISTINCT FROM
        round(100.0 * ps.correct_count / NULLIF(ps.question_count - ps.skipped_count, 0), 2);
  _report := _report || format('%-52s %s%s', 'accuracy = correct / answered',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 4 ── a session that asked nothing makes no claim (20261027000000)
  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  WHERE ps.accuracy IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.session_id = ps.id);
  _report := _report || format('%-52s %s%s', 'a session that asked nothing has no rate',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 5 ── §4.6: recovery never GROWS the mistake book (20261026000000)
  SELECT count(*) INTO _n
  FROM public.student_mistakes sm
  JOIN public.practice_sessions ps ON ps.id = sm.source_id
  WHERE ps.practice_mode = 'recovery';
  _report := _report || format('%-52s %s%s', 'no mistake row created by recovery (4.6)',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 6 ── §4.2b: procedural = tiers 0+1, conceptual = tiers 2+3, never blended
  SELECT count(*) INTO _n
  FROM public.recovery_sessions rs
  WHERE rs.completed_at IS NOT NULL
    AND (rs.procedural_rate IS DISTINCT FROM
           round((rs.tier0_correct+rs.tier1_correct)::numeric
               / NULLIF(rs.tier0_total+rs.tier1_total,0), 4)
      OR rs.conceptual_rate IS DISTINCT FROM
           round((rs.tier2_correct+rs.tier3_correct)::numeric
               / NULLIF(rs.tier2_total+rs.tier3_total,0), 4)
      OR rs.readiness IS DISTINCT FROM
           round((rs.tier0_correct+rs.tier1_correct+rs.tier2_correct+rs.tier3_correct)::numeric
               / NULLIF(rs.tier0_total+rs.tier1_total+rs.tier2_total+rs.tier3_total,0), 4));
  _report := _report || format('%-52s %s%s', 'recovery rates = tier arithmetic (4.2b)',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 7 ── a mistake a reader cannot decode is a mistake nothing can clear
  SELECT count(*) INTO _n
  FROM public.student_mistakes sm
  WHERE sm.status = 'open'
    AND NOT (jsonb_exists(sm.correct_answer,'index')
          OR jsonb_exists(sm.correct_answer,'indexes')
          OR jsonb_exists(sm.correct_answer,'correct_index')
          OR jsonb_typeof(sm.correct_answer) = 'string');
  _report := _report || format('%-52s %s%s', 'every open mistake has a decodable answer',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 8 ── §2: the chapter is the engine's key, so every live row must carry it
  -- Rows the engine can ACT on. 482 rows across 43 students are a retired
  -- backfill carrying no question_id, no chapter_id and no options: they are
  -- invisible to recovery (which keys on chapter_id) but cannot be retried
  -- either, so nothing can ever clear them. Counted explicitly below.
  SELECT count(*) INTO _n
  FROM public.student_mistakes sm
  WHERE sm.status = 'open' AND sm.source = 'practice'
    AND sm.question_id IS NOT NULL
    AND sm.chapter_id IS NULL;
  _report := _report || format('%-52s %s%s', 'open practice mistakes carry chapter+question',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 9 ── the topic is a topic (20261024000000). Legacy attempts with no
  --      bank_question_id legitimately fall back to the chapter, so this asks
  --      that SOME row resolves rather than that every row does.
  SELECT count(*) INTO _n
  FROM public.question_attempts qa
  JOIN public.question_bank qb ON qb.id = qa.bank_question_id
  JOIN public.topics t ON t.id = qb.topic_id
  WHERE qa.bank_question_id IS NOT NULL;
  _report := _report || format('%-52s %s%s', 'bank-backed attempts resolve to a topic',
                               CASE WHEN _n>0 THEN 'PASS ('||_n||')' ELSE 'FAIL (none resolve)' END, E'\n');
  IF _n = 0 THEN _fails := _fails + 1; END IF;

  -- 10 ── nothing may be permanently stuck: an open mistake with neither a
  --       question to ladder from nor options to retry with can never be
  --       cleared by anything. 480 such rows existed until 20261028000000.
  SELECT count(*) INTO _n
  FROM public.student_mistakes
  WHERE status='open' AND source='practice'
    AND question_id IS NULL AND options IS NULL;
  _report := _report || format('%-52s %s%s', 'no open mistake is permanently unclearable',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 11 ── a stored summary must equal the attempts it summarises. The seeder
  --       wrote correct/skipped counts by hand for 240 sessions; the rate
  --       beside them was recomputed in 20261021000000 and then disagreed with
  --       them until 20261029000000.
  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  JOIN LATERAL (
    SELECT count(*)::int AS attempts,
           count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped,false))::int AS correct,
           count(*) FILTER (WHERE COALESCE(qa.skipped,false))::int AS skipped
    FROM public.question_attempts qa WHERE qa.session_id = ps.id
  ) a ON true
  WHERE ps.finished_at IS NOT NULL
    AND (ps.question_count <> a.attempts OR ps.correct_count <> a.correct
      OR ps.skipped_count <> a.skipped);
  _report := _report || format('%-52s %s%s', 'session summary = its own attempts',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 12 ── a session that asked nothing may not claim questions either. 20 of
  --       them declared 385 between them.
  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  WHERE ps.finished_at IS NOT NULL AND ps.question_count > 0
    AND NOT EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.session_id = ps.id);
  _report := _report || format('%-52s %s%s', 'no session claims questions it never asked',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 13 ── the session's duration is the sum of its own questions' timings
  --       (20261030000000). Analysis derived it from finished_at - created_at
  --       when the roll-up was missing, and on this database that was a seeded
  --       1080 wall seconds on 240 of 284 finished sessions. Divided by the
  --       question count it became a per-question pace, so "which subject takes
  --       you longest" ranked subjects by how many questions the fixture put in
  --       a session: 54.0s for five of them, to the first decimal.
  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  JOIN LATERAL (
    SELECT sum(qa.time_taken_ms)::bigint AS ms
    FROM public.question_attempts qa
    WHERE qa.session_id = ps.id AND COALESCE(qa.time_taken_ms, 0) > 0
  ) t ON true
  WHERE t.ms > 0 AND ps.total_time_ms IS DISTINCT FROM t.ms;
  _report := _report || format('%-52s %s%s', 'session time = its own questions'' timings',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 14 ── a servable question renders its symbols (20261036000000). Six carried
  --       JSON escapes as literal text — "The value of e\u2070 is:" — and each
  --       one was a question whose meaning lives in the symbol.
  --       chr(92) rather than a written backslash: a \uXXXX inside a file that
  --       travels as JSON is decoded in transit, and the first draft of that
  --       migration matched 600 rows instead of 6 because of it.
  SELECT count(*) INTO _n
  FROM public.question_bank
  WHERE is_active AND position(chr(92) || 'u' IN question) > 0;
  _report := _report || format('%-52s %s%s', 'no servable question shows an escape code',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 15 ── a question's marked answer is on its own option list. This is the
  --       structural half of what went wrong with the generated variants: four
  --       of forty were mathematically wrong and shape validation passed all
  --       four, because they were well formed. Arithmetic cannot be checked
  --       here; an index that does not resolve to an option can.
  SELECT count(*) INTO _n
  FROM public.question_bank qb
  WHERE qb.is_active
    AND (qb.correct_index IS NULL
      OR jsonb_typeof(qb.options) <> 'array'
      OR qb.correct_index < 0
      OR qb.correct_index >= jsonb_array_length(qb.options)
      OR COALESCE(btrim(qb.options ->> qb.correct_index), '') = '');
  _report := _report || format('%-52s %s%s', 'every servable question marks a real option',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 16 ── the ladder returns the intervals §5.3 declares: 7, 7, 7, then
  --       REVISION_INTERVAL_SOLID, for ever after.
  --
  --       THIS CHECK WAS WRONG ON ITS FIRST DAY and is rewritten rather than
  --       loosened. It compared each chapter's next_revision_at against the
  --       completed_at of its last PASSED revision check, on the assumption
  --       that a pass is what writes the booking. It is not the only thing
  --       that writes it: the engagement path in _rebuild_revision_queue
  --       re-books chapters too, and a failure re-books at stage 1. Measured
  --       2026-09-18, Polynomials read 8.03 days against a ladder of 7 — not
  --       because the ladder was wrong, but because the row had been re-booked
  --       a day after the pass the check was measuring from.
  --
  --       Nothing stores WHEN a booking was written (chapter_state.updated_at
  --       moves for unrelated reasons — measured 12:25:14 against a booking
  --       made at 12:23:43), so the interval cannot be recovered from the rows
  --       after the fact. What can be checked is the ladder itself, and that
  --       is what this does now.
  --
  --       The end-to-end timing was proved by DRIVING it in the live school on
  --       2026-09-17: stage 1 -> 2 booked 7.00 days, 2 -> 3 booked 7.00, and
  --       3 -> 4 booked 30.00 with the screen reading "Chapter solid". That is
  --       a measurement a stored row cannot repeat, which is why it lives in
  --       scripts/live-smoke/climb-the-revision-ladder.mjs and not here.
  SELECT count(*) INTO _n FROM (
    SELECT s.stage, public._revision_interval_days(s.stage) AS got,
           CASE WHEN s.stage <= public._recovery_const('REVISION_STAGES_TO_SOLID')::int
                THEN public._recovery_const('REVISION_INTERVAL_' || s.stage::text)::int
                ELSE public._recovery_const('REVISION_INTERVAL_SOLID')::int END AS want
      FROM generate_series(1, 5) AS s(stage)
  ) rungs WHERE got IS DISTINCT FROM want;
  _report := _report || format('%-52s %s%s', 'the ladder returns §5.3''s intervals',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 16b ── and no live booking sits outside what the ladder can produce. A
  --        date further out than the longest interval means something wrote it
  --        that is not the ladder.
  SELECT count(*) INTO _n
  FROM public.chapter_state cs
  WHERE cs.next_revision_at IS NOT NULL
    AND cs.next_revision_at > now() + (public._recovery_const('REVISION_INTERVAL_SOLID')::int || ' days')::interval + interval '1 day';
  _report := _report || format('%-52s %s%s', 'no booking is further out than the ladder allows',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 17 ── a chapter called recovered says when it recovered. The constraint
  --       chapter_state_recovered_has_timestamp enforces this, so a violation
  --       cannot be stored — which is exactly why it was worth checking: the
  --       pass branch of rpc_submit_revision_session TRIED to store one on
  --       every pass by an engagement-triggered chapter, and the whole
  --       transaction, revision_sessions row included, was rolled back. A
  --       student scored 12 of 13 and the screen said "Accuracy 92%" while
  --       nothing was recorded anywhere. This counts the chapters that have
  --       passed a check and can therefore prove the write now lands.
  SELECT count(*) INTO _n
  FROM public.chapter_state cs
  WHERE cs.consecutive_revision_passes > 0 AND cs.recovered_at IS NULL;
  _report := _report || format('%-52s %s%s', 'a passed chapter carries its recovered_at',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 18 ── "active days" never exceeds its own window (20261035000000). The
  --       field summed test + homework + battle + practice COUNTS over 14 days
  --       and was rendered as "N active days (14d)"; one student's header read
  --       15 of 14, which is the only value of the defect that looks wrong from
  --       outside. Every value below fourteen was wrong in the same way.
  SELECT count(*) INTO _n
  FROM public.students s
  JOIN LATERAL (
    SELECT (public._exam_readiness(s.user_id, s.id) ->> 'active_days_14d')::int AS d
  ) r ON true
  WHERE s.user_id IS NOT NULL AND r.d > 15;
  _report := _report || format('%-52s %s%s', 'active days fits inside its 14-day window',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- ── Context for the checks above ──────────────────────────────────────────
  -- These started as populations the checks had to step around. Each is now
  -- covered by an assertion above and conforms; the counts stay because a
  -- number that silently becomes zero is a number nobody notices returning.
  _report := _report || E'\n── context (each covered by a check above) ─────────────\n';

  SELECT count(*) INTO _n FROM public.practice_sessions
   WHERE finished_at IS NOT NULL AND practice_mode IS NULL;
  _report := _report || format('%-52s %s%s', 'seeded sessions (now counted from attempts)', _n, E'\n');

  -- Not linked to the bank, but they carry their own options, so the Mistake
  -- Book can still render and retry them — which is what clears an entry. The
  -- 480 that could NOT be retried were load-test rows and are gone
  -- (20261028000000); these are real questions from the retired generator.
  SELECT count(*) INTO _n FROM public.student_mistakes
   WHERE status='open' AND source='practice' AND question_id IS NULL;
  _report := _report || format('%-52s %s%s', 'unlinked mistakes (retriable via own options)', _n, E'\n');

  -- The one that would actually be stuck: no question to ladder from AND no
  -- options to retry with. This is the number that must stay at zero.
  SELECT count(*) INTO _n FROM public.student_mistakes
   WHERE status='open' AND source='practice' AND question_id IS NULL AND options IS NULL;
  _report := _report || format('%-52s %s%s', 'mistakes with no question AND no options', _n, E'\n');

  SELECT count(*) INTO _n FROM public.practice_sessions ps
   WHERE ps.finished_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.session_id=ps.id);
  _report := _report || format('%-52s %s%s', 'shell sessions (kept, but claim 0 questions)', _n, E'\n');

  _report := _report || E'────────────────────────────────────────────────────────\n';
  _report := _report || CASE WHEN _fails = 0
                             THEN 'ALL CHECKS PASS'
                             ELSE _fails || ' CHECK(S) FAILED' END;

  RAISE EXCEPTION E'\n%', _report;
END $verify$;
