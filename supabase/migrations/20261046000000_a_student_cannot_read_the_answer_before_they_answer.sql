-- A STUDENT CANNOT READ THE ANSWER BEFORE THEY ANSWER IT.
--
-- MEASURED 2026-09-22, as the signed-in student arjun.mehta against
-- production PostgREST:
--
--   GET /rest/v1/question_bank?select=id,question,correct_index,explanation
--     -> 200, every approved question in the bank, answer included
--   GET /rest/v1/question_bank?select=id,correct_index&correct_index=eq.2
--     -> 200, so the answers are not merely readable, they are ENUMERABLE
--        by filtering on the answer column
--
-- Every revision check and every recovery session is therefore cheatable,
-- and so is ordinary practice.
--
-- WHY RLS DID NOT STOP IT. Row-level security is row-level. The policy
-- qb_select_approved_board grants a student rows -- correctly, they must see
-- the questions -- and a policy cannot withhold a COLUMN of a row it grants.
-- Column privileges could, but students and teachers are both the
-- `authenticated` role, so revoking the column would take it from teachers
-- too. The thing that is wrong is not the policy: it is that a student reads
-- the base table at all.
--
-- WHAT THE CLIENT ACTUALLY NEEDS. Nothing, until it has answered.
-- _practice_grade_from_bank already grades server-side, straight off
-- question_bank.correct_index, and accepts the client's claimed answer in
-- _client_correct_answer WITHOUT EVER READING IT. rpc_record_question_attempt
-- then overwrites the client's is_correct with the server's verdict for any
-- bank question. So the browser holds the answer for exactly one purpose:
-- drawing the tick or the cross after the student has committed.
--
-- THIS MIGRATION IS ADDITIVE AND CHANGES NOTHING ON ITS OWN. It builds the
-- two things the client needs before the base-table policy can be withdrawn:
--
--   question_bank_student   every column EXCEPT correct_index, explanation
--                           and answer, carrying the same row filter the
--                           policy applies
--   rpc_question_review     the answer, for questions this student has an
--                           attempt row for -- and no others
--
-- The policy is dropped in a later migration, once the client reads the view.
-- Splitting it that way means neither half can take practice down on its own.

-- ── The rows a student may see, without the answer ────────────────────────
--
-- SECURITY INVOKER IS DELIBERATELY OFF. The view runs as its owner, so RLS on
-- question_bank is not consulted and the row filter has to live here. That is
-- the whole point: once qb_select_approved_board is gone, this view still
-- works and the base table is staff-only. The filter below is a transcription
-- of that policy's USING expression, and the verification file asserts the
-- two select the same rows.
CREATE OR REPLACE VIEW public.question_bank_student AS
SELECT
  q.id, q.class_level, q.subject, q.chapter, q.difficulty, q.question,
  q.options, q.source, q.is_approved, q.created_at, q.board, q.source_type,
  q.exam_year, q.stream, q.question_format, q.updated_at, q.is_active,
  q.chapter_id, q.variant_tier, q.topic_id
FROM public.question_bank q
WHERE q.is_approved
  AND (
    q.board IS NULL
    OR q.board = 'both'
    OR q.board = (SELECT s.board FROM public.schools s WHERE s.id = (SELECT public.get_my_school_id()))
  );

COMMENT ON VIEW public.question_bank_student IS
  'Questions as a student may see them: no correct_index, no explanation, no answer. '
  'The answer arrives through rpc_question_review, and only for a question the student has attempted.';

REVOKE ALL ON public.question_bank_student FROM anon;
GRANT SELECT ON public.question_bank_student TO authenticated;

-- ── The answer, after the fact ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_question_review(_ids uuid[])
 RETURNS TABLE(id uuid, correct_index integer, correct_text text, explanation text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _staff boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- Staff author and review questions; the gate below is about students.
  _staff := (SELECT public.is_principal_or_admin(_uid))
         OR (SELECT public.has_role(_uid, 'teacher'::app_role));

  RETURN QUERY
  SELECT q.id,
         q.correct_index,
         COALESCE(q.options ->> q.correct_index, '')::text,
         COALESCE(q.explanation, '')::text
  FROM public.question_bank q
  WHERE q.id = ANY(_ids)
    AND (
      _staff
      -- THE GATE. An attempt row is the proof that the student committed to
      -- an answer. Without it this function is the hole it was written to
      -- close, reached by a different name.
      OR EXISTS (
        SELECT 1 FROM public.question_attempts qa
        WHERE qa.user_id = _uid AND qa.bank_question_id = q.id
      )
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_question_review(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_question_review(uuid[]) TO authenticated;

-- Fail closed: the view must not carry an answer column, whatever a later
-- edit to the column list does.
DO $guard$
DECLARE _bad text;
BEGIN
  SELECT string_agg(column_name, ', ') INTO _bad
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'question_bank_student'
    AND column_name IN ('correct_index', 'explanation', 'answer');
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'question_bank_student exposes %, which is the whole thing it exists to withhold', _bad;
  END IF;
END
$guard$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261046000000_a_student_cannot_read_the_answer_before_they_answer')
ON CONFLICT (version) DO NOTHING;
