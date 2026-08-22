-- Found in a code-trace review (2026-08-22): both the enforcement RPC
-- (rpc_bulk_upsert_attendance) and the DB-level trigger that's the actual
-- last line of defense against locked-date writes (trg_attendance_reject_if_locked,
-- 20260820161000) check `attendance_locks.school_id = <caller's school_id>`.
-- Plain `=` never matches NULL in SQL -- if a lock row's school_id were ever
-- NULL, both checks would silently fail to find it, and the lock would be
-- unenforceable for every school, not just one. attendance_locks.school_id
-- is nullable today. Zero rows currently have a null school_id (confirmed
-- live), so nothing exploits this yet, but the column allowing it at all
-- means a single future write path that forgets to set school_id creates a
-- silently-broken lock instead of a loud, obvious error.
--
-- Fix: make the column NOT NULL so that state can't exist at all, rather
-- than trying to make every comparison site NULL-safe piecemeal.
ALTER TABLE public.attendance_locks ALTER COLUMN school_id SET NOT NULL;

-- Re-verify: the ALTER itself fails if any existing row would violate it --
-- confirmed 0 such rows live before writing this migration.
