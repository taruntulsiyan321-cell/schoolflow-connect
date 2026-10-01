-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: every file is an upload again
--
-- Drops the submission column, the plan-use marks and the two functions. Note
-- what you are restoring: a worksheet photographed as three pages costs three
-- of the month's Custom Practice uploads (KNOWN_ISSUES 85). Deploy the
-- custom-practice-upload function from before 20261131000000 FIRST — the one
-- after it calls _upload_counted_sibling and would fail closed without it.
--
-- Undoes: 20261131000000_one_submission_is_one_upload.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION public._upload_record_plan_use(uuid, text);
DROP FUNCTION public._upload_counted_sibling(uuid);
DROP TABLE public.student_upload_plan_uses;
DROP INDEX public.student_uploads_submission_idx;
ALTER TABLE public.student_uploads DROP COLUMN submission_id;

DELETE FROM public.schema_migrations WHERE version = '20261131000000_one_submission_is_one_upload';

COMMIT;
