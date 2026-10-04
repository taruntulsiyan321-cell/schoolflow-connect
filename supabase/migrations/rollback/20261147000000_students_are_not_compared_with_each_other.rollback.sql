-- Rolls back 20261147000000_students_are_not_compared_with_each_other.sql:
-- puts rpc_student_peer_comparison back exactly as 20261146000000 created it.
-- Only on a new ruling against §6.7 — see that migration's header.
BEGIN;

CREATE FUNCTION public.rpc_student_peer_comparison()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _uid  uuid := auth.uid();
  -- The privacy floor: a question is compared only when at least this many
  -- OTHER students preparing for the same exam have answered it.
  _min_students constant int := 5;
  _exam uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '42501';
  END IF;
  SELECT ea.exam_id INTO _exam
    FROM public.exam_accounts ea
   WHERE ea.account_id = _uid
   ORDER BY ea.created_at
   LIMIT 1;

  RETURN jsonb_build_object(
    'exam_found',   _exam IS NOT NULL,
    'min_students', _min_students,
    'subjects', COALESCE((
      WITH mine AS (
        SELECT DISTINCT ON (qa.bank_question_id) qa.bank_question_id, COALESCE(qa.is_correct, false) AS right_first
          FROM public.question_attempts qa
         WHERE qa.user_id = _uid
           AND qa.bank_question_id IS NOT NULL
           AND NOT COALESCE(qa.skipped, false)
           AND NOT COALESCE(qa.timed_out, false)
           AND NOT COALESCE(qa.excluded_from_accuracy, false)
         ORDER BY qa.bank_question_id, qa.created_at, qa.id
      ), theirs AS (
        SELECT DISTINCT ON (qa.user_id, qa.bank_question_id)
               qa.user_id, qa.bank_question_id, COALESCE(qa.is_correct, false) AS right_first
          FROM public.question_attempts qa
          JOIN public.exam_accounts ea ON ea.account_id = qa.user_id AND ea.exam_id = _exam
          JOIN mine m ON m.bank_question_id = qa.bank_question_id
         WHERE qa.user_id <> _uid
           AND NOT COALESCE(qa.skipped, false)
           AND NOT COALESCE(qa.timed_out, false)
           AND NOT COALESCE(qa.excluded_from_accuracy, false)
         ORDER BY qa.user_id, qa.bank_question_id, qa.created_at, qa.id
      ), shared AS (
        SELECT t.bank_question_id,
               count(*)::int                                AS students,
               count(*) FILTER (WHERE t.right_first)::int   AS right_first
          FROM theirs t
         GROUP BY t.bank_question_id
        HAVING count(*) >= _min_students
      )
      SELECT jsonb_agg(jsonb_build_object(
               'subject', x.subject, 'questions', x.questions, 'mine_right', x.mine_right,
               'peer_answers', x.peer_answers, 'peer_right', x.peer_right) ORDER BY x.subject)
        FROM (
          SELECT cs.name                                   AS subject,
                 count(*)::int                             AS questions,
                 count(*) FILTER (WHERE m.right_first)::int AS mine_right,
                 sum(s.students)::int                      AS peer_answers,
                 sum(s.right_first)::int                   AS peer_right
            FROM shared s
            JOIN mine m ON m.bank_question_id = s.bank_question_id
            JOIN public.question_bank qb ON qb.id = s.bank_question_id
            JOIN public.chapters c ON c.id = qb.chapter_id
            JOIN public.curriculum_subjects cs ON cs.id = c.curriculum_subject_id
           GROUP BY cs.name
        ) x), '[]'::jsonb));
END $fn$;

REVOKE ALL ON FUNCTION public.rpc_student_peer_comparison() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_student_peer_comparison() TO authenticated;

COMMIT;
