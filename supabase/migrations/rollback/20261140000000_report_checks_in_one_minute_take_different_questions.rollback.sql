-- Rollback for 20261140000000: claim_question_reports as 20261139000000 wrote it —
-- calls made in the same minute choose the same oldest question again, and
-- all but one come away with nothing. No data to undo.
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
    SELECT r.question_id AS qid
      FROM public.question_reports r
      JOIN public.question_bank q ON q.id = r.question_id AND q.is_active
     WHERE r.status = 'open'
     GROUP BY r.question_id
     ORDER BY min(r.created_at), r.question_id
     LIMIT greatest(1, least(_limit, 10))
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

REVOKE ALL ON FUNCTION public.claim_question_reports(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_question_reports(integer) TO service_role;

COMMIT;
