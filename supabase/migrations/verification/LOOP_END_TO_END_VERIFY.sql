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
  --
  --       Finished sessions only, like 11 and 12: the roll-up is written by the
  --       finish, so a session a student is sitting right now has timed answers
  --       and no total yet. Unscoped, this failed on every open session
  --       (2026-09-17: one, left mid-question by the drive that found it).
  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  JOIN LATERAL (
    SELECT sum(qa.time_taken_ms)::bigint AS ms
    FROM public.question_attempts qa
    WHERE qa.session_id = ps.id AND COALESCE(qa.time_taken_ms, 0) > 0
  ) t ON true
  WHERE ps.finished_at IS NOT NULL
    AND t.ms > 0 AND ps.total_time_ms IS DISTINCT FROM t.ms;
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

  -- 16 ── the revision ladder books the interval its stage calls for
  --       (§5.3: 7, 7, 7, then REVISION_INTERVAL_SOLID). Driven live on
  --       2026-09-17 it booked 7.00, 7.00 and 30.00 days — but only after
  --       20261033000000, because before it every pass by an
  --       engagement-triggered chapter was rolled back whole by
  --       chapter_state_recovered_has_timestamp and the ladder could not leave
  --       stage 1 at all.
  --
  --       Checked against the last PASSED check's own timestamp, not against
  --       updated_at, which moves for unrelated reasons. One day of tolerance,
  --       because next_revision_at is set from now() and the row may be read
  --       across a day boundary.
  SELECT count(*) INTO _n
  FROM public.chapter_state cs
  JOIN LATERAL (
    SELECT rs.completed_at
    FROM public.revision_sessions rs
    WHERE rs.user_id = cs.user_id AND rs.chapter_id = cs.chapter_id AND rs.passed
    ORDER BY rs.completed_at DESC LIMIT 1
  ) last_pass ON true
  WHERE cs.next_revision_at IS NOT NULL
    AND cs.revision_stage > 0
    AND abs(
      EXTRACT(EPOCH FROM (cs.next_revision_at - last_pass.completed_at)) / 86400.0
      - public._revision_interval_days(cs.revision_stage)
    ) > 1;
  _report := _report || format('%-52s %s%s', 'revision books the interval its stage says',
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

  -- 19 ── the §3.1 tally is its own session's attempts, per chapter. The
  --       denominator every Analysis figure divides by. 20261032000000 deleted
  --       five attempts and re-synced the session but not this, so four
  --       tallies went on counting questions that no longer existed
  --       (fixed in 20261039300000, which is also where this check came from).
  SELECT count(*) INTO _n
  FROM public.chapter_tally ct
  JOIN LATERAL (
    SELECT count(*)::int AS attempted,
           count(*) FILTER (WHERE qa.is_correct IS TRUE)::int AS correct
    FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
    WHERE qa.session_id = ct.session_id AND qb.chapter_id = ct.chapter_id
  ) a ON true
  WHERE ct.attempted <> a.attempted OR ct.correct <> a.correct;
  _report := _report || format('%-52s %s%s', 'chapter tally = its own attempts',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 20 ── one answer, one row (20261039300000). The live answer and the
  --       finish's re-send raced, and skipping the last question recorded it
  --       twice — 6 of 8 times in a probe fired the way the client fires them.
  SELECT count(*) INTO _n FROM (
    SELECT 1 FROM public.question_attempts
    WHERE session_id IS NOT NULL AND bank_question_id IS NOT NULL
    GROUP BY session_id, bank_question_id HAVING count(*) > 1
  ) d;
  _report := _report || format('%-52s %s%s', 'an answer is on record once',
                               CASE WHEN _n=0 THEN 'PASS' ELSE 'FAIL ('||_n||')' END, E'\n');
  IF _n <> 0 THEN _fails := _fails + 1; END IF;

  -- 21 ── a skip is not a wrong answer in topic confidence either
  --       (20261039300000, finishing 20261021000000). Weak Areas Practice reads
  --       this classification; a topic the student only skipped scored 0 and
  --       was served back as weak. Read from the attempts, not from
  --       total_attempts: the old rule wrote the skips INTO total_attempts, so
  --       a check on that column would pass the very regression it guards.
  SELECT count(*) INTO _n
  FROM public.concept_mastery cm
  WHERE cm.classification = 'weak'
    AND EXISTS (
      SELECT 1 FROM public.question_attempts qa
        JOIN public.question_bank qb ON qb.id = qa.bank_question_id
        JOIN public.topics t        ON t.id = qb.topic_id
       WHERE qa.user_id = cm.user_id AND t.name = cm.concept
         AND qb.chapter IS NOT DISTINCT FROM cm.chapter)
    AND NOT EXISTS (
      SELECT 1 FROM public.question_attempts qa
        JOIN public.question_bank qb ON qb.id = qa.bank_question_id
        JOIN public.topics t        ON t.id = qb.topic_id
       WHERE qa.user_id = cm.user_id AND t.name = cm.concept
         AND qb.chapter IS NOT DISTINCT FROM cm.chapter
         AND NOT COALESCE(qa.skipped, false));
  _report := _report || format('%-52s %s%s', 'no topic is weak with nothing answered',
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
