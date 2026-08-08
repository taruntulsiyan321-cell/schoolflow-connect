/**
 * MSG91 Widget sign-in orchestration — turns a verified access-token into a
 * live Supabase session. Reuses the existing edge-function invoke helper
 * (edgeFunction.ts, already used by every other AI/edge-fn caller) and the
 * standard Supabase Auth verifyOtp call — no new session-creation mechanism.
 */
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { supabase } from "@/integrations/supabase/client";

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
export async function completeMsg91SignIn(accessToken: string): Promise<Msg91SignInResult> {
  const { data, error } = await invokeEdgeFunction<VerifyMsg91Response>("verify-msg91-widget", {
    access_token: accessToken,
  });
  if (error || !data?.email || !data?.token_hash) {
    return { ok: false, error: error ?? "Verification succeeded but sign-in could not be completed." };
  }

  const { error: verifyErr } = await supabase.auth.verifyOtp({
    email: data.email,
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
 */
export function phoneToSyntheticEmail(rawPhone: string): string {
  const digits = rawPhone.replace(/[^0-9]/g, "");
  return `${digits}@phone.vidyalaya.local`;
}
