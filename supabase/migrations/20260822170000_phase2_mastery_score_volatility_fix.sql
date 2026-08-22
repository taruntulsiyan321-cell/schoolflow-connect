-- Phase 2 audit, 2026-08-22: _compute_mastery_score is declared IMMUTABLE but
-- reads now() internally (its recency-decay term), which violates the
-- immutability contract -- an IMMUTABLE function promises the planner the
-- same output for the same input forever, and this one's output changes
-- with wall-clock time. No live index or generated column currently depends
-- on it (checked: pg_indexes / information_schema.columns.generation_expression
-- both come back empty), so there is no active data-corruption today, but the
-- mislabel is a live trap for the next person who adds one -- Postgres would
-- silently cache/reuse a stale recency score instead of erroring. Corrected
-- to STABLE, its true volatility class (same result within one statement,
-- may differ across statements) -- no behavior change, this only corrects
-- the planner contract.
CREATE OR REPLACE FUNCTION public._compute_mastery_score(_attempts integer, _correct integer, _recovery_attempts integer, _recovery_correct integer, _mistakes integer, _last_at timestamp with time zone)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  _acc numeric := CASE WHEN _attempts > 0 THEN 100.0 * _correct / _attempts ELSE 50 END;
  _rec numeric := CASE WHEN _recovery_attempts > 0 THEN 100.0 * _recovery_correct / _recovery_attempts ELSE _acc END;
  _cons numeric := CASE WHEN _attempts >= 8 THEN LEAST(100, _acc + 5) WHEN _attempts >= 4 THEN _acc ELSE _acc * 0.9 END;
  _recency numeric := CASE
    WHEN _last_at IS NULL THEN 40
    WHEN _last_at >= now() - interval '3 days' THEN 100
    WHEN _last_at >= now() - interval '14 days' THEN 75
    WHEN _last_at >= now() - interval '30 days' THEN 50
    ELSE 30
  END;
  _penalty numeric := LEAST(25, _mistakes * 3);
BEGIN
  RETURN LEAST(100, GREATEST(0, round(
    0.45 * _acc + 0.25 * _rec + 0.15 * _cons + 0.15 * _recency - _penalty, 1
  )));
END; $function$;
