-- ═══════════════════════════════════════════════════════════════════════════
-- REPORT CHECKS MADE IN THE SAME MINUTE TAKE DIFFERENT QUESTIONS
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Measured on live 2026-10-03, the first end-to-end run of 20261139000000:
-- three reports on three questions, and dispatch_question_reports made three
-- calls in the same minute — but only one question was checked that minute.
-- claim_question_reports chose the OLDEST waiting question first and locked
-- its reports second, so every call made at once chose the same question; the
-- first locked its reports and the others skipped them and came away with
-- nothing. Three questions took three minutes, and a busy queue would wait
-- far longer.
--
-- The rewrite locks the QUESTION as it is chosen (FOR UPDATE OF q SKIP
-- LOCKED, in age order): a question another call is claiming is skipped, and
-- the next one taken. The lock lasts only as long as the claim itself.
--
-- Concurrency cannot be shown inside one transaction — a session never waits
-- on its own locks — so the PROOF below holds what a single call does, and the
-- parallel claim is measured on live after applying (three reports, one minute).
--
-- ROLLBACK: rollback/20261140000000_report_checks_in_one_minute_take_different_questions.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.claim_question_reports(_limit integer)
RETURNS TABLE (question_id uuid, exam_code text, class_level integer, board text, subject text, chapter text,
               topic text, question text, options jsonb, correct_index integer, explanation text,
               explanation_status text, reports jsonb)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  -- A run that died holding reports gives them back after 15 minutes.
  UPDATE public.question_reports r
     SET status = 'open', checked_at = NULL, updated_at = now()
   WHERE r.status = 'checking' AND r.checked_at < now() - interval '15 minutes';

  RETURN QUERY
  WITH picked AS (
    -- The oldest waiting questions no other call is claiming right now.
    SELECT q.id AS qid
      FROM public.question_bank q
     WHERE q.is_active
       AND EXISTS (SELECT 1 FROM public.question_reports r WHERE r.question_id = q.id AND r.status = 'open')
     ORDER BY (SELECT min(r.created_at) FROM public.question_reports r
                WHERE r.question_id = q.id AND r.status = 'open'), q.id
     LIMIT greatest(1, least(_limit, 10))
       FOR UPDATE OF q SKIP LOCKED
  ), locked AS (
    SELECT r.id AS rid
      FROM public.question_reports r
      JOIN picked p ON p.qid = r.question_id
     WHERE r.status = 'open'
       FOR UPDATE OF r SKIP LOCKED
  ), u AS (
    UPDATE public.question_reports r
       SET status = 'checking', checked_at = now(), updated_at = now()
      FROM locked l
     WHERE r.id = l.rid
    RETURNING r.question_id AS qid, r.id AS rid, r.reason AS rreason, r.claimed_index AS rclaimed,
              r.note AS rnote, r.created_at AS rcreated
  )
  SELECT q.id, ce.code, q.class_level, q.board, q.subject, q.chapter, t.name,
         q.question, q.options, q.correct_index, q.explanation, q.explanation_status,
         jsonb_agg(jsonb_build_object('id', u.rid, 'reason', u.rreason, 'claimed_index', u.rclaimed, 'note', u.rnote)
                   ORDER BY u.rcreated)
    FROM u
    JOIN public.question_bank q ON q.id = u.qid
    LEFT JOIN public.competitive_exams ce ON ce.id = q.exam_id
    LEFT JOIN public.topics t ON t.id = q.topic_id
   GROUP BY q.id, ce.code, t.name;
END $fn$;

