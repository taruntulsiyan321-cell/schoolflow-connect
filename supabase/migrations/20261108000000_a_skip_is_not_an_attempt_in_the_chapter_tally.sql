-- ===========================================================================
-- A SKIP IS NOT AN ATTEMPT IN THE CHAPTER TALLY
--
-- "Every accuracy figure, every trend, and every 'is this improving' answer
-- comes from this table" (spec §3.1) — and _write_chapter_tally counted every
-- row of a session as `attempted`, skips included, while §6.6 says a skip is a
-- distinct signal: "the student didn't attempt it". So a skipped question
-- counted against a chapter's accuracy and trend exactly like a wrong answer,
-- and three skips in a chapter were "meaningful engagement" that scheduled a
-- revision (REVISION_ENGAGEMENT_MIN reads `attempted`). The session result and
-- rpc_student_practice_analytics already leave skips out, so the same session
-- read 50% on its result screen and 33% in its chapter (measured 2026-09-25 on
-- the CUET audit account: Accounting for Partnership, 1 skipped + 1 right,
-- tallied 1 of 2). Measured across the table: 1,409 of 1,795 rows, 3,510
-- "attempted" of which about 1,087 were answered.
--
-- It also left out what a won dispute excludes (upload §6.1): the attempt left
-- accuracy everywhere else, and the tally — written before the dispute — kept
-- it. The dispute now writes the tally again for the sessions it touched.
--
-- Every existing row is recomputed; what it held is logged for the rollback.
--
-- ROLLBACK: rollback/20261108000000_a_skip_is_not_an_attempt_in_the_chapter_tally.rollback.sql
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._write_chapter_tally(_session_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n integer := 0;
BEGIN
  -- One row per DISTINCT chapter in the session. chapter_id from, in order:
  --   1. question_bank.chapter_id
  --   2. generated_question.chapter_id when it EXISTS in public.chapters
  --   3. student_upload_questions.chapter_id
  --   4. student_capture_questions.chapter_id
  -- Untagged private rows (null chapter_id) still do not tally.
  INSERT INTO public.chapter_tally (user_id, student_id, school_id, chapter_id, session_id, attempted, correct)
  SELECT ps.user_id, ps.student_id, ps.school_id, resolved.chapter_id, ps.id,
         -- ANSWERED, not shown: a skip is its own signal and never a wrong
         -- answer (§6.6), and an attempt excluded by a won dispute is out of
         -- accuracy everywhere (upload §6.1). The same filter the session
         -- result and rpc_student_practice_analytics use.
         count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)
                            AND NOT COALESCE(qa.excluded_from_accuracy, false))::int,
         count(*) FILTER (WHERE qa.is_correct IS TRUE
                            AND NOT COALESCE(qa.skipped, false)
                            AND NOT COALESCE(qa.excluded_from_accuracy, false))::int
    FROM public.question_attempts qa
    JOIN public.practice_sessions ps ON ps.id = qa.session_id
    LEFT JOIN public.question_bank qb ON qb.id = qa.bank_question_id
    LEFT JOIN public.student_upload_questions suq
      ON (qa.generated_question->>'upload_question_id') ~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     AND suq.id = (qa.generated_question->>'upload_question_id')::uuid
    LEFT JOIN public.student_capture_questions scq
      ON (qa.generated_question->>'capture_question_id') ~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     AND scq.id = (qa.generated_question->>'capture_question_id')::uuid
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        qb.chapter_id,
        CASE
          WHEN (qa.generated_question->>'chapter_id') ~
                 '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           AND EXISTS (
             SELECT 1 FROM public.chapters c
              WHERE c.id = (qa.generated_question->>'chapter_id')::uuid
           )
          THEN (qa.generated_question->>'chapter_id')::uuid
          ELSE NULL
        END,
        suq.chapter_id,
        scq.chapter_id
      ) AS chapter_id
    ) resolved
   WHERE qa.session_id = _session_id
     AND resolved.chapter_id IS NOT NULL
   GROUP BY ps.user_id, ps.student_id, ps.school_id, resolved.chapter_id, ps.id
  ON CONFLICT (session_id, chapter_id) DO UPDATE
    SET attempted = EXCLUDED.attempted,
        correct   = EXCLUDED.correct;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_dispute_ai_upload_answer(_upload_question_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _uq public.student_upload_questions%ROWTYPE;
  _cleared int := 0;
  _excluded int := 0;
  _sessions uuid[];
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF _upload_question_id IS NULL THEN
    RAISE EXCEPTION 'upload question id required';
  END IF;

  -- Owner fence: a non-owner sees "not found", never another account's row.
  SELECT * INTO _uq
    FROM public.student_upload_questions
   WHERE id = _upload_question_id
     AND owner_id = _uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'upload question not found';
  END IF;

  IF _uq.answer_source IS DISTINCT FROM 'ai' THEN
    RAISE EXCEPTION 'only AI-answered questions can be disputed';
  END IF;

  -- Clear open mistakes for this upload original (§6.1 / §9.1).
  -- Primary: upload_question_id (700). Legacy: text match with no bank id.
  UPDATE public.student_mistakes sm
     SET status = 'cleared',
         cleared_at = now()
   WHERE sm.user_id = _uid
     AND sm.status = 'open'
     AND (
       sm.upload_question_id = _upload_question_id
       OR (
         sm.upload_question_id IS NULL
         AND sm.question_id IS NULL
         AND sm.question_text = _uq.question_text
         AND (
           sm.source = 'upload'
           OR sm.source = 'practice'
         )
       )
     );
  GET DIAGNOSTICS _cleared = ROW_COUNT;

  -- Exclude matching upload attempts from accuracy (keep the rows).
  WITH ex AS (
    UPDATE public.question_attempts qa
       SET excluded_from_accuracy = true
     WHERE qa.user_id = _uid
       AND qa.source = 'upload'
       AND qa.source_id = _uq.upload_id
       AND NOT qa.excluded_from_accuracy
       AND (
         qa.generated_question->>'upload_question_id' = _upload_question_id::text
         OR qa.generated_question->>'question' = _uq.question_text
         OR qa.generated_question->>'text' = _uq.question_text
       )
    RETURNING qa.session_id
  )
  SELECT count(*)::int, array_agg(DISTINCT session_id) INTO _excluded, _sessions FROM ex;

  -- The chapter accuracy is the tally's (§3.1), written when the session
  -- finished — before this dispute. Write it again for every session the
  -- dispute touched, or the answer keeps counting there.
  PERFORM public._write_chapter_tally(s) FROM unnest(COALESCE(_sessions, ARRAY[]::uuid[])) s WHERE s IS NOT NULL;

  RETURN jsonb_build_object(
    'ok', true,
    'upload_question_id', _upload_question_id,
    'cleared_mistakes', _cleared,
    'excluded_attempts', _excluded
  );
END;
$function$;

CREATE TABLE public.chapter_tally_recount_20261108 (
  tally_id  uuid PRIMARY KEY,
  attempted integer NOT NULL,
  correct   integer NOT NULL
);
ALTER TABLE public.chapter_tally_recount_20261108 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chapter_tally_recount_20261108 FROM PUBLIC, anon, authenticated;

CREATE TEMP TABLE _rows_before ON COMMIT DROP AS SELECT count(*)::int AS n FROM public.chapter_tally;

INSERT INTO public.chapter_tally_recount_20261108 (tally_id, attempted, correct)
SELECT id, attempted, correct FROM public.chapter_tally;

SELECT public._write_chapter_tally(s.session_id)
  FROM (SELECT DISTINCT session_id FROM public.chapter_tally) s;

-- A recount corrects rows; it does not add them. Where a session's questions
-- have since moved chapter (the 2026-09-25 NTA rebuild), the writer resolves
-- them to the new one and would insert a second row for history already
-- recorded under the old — measured: 2 such rows. They go.
DELETE FROM public.chapter_tally ct
 WHERE NOT EXISTS (SELECT 1 FROM public.chapter_tally_recount_20261108 r WHERE r.tally_id = ct.id);

-- Rows that did not change are not the rollback's business.
DELETE FROM public.chapter_tally_recount_20261108 r
 USING public.chapter_tally ct
 WHERE ct.id = r.tally_id AND ct.attempted = r.attempted AND ct.correct = r.correct;

-- ── Verify (each check can fail) ─────────────────────────────────────────────
DO $proof$
DECLARE _n int; _att int; _cor int; _rows_before int := (SELECT n FROM _rows_before);
BEGIN
  -- No tally row counts more answers than its session answered in that chapter.
  SELECT count(*) INTO _n FROM public.chapter_tally ct
   WHERE ct.attempted > (
     SELECT count(*) FROM public.question_attempts qa
      WHERE qa.session_id = ct.session_id
        AND NOT COALESCE(qa.skipped, false) AND NOT COALESCE(qa.excluded_from_accuracy, false));
  IF _n <> 0 THEN RAISE EXCEPTION '% tally rows still count skipped or excluded answers', _n; END IF;

  -- The measured case: 1 skipped + 1 right in Accounting for Partnership is 1 of 1.
  SELECT ct.attempted, ct.correct INTO _att, _cor
    FROM public.chapter_tally ct JOIN public.chapters c ON c.id = ct.chapter_id
   WHERE ct.session_id = '066bf890-1df7-4c23-b552-88cb1432d7f2' AND c.name = 'Accounting for Partnership';
  IF _att IS NOT NULL AND (_att <> 1 OR _cor <> 1) THEN
    RAISE EXCEPTION 'the measured session reads % of %, expected 1 of 1', _cor, _att;
  END IF;

  IF (SELECT count(*) FROM public.chapter_tally) <> _rows_before THEN
    RAISE EXCEPTION 'the recount changed the number of tally rows';
  END IF;

  -- CONTROL: the recount changed rows — a writer that ignored its new filter
  -- would leave the log empty.
  SELECT count(*) INTO _n FROM public.chapter_tally_recount_20261108;
  IF _n = 0 THEN RAISE EXCEPTION 'no tally row changed — the recount did nothing'; END IF;

  IF pg_get_functiondef('public.rpc_dispute_ai_upload_answer(uuid)'::regprocedure) NOT LIKE '%_write_chapter_tally%' THEN
    RAISE EXCEPTION 'a dispute does not write the tally again';
  END IF;
END
$proof$;

COMMIT;
