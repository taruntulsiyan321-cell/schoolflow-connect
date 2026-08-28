-- ROLLBACK — restores the unreachable default on battles.source.
--
-- Running this puts back a DEFAULT ('manual') that the column's own CHECK
-- constraint rejects, so any insert omitting source will fail again. It exists
-- for completeness; there is no reason to want it.
BEGIN;
ALTER TABLE public.battles ALTER COLUMN source SET DEFAULT 'manual';
COMMIT;
