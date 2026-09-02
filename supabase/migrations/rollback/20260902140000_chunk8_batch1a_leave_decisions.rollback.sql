-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — chunk8 batch1a
--
-- Batch 1a is purely additive: it creates leave_decisions and copies 11 rows
-- out of leave_requests.status, which it does not touch. So this rollback is a
-- genuine restore, not an approximation — leave_requests still holds every
-- verdict, and dropping the table loses nothing that is not still there.
--
-- That is only true while batch 1b has NOT run. Once 1b drops
-- leave_requests.status, leave_decisions becomes the only copy of the verdicts
-- and this file would destroy them. The guard below refuses to run in that
-- case rather than leaving the caller to notice.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE
  _status_exists boolean;
  _decisions int;
  _covered int;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='leave_requests' AND column_name='status'
  ) INTO _status_exists;

  IF NOT _status_exists THEN
    RAISE EXCEPTION
      'REFUSING TO ROLL BACK: leave_requests.status is already dropped, so '
      'leave_decisions holds the only copy of every verdict. Roll back batch 1b '
      'first (it restores the column and its values), then run this file.';
  END IF;

  -- The column existing is not enough — it must still CARRY the verdicts. If
  -- 1b's rollback restored the column but not its values, dropping the table
  -- here would still lose them.
  SELECT count(*) INTO _decisions FROM public.leave_decisions;
  SELECT count(*) INTO _covered
    FROM public.leave_decisions d
    JOIN public.leave_requests lr ON lr.id = d.leave_request_id
   WHERE lr.status::text = d.decision;

  IF _covered <> _decisions THEN
    RAISE EXCEPTION
      'REFUSING TO ROLL BACK: % of % decision(s) are not reflected in '
      'leave_requests.status, so dropping leave_decisions would lose them.',
      _decisions - _covered, _decisions;
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.leave_request_decisions(uuid);
DROP TABLE IF EXISTS public.leave_decisions;

COMMIT;
