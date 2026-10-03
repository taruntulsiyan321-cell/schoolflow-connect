-- Rollback for 20261139000000: no report check job, no report functions, no
-- question.report limit; question_reports back in chunk 7A's shape (as it
-- was live on 2026-10-03, default grants included); claim_explanation_rewrites
-- as 20261138000000 left it.
--
-- DATA IS NOT UNDONE, and some is LOST:
--   - every report is dropped with the table — export them first:
--       SELECT * FROM question_reports;
--   - questions the check corrected, rewrote or withdrew stay that way, and
--     so does every student record it moved (attempts out of accuracy,
--     mistakes cleared or moved, bookmarks moved) and every notification sent.
BEGIN;

SELECT cron.unschedule('check-question-reports');
DROP FUNCTION public.dispatch_question_reports();
DROP FUNCTION public.apply_question_report_verdict(uuid, jsonb);
DROP FUNCTION public._retire_reported_question(uuid, uuid, boolean, text);
DROP FUNCTION public.claim_question_reports(integer);
DROP FUNCTION public.rpc_report_question(uuid, text, integer, text, uuid);

DROP TABLE public.question_reports;

CREATE TABLE public.question_reports (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id             uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  reported_by_account_id  uuid NOT NULL,
  reason                  text NOT NULL,
  body                    text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX question_reports_question_idx ON public.question_reports (question_id);

ALTER TABLE public.question_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY question_reports_insert ON public.question_reports
  FOR INSERT TO authenticated
  WITH CHECK (reported_by_account_id = (SELECT auth.uid()));

CREATE POLICY question_reports_own_read ON public.question_reports
  FOR SELECT TO authenticated
  USING (reported_by_account_id = (SELECT auth.uid()));

CREATE POLICY question_reports_super_read ON public.question_reports
  FOR SELECT TO authenticated
  USING ((SELECT public.is_super_admin()));

GRANT ALL ON public.question_reports TO anon, authenticated, service_role;

COMMENT ON TABLE public.question_reports IS
  'Chunk 7A. Question quality reports from the practice UI. Global (G2): no institution scope, and no school-side reader — the report goes to the AI and super admin, never to the school, because practice is private to the student.';

DELETE FROM public.premium_usage    WHERE feature_code = 'question.report';
DELETE FROM public.premium_limits   WHERE feature_code = 'question.report';
DELETE FROM public.premium_features WHERE code         = 'question.report';

DROP FUNCTION public.claim_explanation_rewrites(integer);

CREATE FUNCTION public.claim_explanation_rewrites(_limit integer)
RETURNS TABLE (id uuid, subject text, chapter text, topic text, question text, options jsonb, correct_index integer, explanation text)
LANGUAGE plpgsql
SET search_path = public
AS $fn$
BEGIN
  -- A run that died holding rows gives them back after 15 minutes.
  UPDATE public.question_bank q
     SET explanation_status = 'pending', explanation_claimed_at = NULL
   WHERE q.explanation_status = 'rewriting'
     AND q.explanation_claimed_at < now() - interval '15 minutes';

  RETURN QUERY
  WITH c AS (
    SELECT q.id AS qid
      FROM public.question_bank q
     WHERE q.explanation_status = 'pending'
       AND q.is_active
       AND q.exam_id IS NOT NULL
       AND q.correct_index IS NOT NULL
       AND jsonb_typeof(q.options) = 'array'
       AND jsonb_array_length(q.options) BETWEEN 2 AND 8
     ORDER BY q.id
     LIMIT greatest(1, least(_limit, 50))
     FOR UPDATE SKIP LOCKED
  ), u AS (
    UPDATE public.question_bank qb
       SET explanation_status = 'rewriting', explanation_claimed_at = now()
      FROM c
     WHERE qb.id = c.qid
    RETURNING qb.id AS rid, qb.subject AS rsubject, qb.chapter AS rchapter, qb.topic_id AS rtopic,
              qb.question AS rquestion, qb.options AS roptions, qb.correct_index AS rindex, qb.explanation AS rexpl
  )
  SELECT u.rid, u.rsubject, u.rchapter, t.name, u.rquestion, u.roptions, u.rindex, u.rexpl
    FROM u LEFT JOIN public.topics t ON t.id = u.rtopic;
END $fn$;

REVOKE ALL ON FUNCTION public.claim_explanation_rewrites(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_explanation_rewrites(integer) TO service_role;

COMMIT;
