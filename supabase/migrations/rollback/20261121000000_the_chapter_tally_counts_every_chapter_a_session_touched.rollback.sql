-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: the four tally rows 20261121000000 wrote
--
-- It added rows and changed none (its own proof asserts that), so undoing it is
-- deleting exactly those four: the chapter of a finished session whose only
-- tally row was written on 2026-09-29, for the four sessions named in the
-- migration. Anything written since by rpc_finish_practice_session is left
-- alone, because a row whose session finished after this date is not one of
-- them.
--
-- Undoes: 20261121000000_the_chapter_tally_counts_every_chapter_a_session_touched.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $undo$
DECLARE _n int;
BEGIN
  WITH gone AS (
    DELETE FROM public.chapter_tally ct
     WHERE ct.session_id IN (
       SELECT ps.id FROM public.practice_sessions ps
        WHERE ps.id::text LIKE '277b35cd%' OR ps.id::text LIKE 'e1c43a3a%'
           OR ps.id::text LIKE '411a0111%' OR ps.id::text LIKE 'eefc9e7f%')
       AND ct.created_at::date = DATE '2026-09-29'
    RETURNING 1)
  SELECT count(*) INTO _n FROM gone;
  RAISE NOTICE '% tally row(s) removed', _n;
  IF _n > 4 THEN
    RAISE EXCEPTION 'removed % rows, expected at most 4 — refusing to leave that', _n;
  END IF;
END
$undo$;

DELETE FROM public.schema_migrations
 WHERE version = '20261121000000_the_chapter_tally_counts_every_chapter_a_session_touched';

COMMIT;
