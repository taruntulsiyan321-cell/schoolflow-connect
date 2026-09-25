-- ROLLBACK 20261059000000 — removes the trend window row and restores the
-- previous (misleading) wording of REPEATED_MISTAKE_PIN.
DELETE FROM public.recovery_constants WHERE key = 'TREND_WINDOW_SESSIONS';
UPDATE public.recovery_constants SET rationale = 'times_wrong that pins a chapter to the top of analysis.', updated_at = now()
 WHERE key = 'REPEATED_MISTAKE_PIN';
DELETE FROM public.schema_migrations WHERE version = '20261059000000_a_trend_is_the_last_three_against_the_three_before';
