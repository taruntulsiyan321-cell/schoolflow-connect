-- Rollback 20261080100000 — restore 690 tally body (upload join only, no capture).
-- Does NOT re-insert deleted revision_queue poison rows (derived; rebuild on next write).
-- Re-apply 20261069000000_upload_chapter_tally.sql body if a full restore is needed.
SELECT 1;
