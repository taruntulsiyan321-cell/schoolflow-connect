-- ============================================================
-- NOTICES EXPIRATION FEATURE
-- ============================================================

ALTER TABLE public.notices ADD COLUMN expires_at TIMESTAMPTZ;
