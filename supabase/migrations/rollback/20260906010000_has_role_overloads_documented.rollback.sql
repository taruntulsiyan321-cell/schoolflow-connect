-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — has_role loses its documentation
--
-- Comments only; no behaviour is restored or removed. The overloads keep asking
-- the two different questions rule 28 describes, they just stop saying so.
-- ═══════════════════════════════════════════════════════════════════════════
BEGIN;
COMMENT ON FUNCTION public.has_role(uuid, app_role) IS NULL;
COMMENT ON FUNCTION public.has_role(uuid, app_role, uuid) IS NULL;
COMMIT;
