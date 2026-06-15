-- Minimal fix: nullable template_id + single-arg finish RPC (always works with PostgREST)

ALTER TABLE public.question_attempts
  DROP CONSTRAINT IF EXISTS question_attempts_template_id_fkey;

ALTER TABLE public.question_attempts
  ALTER COLUMN template_id DROP NOT NULL;

ALTER TABLE public.question_attempts
  ADD CONSTRAINT question_attempts_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES public.question_templates(id) ON DELETE SET NULL;

DROP FUNCTION IF EXISTS public.rpc_finish_practice_session(jsonb, uuid);
DROP FUNCTION IF EXISTS public.rpc_finish_practice_session(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.rpc_finish_practice_session(_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s record; _mins int;
BEGIN
  UPDATE public.practice_sessions SET finished_at = now()
    WHERE id = _session_id AND user_id = auth.uid()
    RETURNING * INTO _s;
  IF _s IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;

  _mins := GREATEST(
    COALESCE(extract(epoch FROM (_s.finished_at - _s.created_at))::int / 60, 1),
    1
  );
  PERFORM public._bump_academic_activity(_s.user_id, 0, 0, 0, _mins, 1);

  RETURN jsonb_build_object(
    'session_id', _s.id,
    'chapter', _s.chapter,
    'subject', _s.subject,
    'question_count', _s.question_count,
    'correct_count', _s.correct_count,
    'score', _s.score
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_finish_practice_session(uuid) TO authenticated;
