-- ROLLBACK — Chunk 4 part 2, the attendance write path (20260826171000).
-- Restores rpc_bulk_upsert_attendance to its pre-Chunk-4 body and drops the
-- ensure-submission RPC. Only valid together with the 20260826170000 rollback:
-- on its own it would leave a write path that cannot satisfy the NOT NULL on
-- attendance.submission_id.
DROP FUNCTION IF EXISTS public.rpc_ensure_attendance_submission(uuid, date);
-- rpc_bulk_upsert_attendance is restored by re-running
-- supabase/migrations/20260808110000_atomic_bulk_attendance_upsert.sql
