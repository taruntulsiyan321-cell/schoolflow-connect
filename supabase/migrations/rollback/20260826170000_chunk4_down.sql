-- =====================================================================
-- ROLLBACK — Chunk 4 ATTENDANCE (20260826170000)
--
-- Restores the pre-Chunk-4 shape. Note what this CANNOT undo: the status
-- collapse. Once late->present and leave->absent were applied, the original
-- distinction is gone from the register — 4 'late' and 3 'leave' rows. The
-- pre-collapse values are recorded in the migration header and in
-- attendance_audit for any row that was later edited. If you need them back,
-- restore from a backup taken before 2026-08-26; this script does not pretend
-- to reconstruct them.
-- =====================================================================

-- --- Section 5: policies ---------------------------------------------
DROP POLICY IF EXISTS attendance_principal_never_writes             ON public.attendance;
DROP POLICY IF EXISTS attendance_submissions_principal_never_writes ON public.attendance_submissions;
DROP POLICY IF EXISTS attendance_submissions_admin_all              ON public.attendance_submissions;
DROP POLICY IF EXISTS attendance_submissions_class_teacher_insert   ON public.attendance_submissions;
DROP POLICY IF EXISTS attendance_submissions_read                   ON public.attendance_submissions;
DROP POLICY IF EXISTS attendance_submissions_tenant_fence           ON public.attendance_submissions;

-- --- Section 4: attendance_audit -------------------------------------
DROP INDEX IF EXISTS public.attendance_audit_submission_idx;
ALTER TABLE public.attendance_audit DROP COLUMN IF EXISTS submission_id;
COMMENT ON TABLE public.attendance_audit IS NULL;

-- --- Section 3: attendance -------------------------------------------
DROP TRIGGER IF EXISTS trg_attendance_matches_submission ON public.attendance;
DROP FUNCTION IF EXISTS public.tg_attendance_matches_submission();

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_submission_fk;
DROP INDEX IF EXISTS public.attendance_submission_idx;
ALTER TABLE public.attendance DROP COLUMN IF EXISTS submission_id;

COMMENT ON COLUMN public.attendance.class_id IS NULL;
COMMENT ON COLUMN public.attendance.date IS NULL;

-- --- Section 2: attendance_submissions -------------------------------
DROP TRIGGER IF EXISTS trg_attendance_submissions_same_institution ON public.attendance_submissions;
DROP TABLE IF EXISTS public.attendance_submissions;
DROP FUNCTION IF EXISTS public.tg_attendance_submissions_same_institution();

-- --- Section 1: the present/absent constraint ------------------------
ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_status_present_absent_only;
ALTER TABLE public.attendance ALTER COLUMN school_id DROP NOT NULL;
COMMENT ON COLUMN public.attendance.status IS NULL;
