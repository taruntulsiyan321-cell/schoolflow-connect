/**
 * Canonical phone normalization — the ONE format every phone number in this
 * app is stored and compared in: digits only, always including country
 * code, no leading "+". E.g. "9876543210", "+91 98765-43210", and
 * "919876543210" all normalize to "919876543210".
 *
 * Mirrored server-side in supabase/functions/_shared/phone.ts (same "edge
 * mirror" pattern already used for phoneAuthLink.ts) and in SQL as
 * public.normalize_phone() — all three must stay in sync; see the
 * 20260808100000_canonical_phone_normalization.sql migration for the SQL
 * version of this exact algorithm.
 *
 * Scope note: this app is India-only today (MSG91, the "+91 98765 43210"
 * placeholder text, and every phone field observed in the codebase assume
 * India). A bare 10-digit number is therefore assumed to be a local Indian
 * mobile number and gets "91" prefixed. Any other digit count is assumed to
 * already include its country code and is left as-is. This is a deliberate,
 * scoped assumption, not general E.164 parsing — supporting other countries'
 * local-number formats would need a real phone-parsing library (e.g.
 * libphonenumber), which is out of scope here.
 */
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

/** normalizePhone() with a leading "+", for display or APIs that require
 *  strict E.164 (e.g. MSG91's raw OTP send endpoint). */
export function toE164Display(raw: string | null | undefined): string | null {
  const normalized = normalizePhone(raw);
  return normalized ? `+${normalized}` : null;
}

/** True if two phone numbers refer to the same canonical number, regardless
 *  of how each was formatted/typed — never compare raw phone strings directly. */
export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePhone(a);
  return na !== null && na === normalizePhone(b);
}
