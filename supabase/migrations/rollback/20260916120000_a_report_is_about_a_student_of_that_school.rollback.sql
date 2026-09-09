-- Rollback for 20260916120000.
--
-- Restores the 20260916030000 bodies, WHICH CARRY THE CROSS-SCHOOL NAME
-- DISCLOSURE that migration's header measures: a teacher of any section with a
-- test can turn a student uuid from another school into that child's name.
--
-- Only run this if the school predicate is refusing a legitimate report. The
-- hole is real and was reproduced against live rows, so prefer fixing forward.
CREATE OR REPLACE FUNCTION public.can_read_test_student_report(_test_id uuid, _student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.can_read_test_report(_test_id)
      OR (
           public._test_was_sat_by(_test_id, _student_id)
           AND (
             EXISTS (SELECT 1 FROM public.students s
                      WHERE s.id = _student_id
                        AND s.user_id = (SELECT auth.uid()))
             OR _student_id = ANY (public.my_children_student_ids())
           )
         )
$function$;

CREATE OR REPLACE FUNCTION public.rpc_test_student_report(_test_id uuid, _student_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _out jsonb;
BEGIN
  IF NOT public.can_read_test_student_report(_test_id, _student_id) THEN
    RAISE EXCEPTION 'Not your test report' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'test_id', _test_id,
    'student_id', _student_id,
    'full_name', s.full_name,
    'mark', a.score,
    'max_mark', t.max_mark,
    'correct_count', a.correct_count,
    'total_count', a.total_count,
    'submitted_at', a.submitted_at,
    'submitted', (a.id IS NOT NULL),
    'rank', CASE WHEN a.id IS NULL THEN NULL ELSE (
       SELECT count(*) + 1 FROM public.test_attempts a2
        WHERE a2.test_id = _test_id AND a2.status = 'submitted'
          AND a2.score > a.score) END,
    'class_size', CASE WHEN a.id IS NULL THEN NULL ELSE (
       SELECT count(*) FROM public.test_attempts a2
        WHERE a2.test_id = _test_id AND a2.status = 'submitted') END,
    'wrong_answers', CASE WHEN a.id IS NULL THEN '[]'::jsonb ELSE COALESCE((
       SELECT jsonb_agg(jsonb_build_object(
                'question_id', q.id,
                'order_index', q.order_index,
                'question', q.question,
                'topic', COALESCE(NULLIF(btrim(q.concept), ''), NULLIF(btrim(q.chapter), ''), 'Unlabelled'),
                'marks', q.marks,
                'question_format', q.question_format,
                'options', q.options,
                'their_answer', ans.response,
                'correct_answer', q.correct,
                'explanation', q.explanation,
                'answered', (ans.id IS NOT NULL)
              ) ORDER BY q.order_index)
         FROM public.test_questions q
         LEFT JOIN public.test_answers ans
                ON ans.question_id = q.id AND ans.attempt_id = a.id
        WHERE q.test_id = _test_id
          AND COALESCE(ans.is_correct, false) = false), '[]'::jsonb) END
  )
    INTO _out
    FROM public.students s
    JOIN public.tests t ON t.id = _test_id
    LEFT JOIN public.test_attempts a
           ON a.test_id = _test_id
          AND (a.student_id = s.id OR a.user_id = s.user_id)
          AND a.status = 'submitted'
   WHERE s.id = _student_id;

  RETURN _out;
END;
$function$;
