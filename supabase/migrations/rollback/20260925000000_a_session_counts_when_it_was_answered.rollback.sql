-- Rollback for 20260925000000.
--
-- Restores the unfiltered count, so self_practice.sessions_completed goes back
-- to counting sessions the student never answered a question in. Measured on
-- 2026-09-13 that meant reporting 16 for a student who had sat two.

BEGIN;

DO $undo$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_student_academic_snapshot';
  IF _def IS NULL THEN RAISE EXCEPTION 'rpc_student_academic_snapshot not found'; END IF;

  _new := replace(_def,
    'FROM public.schoolflow_placeholder', 'FROM public.schoolflow_placeholder');
  _new := regexp_replace(_def,
    E'FROM public\\.practice_sessions WHERE user_id = _uid AND finished_at IS NOT NULL\\s*\\n\\s*AND \\(COALESCE\\(correct_count, 0\\) \\+ COALESCE\\(wrong_count, 0\\) \\+ COALESCE\\(skipped_count, 0\\)\\) > 0;',
    'FROM public.practice_sessions WHERE user_id = _uid AND finished_at IS NOT NULL;');

  IF _new = _def THEN
    RAISE NOTICE 'the attempted-only filter was not found; nothing undone';
  ELSE
    EXECUTE _new;
    RAISE WARNING 'sessions_completed counts unanswered sessions again.';
  END IF;
END
$undo$;

COMMIT;
