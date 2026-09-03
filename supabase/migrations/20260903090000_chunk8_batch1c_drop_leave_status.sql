-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 8 BATCH 1c — leave_requests.status goes, and with it the dual write
--
-- Batch 1a created leave_decisions and backfilled the 19 rows. Batch 1b
-- repointed every reader onto it, so pending became the absence of a decision
-- rather than a word in a column. This drops the column, and the two columns
-- that were being written alongside it.
--
-- ── Three columns, not one ────────────────────────────────────────────────
--
--   status        the combined verdict the spec forbids computing
--   reviewed_at   the same fact as leave_decisions.decided_at
--   reviewed_by   the same fact as leave_decisions.decided_by
--
-- All three were written by the same UPDATE in LeaveService.review, and none
-- of the three is read anywhere: the repo census found no policy, function,
-- trigger, view or client read of any of them. Dropping status alone would
-- have left the other two written by nothing and read by nothing — a second
-- home that only looks harmless. They go together or the dual write is not
-- actually gone.
--
-- ── What replaces the guard that is being deleted ─────────────────────────
--
-- LeaveService.review used `.eq("status", "pending")` on that UPDATE, and its
-- own comment recorded that this predicate was what made the call idempotent:
-- a second decide() matched no row, so the decision insert could not run
-- twice. Deleting the UPDATE deletes that protection, and this is the one
-- place batch 1c could silently regress correctness.
--
-- leave_decisions already carries UNIQUE (leave_request_id, decided_by_role),
-- which rejects a duplicate from the same role. It does NOT cover a role-less
-- decision: NULLs are distinct in a unique index, so a decider whose capacity
-- was not recorded could insert without limit. The partial index below closes
-- that, and moves the guarantee from a predicate the client has to remember
-- to write into the database, where it holds regardless of caller.
--
-- Deliberately NOT re-created: any constraint stopping a SECOND decider. A
-- student's leave goes to both the class teacher and the principal and either
-- may act. The old predicate made the second decision impossible to record —
-- which is exactly why no live request carries two.
--
-- ── Measured immediately before writing this ──────────────────────────────
--
--   19  leave_requests          8 with no decision row, 11 with one
--   11  leave_decisions         6 approved, 5 rejected; 0 requests carry two
--    8  decided_by_role IS NULL all on distinct requests, so the partial
--                                unique index below can be created as-is
--    1  user of the leave_status enum — leave_requests.status, and nothing
--       else, so the type is orphaned by this drop and goes with it
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ---------- 1. the last moment the two homes can be compared ---------------
-- After the DROP this question cannot be asked again, so ask it now and abort
-- if the answer is wrong. A drop that runs while the derivation disagrees with
-- the column would destroy the evidence that anything was ever wrong.
DO $$
DECLARE
  _disagree int;
  _dupes    int;
BEGIN
  SELECT count(*) INTO _disagree
    FROM public.leave_requests lr
   WHERE (lr.status <> 'pending')
      <> EXISTS (SELECT 1 FROM public.leave_decisions d WHERE d.leave_request_id = lr.id);

  IF _disagree <> 0 THEN
    RAISE EXCEPTION
      'ABORT: % leave_request(s) disagree between status and decision-row existence. '
      'Dropping the column now would erase the evidence. Reconcile first.', _disagree;
  END IF;

  -- The partial index below cannot be created if a role-less duplicate already
  -- exists. Fail with a countable number rather than a raw index error.
  SELECT count(*) INTO _dupes FROM (
    SELECT leave_request_id
      FROM public.leave_decisions
     WHERE decided_by_role IS NULL
     GROUP BY 1 HAVING count(*) > 1
  ) x;

  IF _dupes <> 0 THEN
    RAISE EXCEPTION
      'ABORT: % leave_request(s) already carry more than one role-less decision. '
      'The partial unique index cannot be created until those are resolved.', _dupes;
  END IF;
END $$;

-- ---------- 2. the guarantee the client used to provide ---------------------
CREATE UNIQUE INDEX IF NOT EXISTS leave_decisions_one_roleless_per_request
  ON public.leave_decisions (leave_request_id)
  WHERE decided_by_role IS NULL;

COMMENT ON INDEX public.leave_decisions_one_roleless_per_request IS
  'Companion to leave_decisions_one_per_role. That constraint permits unlimited '
  'duplicates when decided_by_role IS NULL, because NULLs are distinct in a '
  'unique index. Batch 1c removed the client-side .eq("status","pending") guard '
  'that had been standing in for this.';

-- ---------- 3. the dual write ----------------------------------------------
ALTER TABLE public.leave_requests
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS reviewed_at,
  DROP COLUMN IF EXISTS reviewed_by;

-- ---------- 4. the type nothing uses any more -------------------------------
DROP TYPE IF EXISTS public.leave_status;

-- ---------- 5. prove the drop actually happened -----------------------------
-- A migration that silently no-ops looks identical to one that worked.
DO $$
DECLARE
  _left int;
BEGIN
  SELECT count(*) INTO _left
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'leave_requests'
     AND column_name IN ('status', 'reviewed_at', 'reviewed_by');

  IF _left <> 0 THEN
    RAISE EXCEPTION 'ABORT: % of the 3 dual-write column(s) survived the drop', _left;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'leave_status'
              AND typnamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'ABORT: public.leave_status survived the drop';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                  WHERE schemaname = 'public'
                    AND indexname = 'leave_decisions_one_roleless_per_request') THEN
    RAISE EXCEPTION 'ABORT: the replacement uniqueness guard was not created';
  END IF;
END $$;

COMMIT;
