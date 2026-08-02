-- Saved practice sessions + analysis snapshot (student panel)
-- Students can pin a finished session for reopen; RLS remains select-only — writes via RPC.

ALTER TABLE public.practice_sessions
  ADD COLUMN IF NOT EXISTS saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS analysis_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS xp_earned int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS difficulty text;

CREATE INDEX IF NOT EXISTS practice_sessions_user_saved_at
  ON public.practice_sessions (user_id, saved_at DESC)
  WHERE saved_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS practice_sessions_user_finished_at
  ON public.practice_sessions (user_id, finished_at DESC)
  WHERE finished_at IS NOT NULL;

COMMENT ON COLUMN public.practice_sessions.saved_at IS
  'When the student saved this finished session for Saved Sessions; null = not saved.';
COMMENT ON COLUMN public.practice_sessions.analysis_snapshot IS
  'Frozen analysis payload so reopen shows the same Performance / Review / Insights without regenerating.';
COMMENT ON COLUMN public.practice_sessions.xp_earned IS
  'XP credited for this session (set on finish); display only — student_xp rollup stays via activity bump.';

-- Persist XP on finish (correct × 10). Keep existing aggregates + activity bump.
CREATE OR REPLACE FUNCTION public.rpc_finish_practice_session(
  _session_id uuid,
  _attempts jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s record;
  _mins int;
  _att jsonb;
  _bank_id uuid;
  _total int;
  _correct int;
  _skipped int;
  _wrong int;
  _time_ms int;
  _xp int;
BEGIN
  SELECT * INTO _s
  FROM public.practice_sessions
  WHERE id = _session_id AND user_id = auth.uid();

  IF _s IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;

  IF _attempts IS NOT NULL
     AND jsonb_typeof(_attempts) = 'array'
     AND jsonb_array_length(_attempts) > 0 THEN
    FOR _att IN SELECT value FROM jsonb_array_elements(_attempts) AS value
    LOOP
      _bank_id := COALESCE(
        NULLIF(_att->>'bank_question_id', '')::uuid,
        NULLIF(_att->'generated_question'->>'bank_question_id', '')::uuid
      );
      PERFORM public.rpc_record_question_attempt(
        COALESCE(_att->'correct_answer', '{}'::jsonb),
        COALESCE(_att->'generated_question', '{}'::jsonb),
        COALESCE((_att->>'is_correct')::boolean, false),
        COALESCE(_att->'selected_answer', '{}'::jsonb),
        _session_id,
        COALESCE((_att->>'score')::numeric, 0),
        COALESCE((_att->>'skipped')::boolean, false),
        NULLIF(_att->>'template_id', '')::uuid,
        NULLIF(_att->>'time_taken_ms', '')::int,
        _bank_id,
        COALESCE((_att->>'hint_used')::boolean, false),
        COALESCE(NULLIF(_att->>'source', ''), 'practice'),
        COALESCE(_att->'meta', '{}'::jsonb)
          || jsonb_build_object(
            'solution_viewed', COALESCE((_att->>'solution_viewed')::boolean, false),
            'confidence', _att->'confidence',
            'attempt_number', _att->'attempt_number',
            'timed_out', COALESCE((_att->>'timed_out')::boolean, false),
            'practice_mode', COALESCE(_att->>'practice_mode', _s.practice_mode),
            'source_id', COALESCE(_att->>'source_id', _session_id::text),
            'class_level', COALESCE(_att->>'class_level', _s.class_level::text),
            'board', COALESCE(_att->>'board', _s.board),
            'stream', COALESCE(_att->>'stream', _s.stream),
            'topic', _att->>'topic',
            'difficulty', _att->>'difficulty',
            'school_id', COALESCE(_att->>'school_id', _s.school_id::text),
            'answered_at', _att->>'answered_at'
          )
      );
    END LOOP;
  END IF;

  SELECT
    count(*)::int,
    count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false))::int,
    count(*) FILTER (WHERE COALESCE(skipped, false))::int,
    count(*) FILTER (WHERE NOT is_correct AND NOT COALESCE(skipped, false))::int,
    COALESCE(sum(time_taken_ms), 0)::int
  INTO _total, _correct, _skipped, _wrong, _time_ms
  FROM public.question_attempts
  WHERE session_id = _session_id AND user_id = auth.uid();

  _xp := GREATEST(_correct, 0) * 10;

  UPDATE public.practice_sessions ps
  SET
    correct_count = _correct,
    score = _correct,
    skipped_count = _skipped,
    wrong_count = _wrong,
    total_time_ms = NULLIF(_time_ms, 0),
    accuracy = CASE WHEN _total > 0 THEN round((_correct::numeric / _total) * 100, 2) ELSE 0 END,
    question_count = CASE WHEN _total > 0 THEN _total ELSE ps.question_count END,
    xp_earned = CASE WHEN ps.finished_at IS NULL THEN _xp ELSE COALESCE(ps.xp_earned, _xp) END,
    finished_at = COALESCE(ps.finished_at, now())
  WHERE ps.id = _session_id AND ps.user_id = auth.uid()
  RETURNING ps.* INTO _s;

  _mins := GREATEST(
    COALESCE(extract(epoch FROM (_s.finished_at - _s.created_at))::int / 60, 1),
    1
  );
  PERFORM public._bump_academic_activity(_s.user_id, 0, 0, 0, _mins, 1);

  BEGIN
    PERFORM public.rpc_refresh_academic_brain();
  EXCEPTION WHEN others THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'session_id', _s.id,
    'chapter', _s.chapter,
    'subject', _s.subject,
    'question_count', _s.question_count,
    'correct_count', _s.correct_count,
    'skipped_count', _s.skipped_count,
    'wrong_count', _s.wrong_count,
    'total_time_ms', _s.total_time_ms,
    'accuracy', _s.accuracy,
    'score', _s.score,
    'xp_earned', _s.xp_earned,
    'practice_mode', _s.practice_mode,
    'server_graded', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_finish_practice_session(uuid, jsonb) TO authenticated;

-- Idempotent save: first save wins; duplicate returns already_saved without rewriting snapshot.
CREATE OR REPLACE FUNCTION public.rpc_save_practice_session(
  _session_id uuid,
  _snapshot jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _s
  FROM public.practice_sessions
  WHERE id = _session_id AND user_id = auth.uid();

  IF _s IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  IF _s.finished_at IS NULL THEN RAISE EXCEPTION 'Session is not finished'; END IF;

  IF _s.saved_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'session_id', _s.id,
      'saved', true,
      'already_saved', true,
      'saved_at', _s.saved_at
    );
  END IF;

  UPDATE public.practice_sessions
  SET
    saved_at = now(),
    analysis_snapshot = COALESCE(_snapshot, analysis_snapshot)
  WHERE id = _session_id AND user_id = auth.uid()
  RETURNING * INTO _s;

  RETURN jsonb_build_object(
    'session_id', _s.id,
    'saved', true,
    'already_saved', false,
    'saved_at', _s.saved_at
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_save_practice_session(uuid, jsonb) TO authenticated;
