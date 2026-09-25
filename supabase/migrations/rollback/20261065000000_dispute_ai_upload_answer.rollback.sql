-- Rollback: 20261065000000_dispute_ai_upload_answer
--
-- Restores accuracy readers to the post-20261023000000 form (skipped filter
-- only). Does not un-clear mistakes or clear excluded_from_accuracy flags
-- already set — those rows stay excluded-looking until a forward re-apply.

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_dispute_ai_upload_answer(uuid);

-- Strip excluded_from_accuracy filters from the three accuracy readers.
DO $exam$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = '_exam_readiness';
  IF _def IS NULL THEN RETURN; END IF;
  IF position('excluded_from_accuracy' IN _def) = 0 THEN RETURN; END IF;

  _new := replace(_def,
    'SELECT round(100.0 * count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false) AND NOT COALESCE(excluded_from_accuracy, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(skipped, false) AND NOT COALESCE(excluded_from_accuracy, false)), 0), 1)
    INTO _practice_acc FROM public.question_attempts WHERE user_id = _uid;',
    'SELECT round(100.0 * count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(skipped, false)), 0), 1)
    INTO _practice_acc FROM public.question_attempts WHERE user_id = _uid;');
  IF _new = _def THEN
    RAISE EXCEPTION 'rollback _exam_readiness: excluded filter anchor missing';
  END IF;
  EXECUTE _new;
END $exam$;

DO $profile$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'refresh_student_academic_profile';
  IF _def IS NULL THEN RETURN; END IF;
  IF position('excluded_from_accuracy' IN _def) = 0 THEN RETURN; END IF;

  _new := replace(_def,
    'SELECT coalesce(round(
           100.0 * count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false) AND NOT COALESCE(excluded_from_accuracy, false))
                 / NULLIF(count(*) FILTER (WHERE NOT COALESCE(skipped, false) AND NOT COALESCE(excluded_from_accuracy, false)), 0), 2), 0)
  INTO _practice_avg
  FROM public.question_attempts
  WHERE _user IS NOT NULL AND user_id = _user;',
    'SELECT coalesce(round(
           100.0 * count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false))
                 / NULLIF(count(*) FILTER (WHERE NOT COALESCE(skipped, false)), 0), 2), 0)
  INTO _practice_avg
  FROM public.question_attempts
  WHERE _user IS NOT NULL AND user_id = _user;');
  IF _new = _def THEN
    RAISE EXCEPTION 'rollback refresh_student_academic_profile: excluded filter anchor missing';
  END IF;
  EXECUTE _new;
END $profile$;

DO $analytics$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_student_practice_analytics';
  IF _def IS NULL THEN RETURN; END IF;
  IF position('excluded_from_accuracy' IN _def) = 0 THEN RETURN; END IF;

  _new := regexp_replace(
    _def,
    E'\\s+AND NOT COALESCE\\(qa\\.excluded_from_accuracy, false\\)',
    '',
    'g'
  );
  IF _new = _def THEN
    RAISE EXCEPTION 'rollback rpc_student_practice_analytics: excluded filter not stripped';
  END IF;
  EXECUTE _new;
END $analytics$;

DROP INDEX IF EXISTS public.question_attempts_excluded_from_accuracy_idx;
ALTER TABLE public.question_attempts
  DROP COLUMN IF EXISTS excluded_from_accuracy;

COMMIT;
