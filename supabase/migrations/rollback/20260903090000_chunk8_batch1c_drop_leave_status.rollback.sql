-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — chunk8 batch1c
--
-- G16: a rollback that restores a snapshot is not a rollback. This inverts the
-- change. Batch 1c dropped three columns and a type and added one index, so
-- this recreates the type, recreates the three columns, DERIVES their values
-- back out of leave_decisions, and drops the index.
--
-- ── Why the backfill is the whole file ────────────────────────────────────
--
-- Recreating `status NOT NULL DEFAULT 'pending'` and stopping would give every
-- one of the 19 rows the word "pending", including the 11 that carry a verdict.
-- That is a schema restore that silently destroys data while reporting success
-- — the exact shape G16 names. The values have to come back from the only
-- place that still holds them.
--
-- ── Where the inversion is genuinely lossy, and what this does about it ───
--
-- leave_decisions permits two decisions on one request — one per role — and
-- the single `status` column cannot represent that. So this file REFUSES to
-- run if any request carries more than one decision, rather than picking one
-- and discarding the other. There is no correct answer to collapse; the honest
-- move is to stop and say so.
--
-- reviewed_at / reviewed_by come back as NULL wherever the decision row does
-- not name a time or a decider. Eight of the eleven live decisions name
-- neither. That is not loss introduced here — those rows arrived at batch 1a
-- with nothing recorded, and inventing a value on the way back would be worse
-- than the null.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE
  _multi int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='leave_requests' AND column_name='status'
  ) THEN
    RAISE EXCEPTION
      'REFUSING TO ROLL BACK: leave_requests.status already exists, so batch 1c '
      'is not applied. Running this would overwrite live values with a derivation.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_schema='public' AND table_name='leave_decisions') THEN
    RAISE EXCEPTION
      'REFUSING TO ROLL BACK: leave_decisions does not exist, so there is nothing '
      'to derive the verdicts from. Every row would come back as pending.';
  END IF;

  SELECT count(*) INTO _multi FROM (
    SELECT leave_request_id FROM public.leave_decisions GROUP BY 1 HAVING count(*) > 1
  ) x;

  IF _multi <> 0 THEN
    RAISE EXCEPTION
      'REFUSING TO ROLL BACK: % leave_request(s) carry more than one decision, and '
      'a single status column cannot hold two verdicts. Rolling back would discard '
      'one of them silently. Resolve those requests to a single decision first, or '
      'accept that this batch is forward-only for them.', _multi;
  END IF;
END $guard$;

-- ---------- 1. the type ----------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname='leave_status'
                  AND typnamespace='public'::regnamespace) THEN
    CREATE TYPE public.leave_status AS ENUM ('pending', 'approved', 'rejected');
  END IF;
END $$;

-- ---------- 2. the columns, added nullable so the backfill can run ---------
ALTER TABLE public.leave_requests
  ADD COLUMN IF NOT EXISTS status      public.leave_status,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ---------- 3. the values, derived back out of the decision rows -----------
UPDATE public.leave_requests lr
   SET status      = d.decision::public.leave_status,
       reviewed_at = d.decided_at,
       reviewed_by = d.decided_by
  FROM public.leave_decisions d
 WHERE d.leave_request_id = lr.id;

-- Everything with no decision row is pending, which is what the column meant.
UPDATE public.leave_requests SET status = 'pending' WHERE status IS NULL;

ALTER TABLE public.leave_requests
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN status SET DEFAULT 'pending'::public.leave_status;

-- ---------- 4. the index 1c added ------------------------------------------
DROP INDEX IF EXISTS public.leave_decisions_one_roleless_per_request;

-- ---------- 5. prove the inversion, do not assume it ------------------------
DO $$
DECLARE
  _rows      int;
  _disagree  int;
  _lostwhen  int;
BEGIN
  SELECT count(*) INTO _rows FROM public.leave_requests WHERE status IS NULL;
  IF _rows <> 0 THEN
    RAISE EXCEPTION 'ABORT: % row(s) still have a null status after the backfill', _rows;
  END IF;

  -- The restored column must agree with the table it was derived from — the
  -- same assertion batch 1c ran immediately before dropping it.
  SELECT count(*) INTO _disagree
    FROM public.leave_requests lr
   WHERE (lr.status <> 'pending')
      <> EXISTS (SELECT 1 FROM public.leave_decisions d WHERE d.leave_request_id = lr.id);
  IF _disagree <> 0 THEN
    RAISE EXCEPTION 'ABORT: % row(s) disagree between the restored column and the decisions', _disagree;
  END IF;

  -- Every decision that named a time must have handed it back.
  SELECT count(*) INTO _lostwhen
    FROM public.leave_decisions d
    JOIN public.leave_requests lr ON lr.id = d.leave_request_id
   WHERE d.decided_at IS NOT NULL AND lr.reviewed_at IS DISTINCT FROM d.decided_at;
  IF _lostwhen <> 0 THEN
    RAISE EXCEPTION 'ABORT: % decision timestamp(s) did not survive the inversion', _lostwhen;
  END IF;
END $$;

COMMIT;
