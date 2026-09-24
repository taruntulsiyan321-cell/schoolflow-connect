/**
 * MSG91 Widget sign-in orchestration — turns a verified access-token into a
 * live Supabase session. Reuses the existing edge-function invoke helper
 * (edgeFunction.ts, already used by every other AI/edge-fn caller) and the
 * standard Supabase Auth verifyOtp call — no new session-creation mechanism.
 */
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { supabase } from "@/integrations/supabase/client";
import { normalizePhone } from "@/lib/phone";

type VerifyMsg91Response = {
  success?: boolean;
  email?: string;
  token_hash?: string;
  type?: string;
  is_new_user?: boolean;
  verified_phone_masked?: string;
};

export type Msg91SignInResult =
  | { ok: true; is_new_user: boolean; verified_phone_masked: string }
  | { ok: false; error: string };

/**
 * Verifies the MSG91 access-token server-side (never trusts a phone number
 * from the client) and, on success, completes the resulting magic-link sign
 * in — after this resolves ok:true, supabase.auth already has a real
 * session and the rest of the app (AuthProvider, role resolution, RLS)
 * behaves exactly as it does for any other sign-in method.
 */
export async function completeMsg91SignIn(
  accessToken: string,
  examCode?: string,
): Promise<Msg91SignInResult> {
  const { data, error } = await invokeEdgeFunction<VerifyMsg91Response>("verify-msg91-widget", {
    access_token: accessToken,
    // Present only for an individual student. The exam is part of WHICH
    // account this phone number signs into, not a preference set afterwards,
    // so it travels with the verification itself.
    ...(examCode ? { exam: examCode } : {}),
  });
  if (error || !data?.email || !data?.token_hash) {
    return { ok: false, error: error ?? "Verification succeeded but sign-in could not be completed." };
  }

  // token_hash ALONE, never with the email beside it. GoTrue refuses a body
  // carrying both — measured live 2026-09-23 against /auth/v1/verify: with
  // email it answers 400 validation_failed, "Only the token_hash and type
  // should be provided"; without it, 200 and a session. The hash already
  // names the account, so the address adds nothing but the refusal.
  const { error: verifyErr } = await supabase.auth.verifyOtp({
    token_hash: data.token_hash,
    type: "email",
  });
  if (verifyErr) return { ok: false, error: verifyErr.message };

  return {
    ok: true,
    is_new_user: Boolean(data.is_new_user),
    verified_phone_masked: data.verified_phone_masked ?? "",
  };
}

/**
 * Mirrors _shared/phoneAuthLink.ts's syntheticEmailForPhone exactly (same
 * "edge mirror" pattern already used for capabilityCatalog.ts) — Mobile +
 * Password sign-in derives the same deterministic email and reuses the
 * existing signIn({email, password}) path unchanged, rather than adding a
 * second sign-in mechanism.
 *
 * Goes through the shared normalizePhone() (not a bare digit-strip) so a
 * user who verified via the OTP widget as "+91 98765 43210" and later types
 * "9876543210" here (no country code) still resolves to the same account —
 * previously these produced two different synthetic emails.
 */
export function phoneToSyntheticEmail(rawPhone: string): string | null {
  const digits = normalizePhone(rawPhone);
  if (!digits) return null;
  return `${digits}@phone.vidyalaya.local`;
}
