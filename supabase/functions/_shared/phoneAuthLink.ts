/**
 * Phone → Supabase-Auth account linking, shared by every OTP-style sign-in
 * path (raw send-otp/verify-otp today; the MSG91 Widget path too).
 *
 * One phone number maps to exactly one account: Supabase Auth itself
 * enforces phone uniqueness on auth.users.phone (createUser below passes a
 * real phone, not just metadata), and findExistingPhoneUser searches before
 * creating so a repeat verification always resolves to the same account
 * rather than racing a duplicate. Never invents a session directly — always
 * returns a magic-link token_hash for the client to redeem itself via
 * supabase.auth.verifyOtp({ email, token_hash, type: "email" }), so a raw
 * session/URL never has to be logged, proxied, or stored server-side.
 */

import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type AdminClient = ReturnType<typeof createClient>;

export type PhoneLinkResult = {
  success: true;
  email: string;
  token_hash: string;
  type: "email";
  is_new_user: boolean;
};

/** E.164 phone -> the synthetic email every phone-derived account is keyed by. */
export function syntheticEmailForPhone(phoneDigits: string): string {
  return `${phoneDigits}@phone.vidyalaya.local`;
}

async function findExistingPhoneUser(
  admin: AdminClient,
  email: string,
  phoneDigits: string,
): Promise<{ id: string } | null> {
  let page = 1;
  const perPage = 200;
  while (page < 50) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error || !data) return null;
    const hit = data.users.find((u) => {
      const uPhone = (u.phone || "").replace(/\D/g, "");
      return u.email === email || (phoneDigits && uPhone === phoneDigits);
    });
    if (hit) return { id: hit.id };
    if (data.users.length < perPage) return null;
    page++;
  }
  return null;
}

/**
 * Find-or-create the Supabase Auth account for a phone number that has
 * already been verified by the caller (raw OTP hash match, or MSG91's
 * verifyAccessToken) — this function trusts phoneE164 completely, so every
 * caller must have independently verified it belongs to the requester
 * before calling this.
 */
export async function linkOrCreatePhoneUser(
  admin: AdminClient,
  phoneE164: string,
): Promise<PhoneLinkResult> {
  const phoneDigits = String(phoneE164).replace(/[^0-9]/g, "");
  const email = syntheticEmailForPhone(phoneDigits);
  const password = crypto.randomUUID() + "!Aa1";

  let user = await findExistingPhoneUser(admin, email, phoneDigits);
  let is_new_user = false;
  if (!user) {
    const { data: created, error } = await admin.auth.admin.createUser({
      phone: phoneDigits,
      email,
      password,
      phone_confirm: true,
      email_confirm: true,
    });
    if (error) throw error;
    user = { id: created.user!.id };
    is_new_user = true;
  }

  // Never return a raw magic-link URL (session theft if intercepted / logged).
  // Client completes sign-in with verifyOtp({ email, token_hash, type: 'email' }).
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) throw linkErr;

  const tokenHash = link.properties?.hashed_token;
  if (!tokenHash) throw new Error("Failed to mint sign-in token");

  return { success: true, email, token_hash: tokenHash, type: "email", is_new_user };
}
