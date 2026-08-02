-- =============================================================================
-- APPLY_SAVED_PRACTICE_SESSIONS.sql
-- Columns + idempotent save RPC only.
--
-- CRITICAL: Do NOT replace rpc_finish_practice_session here.
-- Finish + XP + Progression Engine live in APPLY_ACADEMIC_PROGRESSION_ENGINE.sql
-- (migration 20260802310000). Replacing finish with correct×10 strips progression.
-- =============================================================================

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
  'XP credited on finish via Progression Engine (rpc_finish_practice_session). Never invent in UI.';

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
