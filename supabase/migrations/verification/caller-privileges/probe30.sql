-- probe30: who may approve a question, as the caller.
--
-- 20260914030000 gave the central bank the reviewer §10.20 names — the super
-- admin — and took the approval bit away from the author, who could set it
-- themselves. Measured immediately before that migration, as the author:
--
--   UPDATE question_bank SET is_approved = true WHERE id = <my own>   -> OK: 1
--
-- so `is_approved`'s FALSE default, the whole protection added by
-- 20260907000000, was undoable by the one person it was protecting against.
--
-- THE CLAIMS
--   1. the teacher session is genuinely authenticated.        (harness control)
--   2. the super admin session is genuinely a super admin.     (harness control)
--   3. a teacher CANNOT approve their own question.                 <- the hole
--   4. ...but can still edit its TEXT.        (positive control: qb_staff_update
--      was narrowed by one column, not taken away)
--   5. a teacher cannot call rpc_review_question.
--   6. a teacher cannot read the review queue.
--   7. a super admin CAN read the queue and sees the pending question.
--   8. a super admin CAN approve it, and the row records who and when.
--   9. a super admin can reject with a note, and it is not a delete.
--  10. an empty note is stored as NULL, not ''.
--
-- Claims 1 and 2 exist because 3, 5 and 6 are denials — a probe whose sessions
-- were never established would score three passes for the wrong reason. Claim 4
-- exists because "the author cannot approve" and "the author cannot edit" are
-- one character apart in a policy and only one of them is intended.
--
-- Every write is rolled back.
BEGIN;
SET LOCAL statement_timeout = '30s';
CREATE TEMP TABLE probe(n serial, area text, role_tested text, expected text, observed text, verdict text) ON COMMIT DROP;
CREATE FUNCTION pg_temp.as_user(_uid uuid, _sql text) RETURNS text
LANGUAGE plpgsql AS $fn$
DECLARE _out text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub',_uid,'role','authenticated')::text, true);
  PERFORM set_config('role','authenticated', true);
  BEGIN
    EXECUTE _sql INTO _out;
    PERFORM set_config('role','postgres', true);
    RETURN 'OK: ' || coalesce(_out,'null');
  EXCEPTION WHEN OTHERS THEN
    PERFORM set_config('role','postgres', true);
    RETURN 'ERROR: ' || SQLERRM;
  END;
END $fn$;

DO $probe$
DECLARE
  t1  uuid := 'd1000002-0001-4000-8000-000000000001';  -- teacher, school A
  sup uuid := 'd1000005-0001-4000-8000-000000000001';  -- super admin
  ch  uuid;
  qid uuid;
  r   text;
