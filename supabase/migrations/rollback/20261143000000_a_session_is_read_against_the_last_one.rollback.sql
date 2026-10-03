-- Rollback for 20261143000000: no session analysis context. The result screen
-- then shows the session on its own, with no comparison or exam marks.
BEGIN;

DROP FUNCTION public.rpc_session_analysis_context(uuid);

COMMIT;
