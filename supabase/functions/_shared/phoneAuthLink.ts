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
 * supabase.auth.verifyOtp({ token_hash, type: "email" }), so a raw
 * session/URL never has to be logged, proxied, or stored server-side.
 */

import { normalizePhone } from "./phone.ts";

/**
 * The three admin calls this module makes, and nothing else.
 *
 * This was `ReturnType<typeof createClient>` imported from esm.sh over HTTP.
 * Deno resolves that; the app's TypeScript project does not, so the moment a
 * test under src/ imported this file the whole build failed on a module it
 * could not fetch. Naming the contract directly costs nothing -- a real
 * SupabaseClient still satisfies it structurally -- and it says on the page
 * what this file is allowed to do with a service-role client.
 */
type AdminClient = {
  auth: {
    admin: {
      listUsers(params: { page: number; perPage: number }): Promise<{
        data: { users: { id: string; email?: string | null; phone?: string | null }[] } | null;
        error: { message: string } | null;
      }>;
      createUser(attrs: Record<string, unknown>): Promise<{
        data: { user: { id: string } | null };
        error: { message: string } | null;
      }>;
      generateLink(params: { type: string; email: string }): Promise<{
        data: { properties?: { hashed_token?: string } | null } | null;
        error: { message: string } | null;
      }>;
    };
  };
};

export type PhoneLinkResult = {
  success: true;
  user_id: string;
  email: string;
  token_hash: string;
  type: "email";
  is_new_user: boolean;
};

/** Canonical phone -> the synthetic email every phone-derived account is keyed by. */
export function syntheticEmailForPhone(phoneDigits: string): string {
  return `${phoneDigits}@phone.vidyalaya.local`;
}

/**
 * The individual student's key: phone AND exam.
 *
 * One person preparing for two exams has two accounts on one number (ruling
 * 2026-09-23: the exam is picked at sign-in and fixed for ever, so another
 * exam is another account). auth.users.phone is UNIQUE, so it cannot be the
 * key for more than one of them -- the exam account therefore carries no
 * auth.users.phone at all and is identified purely by this email. The
 * verified number is kept on the profile instead (rpc_create_exam_account).
 *
 * A separate domain from the school accounts above, so the two families can
 * never be confused by an eyeball or by a LIKE.
 */
export function syntheticEmailForExamAccount(phoneDigits: string, examCode: string): string {
  return `${phoneDigits}.${examCode}@exam.vidyalaya.local`;
}

/** phoneDigits must already be normalizePhone()'d -- this normalizes each
 *  candidate's stored auth.users.phone the same way before comparing, so an
 *  older account created before the canonical-format fix (e.g. via
 *  admin-link-account's phone path) still matches instead of silently
 *  spawning a duplicate account.
 *
 *  phoneDigits is passed EMPTY for an exam account, which is what makes the
 *  match email-only: matching on the number as well would resolve every exam
 *  on one phone to whichever account happened to be created first, and would
 *  hand a school account's session to someone asking for an exam account. */
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
      const uPhone = normalizePhone(u.phone);
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
  examCode?: string,
): Promise<PhoneLinkResult> {
  const phoneDigits = normalizePhone(phoneE164);
  if (!phoneDigits) throw new Error("Invalid phone number");
  const isExam = Boolean(examCode);
  const email = isExam
    ? syntheticEmailForExamAccount(phoneDigits, examCode!)
    : syntheticEmailForPhone(phoneDigits);
  const password = crypto.randomUUID() + "!Aa1";

  // An exam account is looked up, and created, WITHOUT auth.users.phone: that
  // column is unique, and one number holds one account per exam.
  let user = await findExistingPhoneUser(admin, email, isExam ? "" : phoneDigits);
  let is_new_user = false;
  if (!user) {
    const { data: created, error } = await admin.auth.admin.createUser({
      ...(isExam ? {} : { phone: phoneDigits, phone_confirm: true }),
      email,
      password,
      email_confirm: true,
    });
    if (error) throw error;
    user = { id: created.user!.id };
    is_new_user = true;
  }

  // Never return a raw magic-link URL (session theft if intercepted / logged).
  // Client completes sign-in with verifyOtp({ token_hash, type: "email" }) --
  // the email must NOT be sent beside the hash; GoTrue refuses that body.
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (linkErr) throw linkErr;

  const tokenHash = link?.properties?.hashed_token;
  if (!tokenHash) throw new Error("Failed to mint sign-in token");

  return { success: true, user_id: user.id, email, token_hash: tokenHash, type: "email", is_new_user };
}
