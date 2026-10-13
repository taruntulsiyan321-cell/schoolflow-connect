// Canonical phone normalization — the one TypeScript copy: the edge functions
// and the app both import it (src/lib/phone.test.ts tests it here). The SQL
// public.normalize_phone() (20260808100000_canonical_phone_normalization.sql)
// applies the same algorithm and the same India-only assumption; change both
// together.

const DEFAULT_COUNTRY_CODE = "91";

/** Canonical digits-only form (no "+"), or null if raw isn't a plausible phone number. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 10) digits = DEFAULT_COUNTRY_CODE + digits;
  if (digits.length < 10 || digits.length > 15) return null;
  return digits;
}

