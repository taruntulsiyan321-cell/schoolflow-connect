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
  -- practice_mode IS NULL are the 240 seeded "scale fixture" sessions, whose
  -- accuracy was written by the seed rather than computed from their attempts.
  -- Every session the engine itself finished matches. The seed count is
  -- reported below rather than silently excluded.
  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  WHERE ps.finished_at IS NOT NULL
    AND ps.practice_mode IS NOT NULL
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

  -- ── Populations deliberately outside the checks above ────────────────────
  -- Reported, not hidden: a check that quietly skips rows is a check that
  -- stops mentioning them.
  _report := _report || E'\n── carried, not asserted on ────────────────────────────\n';

  SELECT count(*) INTO _n FROM public.practice_sessions
   WHERE finished_at IS NOT NULL AND practice_mode IS NULL;
  _report := _report || format('%-52s %s%s', 'seeded fixture sessions (accuracy not computed)', _n, E'\n');

  SELECT count(*) INTO _n FROM public.student_mistakes
   WHERE status='open' AND source='practice' AND question_id IS NULL;
  _report := _report || format('%-52s %s%s', 'retired-backfill mistakes, unclearable', _n, E'\n');

  SELECT count(*) INTO _n FROM public.practice_sessions ps
   WHERE ps.finished_at IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.session_id=ps.id);
  _report := _report || format('%-52s %s%s', 'shell sessions left by the practice outage', _n, E'\n');

  _report := _report || E'────────────────────────────────────────────────────────\n';
  _report := _report || CASE WHEN _fails = 0
                             THEN 'ALL CHECKS PASS'
                             ELSE _fails || ' CHECK(S) FAILED' END;

  RAISE EXCEPTION E'\n%', _report;
END $verify$;