-- CREATE OR REPLACE keeps the grants; said again so this file reads whole.
REVOKE ALL ON FUNCTION public.claim_question_reports(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_question_reports(integer) TO service_role;

-- ── PROOF: what one call takes, in what order; rolled back ─────────────────
DO $proof$
DECLARE
  _exam constant uuid := '5a78f1f8-cf43-4631-a9de-4abc7d6a8d9d';
  _fail text := '';
  _sentinel constant text := 'm20261140 proof rolled back';
  _a uuid; _b uuid; _topic uuid; _r jsonb; _qs uuid[]; _n integer; _got uuid[];
BEGIN
  SELECT st.user_id, t.id INTO _a, _topic
    FROM public.students st
    JOIN public.schools s ON s.id = st.school_id AND s.kind = 'individual'
    JOIN public.exam_accounts ea ON ea.school_id = st.school_id AND ea.exam_id = _exam
    JOIN public.exam_syllabus_chapters sc ON sc.exam_id = ea.exam_id AND sc.stream = ea.stream
    JOIN public.topics t ON t.chapter_id = sc.chapter_id
   WHERE st.user_id IS NOT NULL
   ORDER BY st.user_id, t.id LIMIT 1;
  SELECT st.user_id INTO _b FROM public.students st
   WHERE st.user_id IS NOT NULL AND st.user_id <> _a ORDER BY st.user_id LIMIT 1;
  IF _a IS NULL OR _b IS NULL OR _topic IS NULL THEN
    RAISE EXCEPTION 'PROOF FAILED: fixture missing (a % b % topic %)', _a, _b, _topic;
  END IF;

  BEGIN
    -- Nothing else waits while this runs.
    UPDATE public.question_reports SET status = 'withdrawn', outcome = 'proof', resolved_at = now()
     WHERE status IN ('open', 'checking');

    _r := public.store_generated_questions((
      SELECT jsonb_agg(jsonb_build_object('topic_id', _topic, 'exam_id', _exam,
               'question', format('Probe 20261140 q%s: which is a source of finance for a partnership firm?', n),
               'options', jsonb_build_array('Capital', 'Goodwill', 'Drawings', 'Dividend'),
               'correct_index', 0, 'difficulty', 'medium', 'source', 'ai_practice') ORDER BY n)
        FROM generate_series(1, 4) n));
    IF (_r->>'inserted_count')::int <> 4 THEN RAISE EXCEPTION 'PROOF FAILED: fixture questions %', _r; END IF;
    SELECT array_agg(q.id ORDER BY q.question) INTO _qs
      FROM public.question_bank q WHERE q.id IN (SELECT (e->>'id')::uuid FROM jsonb_array_elements(_r->'inserted') e);

    -- Reported oldest first: q3, then q1, then q2 (two reports); q4 is retired.
    INSERT INTO public.question_reports (user_id, question_id, reason, question_text, options, created_at) VALUES
      (_a, _qs[3], 'question_error', 'p', '[]', now() - interval '3 minutes'),
      (_a, _qs[1], 'question_error', 'p', '[]', now() - interval '2 minutes'),
      (_a, _qs[2], 'question_error', 'p', '[]', now() - interval '1 minute'),
      (_b, _qs[2], 'wrong_answer',   'p', '[]', now()),
      (_a, _qs[4], 'question_error', 'p', '[]', now() - interval '10 minutes');
    UPDATE public.question_bank SET is_active = false WHERE id = _qs[4];

    -- One call takes the oldest question, and all of its waiting reports.
    SELECT array_agg(c.question_id), sum(jsonb_array_length(c.reports)) INTO _got, _n FROM public.claim_question_reports(1) c;
    IF _got IS DISTINCT FROM ARRAY[_qs[3]] OR _n <> 1 THEN _fail := _fail || format(' [1 first claim took %s (%s reports)]', _got, _n); END IF;
    -- The next call, the next oldest: never the one already taken.
    SELECT array_agg(c.question_id) INTO _got FROM public.claim_question_reports(1) c;
    IF _got IS DISTINCT FROM ARRAY[_qs[1]] THEN _fail := _fail || format(' [1 second claim took %s]', _got); END IF;
    -- A call for more takes what is left — both reports on q2 — and never the retired q4.
    SELECT array_agg(c.question_id), sum(jsonb_array_length(c.reports)) INTO _got, _n FROM public.claim_question_reports(10) c;
    IF _got IS DISTINCT FROM ARRAY[_qs[2]] OR _n <> 2 THEN _fail := _fail || format(' [1 third claim took %s (%s reports)]', _got, _n); END IF;
    SELECT count(*) INTO _n FROM public.claim_question_reports(10);
    IF _n <> 0 THEN _fail := _fail || format(' [1 an empty queue gave %s]', _n); END IF;
    -- An abandoned claim comes back.
    UPDATE public.question_reports SET checked_at = now() - interval '1 hour' WHERE question_id = _qs[1];
    SELECT array_agg(c.question_id) INTO _got FROM public.claim_question_reports(10) c;
    IF _got IS DISTINCT FROM ARRAY[_qs[1]] THEN _fail := _fail || format(' [1 the abandoned claim came back as %s]', _got); END IF;

    RAISE EXCEPTION USING MESSAGE = _sentinel;
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> _sentinel THEN
      RAISE EXCEPTION 'PROOF FAILED (unexpected %): %', SQLSTATE, SQLERRM;
    END IF;
  END;

  IF _fail <> '' THEN
    RAISE EXCEPTION 'PROOF FAILED:%', _fail;
  END IF;
END $proof$;

COMMIT;
