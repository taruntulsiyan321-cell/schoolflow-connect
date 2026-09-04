-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — restore the practice-leaking parent digest
--
-- READ BEFORE RUNNING. The forward migration closed a live §10.8 violation:
-- the old function sent a child's practice accuracy, battle-weighted activity
-- and a practice-weighted readiness score TO THEIR PARENT, and titled one of
-- its alerts "Needs support in practice."
--
-- This file puts that back. There is no data reason to run it —
-- parent_academic_alerts holds 0 rows and nothing has ever called the
-- function — so the only honest use is a bisect.
--
-- Restoring the exact prior body is not possible from this file alone: it
-- depended on rpc_student_academic_snapshot_internal, which this migration did
-- not touch and which may itself have moved on. Recover the previous
-- definition from migration 20260607000000_student_success_phase2.sql and the
-- 20260902120000 exam-readiness patch rather than trusting a copy here to be
-- current.
--
-- What this file DOES do is put the function back into a state where the
-- practice fields flow again, by restoring the snapshot passthrough. If that
-- is genuinely what you want, take the body from those two migrations.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
BEGIN
  IF to_regprocedure('public.rpc_student_academic_snapshot_internal(uuid, uuid)') IS NULL THEN
    RAISE EXCEPTION
      'ABORT: rpc_student_academic_snapshot_internal no longer exists; the old digest cannot be restored from this file';
  END IF;
  RAISE NOTICE
    'This rollback re-enables practice data reaching parents (10.8). Restore the body from 20260607000000 + 20260902120000.';
END
$guard$;

DELETE FROM public.schema_migrations WHERE version = '20260904120000_parent_digest_school_only';

COMMIT;
