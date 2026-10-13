-- ROLLBACK 20261160000000 — recreates the two duplicate indexes exactly.

BEGIN;

CREATE UNIQUE INDEX app_settings_school_uidx ON public.app_settings USING btree (school_id);
CREATE INDEX idx_notices_created_at ON public.notices USING btree (created_at DESC);

COMMIT;