BEGIN
  SELECT c.id INTO ch FROM public.chapters c ORDER BY c.id LIMIT 1;
  IF ch IS NULL THEN RAISE EXCEPTION 'probe30: the curriculum has no chapters'; END IF;

  -- A pending contribution, authored by the teacher.
  INSERT INTO public.question_bank
    (subject, chapter_id, question, options, correct_index, created_by, is_approved)
  VALUES ('Mathematics', ch, 'probe30 pending question', '["a","b","c","d"]'::jsonb, 0, t1, false)
  RETURNING id INTO qid;

  -- ── 1/2. the sessions are real ─────────────────────────────────────────
  r := pg_temp.as_user(t1, 'SELECT public.get_my_role()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the teacher session is genuinely authenticated (control)','teacher','OK: teacher', r,
     CASE WHEN r = 'OK: teacher' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(sup, 'SELECT public.is_super_admin()::text');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the super admin session really is one (control)','super_admin','OK: true', r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 3. the hole ────────────────────────────────────────────────────────
  r := pg_temp.as_user(t1, format(
        'WITH u AS (UPDATE public.question_bank SET is_approved = true WHERE id = %L::uuid RETURNING id) '
        'SELECT count(*)::text FROM u', qid));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('approve my OWN contribution','teacher (the author)','ERROR only a super admin', r,
     CASE WHEN r LIKE 'ERROR%only a super admin%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 4. ...but the question is still theirs to edit ────────────────────
  r := pg_temp.as_user(t1, format(
        'WITH u AS (UPDATE public.question_bank SET question = ''probe30 edited by author'' '
        'WHERE id = %L::uuid RETURNING id) SELECT count(*)::text FROM u', qid));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('edit my own question''s TEXT (positive control)','teacher (the author)','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 5/6. the reviewer surface is not a teacher's ──────────────────────
  r := pg_temp.as_user(t1, format(
        'SELECT public.rpc_review_question(%L::uuid, true, NULL)::text', qid));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('call rpc_review_question','teacher','ERROR only a super admin', r,
     CASE WHEN r LIKE 'ERROR%super admin%' THEN 'PASS' ELSE 'FAIL' END);

  r := pg_temp.as_user(t1, 'SELECT count(*)::text FROM public.rpc_question_bank_review_queue(50, 0)');
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('read the review queue','teacher','ERROR only a super admin', r,
     CASE WHEN r LIKE 'ERROR%super admin%' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 7. the reviewer can see what is waiting ───────────────────────────
  r := pg_temp.as_user(sup, format(
        'SELECT count(*)::text FROM public.rpc_question_bank_review_queue(200, 0) q WHERE q.id = %L::uuid', qid));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('the pending question is in the queue (positive control)','super_admin','OK: 1', r,
     CASE WHEN r = 'OK: 1' THEN 'PASS' ELSE 'FAIL' END);

  -- ── 8. ...and can approve it, with provenance ─────────────────────────
  r := pg_temp.as_user(sup, format(
        'SELECT (public.rpc_review_question(%L::uuid, true, ''looks right'')->>''is_approved'')', qid));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('approve a contributed question','super_admin','OK: true', r,
     CASE WHEN r = 'OK: true' THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'the approval records WHO and WHEN','super_admin','approved_by = the reviewer',
         CASE WHEN qb.approved_by = sup AND qb.approved_at IS NOT NULL
              THEN 'approved_by = the reviewer' ELSE 'approved_by=' || coalesce(qb.approved_by::text,'null') END,
         CASE WHEN qb.approved_by = sup AND qb.approved_at IS NOT NULL THEN 'PASS' ELSE 'FAIL' END
    FROM public.question_bank qb WHERE qb.id = qid;

  -- ── 9. rejection keeps the row ────────────────────────────────────────
  r := pg_temp.as_user(sup, format(
        'SELECT (public.rpc_review_question(%L::uuid, false, ''ambiguous stem'')->>''review_note'')', qid));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('reject with a reason','super_admin','OK: ambiguous stem', r,
     CASE WHEN r = 'OK: ambiguous stem' THEN 'PASS' ELSE 'FAIL' END);

  INSERT INTO probe(area,role_tested,expected,observed,verdict)
  SELECT 'a rejected question still EXISTS (it may be in a mistake book)','-','1 row',
         count(*)::text || ' row', CASE WHEN count(*) = 1 THEN 'PASS' ELSE 'FAIL' END
    FROM public.question_bank WHERE id = qid;

  -- ── 10. an empty note is no note ──────────────────────────────────────
  r := pg_temp.as_user(sup, format(
        'SELECT coalesce((public.rpc_review_question(%L::uuid, true, ''   '')->>''review_note''), ''NULL'')', qid));
  INSERT INTO probe(area,role_tested,expected,observed,verdict) VALUES
    ('a blank note is stored as NULL, not an empty string','super_admin','OK: NULL', r,
     CASE WHEN r = 'OK: NULL' THEN 'PASS' ELSE 'FAIL' END);
END $probe$;

SELECT area, role_tested, expected, observed, verdict FROM probe ORDER BY n;
ROLLBACK;
