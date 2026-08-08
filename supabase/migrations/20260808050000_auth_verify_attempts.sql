-- =============================================================================
-- auth_verify_attempts — rate limiting + logging for OTP/widget-based auth
--
-- Backs the MSG91 Widget verification path (and is generic enough to log the
-- existing raw send-otp/verify-otp path too): every verification attempt is
-- logged with its outcome, and the same rows are queried to rate-limit by
-- (method, identifier) within a time window -- mirrors the existing
-- phone_otps count-based rate-limit pattern in send-otp/index.ts rather than
-- inventing a new mechanism.
--
-- No PII beyond a caller-chosen identifier (edge functions pass a hash or a
-- masked value, never a raw phone number, into `identifier`) -- this table
-- exists to detect abuse, not to store contact information.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.auth_verify_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  method text NOT NULL CHECK (method IN ('otp_send', 'otp_verify', 'msg91_widget_verify')),
  identifier text NOT NULL,
  success boolean NOT NULL,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_verify_attempts_lookup
  ON public.auth_verify_attempts (method, identifier, created_at DESC);

ALTER TABLE public.auth_verify_attempts ENABLE ROW LEVEL SECURITY;
-- No client policies -- service-role (edge functions) only, same posture as phone_otps.

REVOKE ALL ON public.auth_verify_attempts FROM anon, authenticated;
GRANT ALL ON public.auth_verify_attempts TO service_role;
