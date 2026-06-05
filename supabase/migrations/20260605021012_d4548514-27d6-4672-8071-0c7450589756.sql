CREATE OR REPLACE FUNCTION public.rpc_battle_monitor(_battle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _b record; _uid uuid := auth.uid(); _result jsonb; _allowed boolean;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Battle not found'; END IF;

  _allowed := _b.creator_user_id = _uid
    OR public.has_role(_uid, 'admin'::app_role)
    OR public.has_role(_uid, 'principal'::app_role)
    OR (_b.class_id IS NOT NULL AND public.teacher_teaches_class(_uid, _b.class_id));
  IF NOT _allowed THEN RAISE EXCEPTION 'Not authorized to monitor this battle'; END IF;

  SELECT jsonb_build_object(
    'battle', jsonb_build_object(
      'id', _b.id, 'title', _b.title, 'subject', _b.subject, 'topic', _b.topic,
      'status', _b.status, 'question_count', _b.question_count,
      'per_question_sec', _b.per_question_sec, 'duration_sec', _b.duration_sec,
      'starts_at', _b.starts_at
    ),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', p.user_id,
        'display_name', p.display_name,
        'score', p.score,
        'correct_count', p.correct_count,
        'answered_count', p.answered_count,
        'total_time_ms', p.total_time_ms,
        'rank', p.rank,
        'finished', (p.finished_at IS NOT NULL),
        'joined_at', p.joined_at,
        'progress_pct', CASE WHEN _b.question_count > 0
                             THEN round(100.0 * p.answered_count / _b.question_count) ELSE 0 END,
        'accuracy', CASE WHEN p.answered_count > 0
                         THEN round(100.0 * p.correct_count / p.answered_count) ELSE NULL END,
        'avg_ms', CASE WHEN p.answered_count > 0
                       THEN round(p.total_time_ms::numeric / p.answered_count) ELSE NULL END,
        'struggling', (p.answered_count >= 2 AND p.correct_count::numeric / p.answered_count < 0.4)
      ) ORDER BY p.score DESC, p.total_time_ms ASC)
      FROM public.battle_participants p WHERE p.battle_id = _battle_id
    ), '[]'::jsonb),
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'order_index', q.order_index,
        'question', q.question,
        'attempts', COALESCE(s.attempts, 0),
        'correct', COALESCE(s.correct, 0),
        'accuracy', CASE WHEN COALESCE(s.attempts, 0) > 0
                         THEN round(100.0 * s.correct / s.attempts) ELSE NULL END
      ) ORDER BY q.order_index)
      FROM public.battle_questions q
      LEFT JOIN (
        SELECT ba.question_id,
               count(*) AS attempts,
               count(*) FILTER (WHERE ba.is_correct) AS correct
        FROM public.battle_answers ba
        JOIN public.battle_questions bq2 ON bq2.id = ba.question_id
        WHERE bq2.battle_id = _battle_id
        GROUP BY ba.question_id
      ) s ON s.question_id = q.id
      WHERE q.battle_id = _battle_id
    ), '[]'::jsonb)
  ) INTO _result;

  RETURN _result;
END $$;