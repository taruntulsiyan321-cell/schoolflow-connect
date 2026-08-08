// Canonical phone normalization — Deno edge mirror of src/lib/phone.ts.
// Keep both in sync (and the SQL public.normalize_phone() function, upgraded
// in 20260808100000_canonical_phone_normalization.sql) — same algorithm,
// same India-only scope assumption. See src/lib/phone.ts for the full
// rationale; duplicated here rather than imported since edge functions and
// the client bundle build separately (same pattern as capabilityCatalog.ts).

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

/** normalizePhone() with a leading "+", for APIs that require strict E.164
 *  (e.g. MSG91's raw OTP send endpoint). */
export function toE164Display(raw: string | null | undefined): string | null {
  const normalized = normalizePhone(raw);
  return normalized ? `+${normalized}` : null;
}
