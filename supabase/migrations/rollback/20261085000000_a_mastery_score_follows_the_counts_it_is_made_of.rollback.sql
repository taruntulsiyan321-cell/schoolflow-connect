-- ROLLBACK 20261085000000 — the confidence rebuild leaves mastery_score
-- behind again. The scores it recomputed (446 rows) are not restored: their
-- previous values were not kept, and they disagreed with their own counts.
DO $mig$
DECLARE _def text; _n int;
  _new CONSTANT text := $x$    last_attempt_at  = now(),
    updated_at       = now(),
    -- The counts just changed, so the score made of them changes with them:
    -- the same formula _upsert_concept_mastery applies (20261085000000).
    mastery_score    = public._compute_mastery_score(
      EXCLUDED.total_attempts, EXCLUDED.correct_attempts,
      cm.recovery_attempts, cm.recovery_correct, cm.mistake_count, now());$x$;
BEGIN
  SELECT replace(pg_get_functiondef('public._recompute_concept_confidence_for_session(uuid)'::regprocedure), E'\r\n', E'\n') INTO _def;
  _n := (length(_def) - length(replace(_def, _new, ''))) / length(_new);
  IF _n <> 1 THEN RAISE EXCEPTION 'does not carry 20261085000000 (% matches)', _n; END IF;
  EXECUTE replace(_def, _new, $x$    last_attempt_at  = now(),
    updated_at       = now();
    -- mastery_score deliberately untouched: still owned by _upsert_concept_mastery.$x$);
END
$mig$;
DELETE FROM public.schema_migrations WHERE version = '20261085000000_a_mastery_score_follows_the_counts_it_is_made_of';
