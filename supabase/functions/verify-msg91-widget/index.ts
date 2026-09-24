// Verify an MSG91 OTP Widget access-token server-side and sign the caller in.
//
// The client never gets to assert a phone number here -- it hands us only
// the widget's `access-token`, and the ONLY phone number this function ever
// trusts is the one MSG91 itself returns from verifyAccessToken. Reuses the
// same find-or-create-account + magic-link session pattern as the raw OTP
// path (see _shared/phoneAuthLink.ts) -- this function's entire job is
// turning an MSG91 access-token into a verified E.164 phone number; account
// linking, session minting, role resolution, RLS, and tenant isolation are
// all inherited unchanged from the existing Supabase Auth architecture.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { linkOrCreatePhoneUser } from "../_shared/phoneAuthLink.ts";
import { normalizePhone } from "../_shared/phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MSG91_VERIFY_URL = "https://control.msg91.com/api/v5/widget/verifyAccessToken";
const RATE_LIMIT_WINDOW_MIN = 10;
const RATE_LIMIT_MAX_ATTEMPTS = 15;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

function maskPhone(canonicalDigits: string): string {
  return `+${canonicalDigits.slice(0, 2)}${"•".repeat(Math.max(0, canonicalDigits.length - 6))}${canonicalDigits.slice(-4)}`;
}

async function logAttempt(
  admin: ReturnType<typeof createClient>,
  identifier: string,
  success: boolean,
  error_code?: string,
): Promise<void> {
  const { error } = await admin.from("auth_verify_attempts").insert({
    method: "msg91_widget_verify",
    identifier,
    success,
    error_code: error_code ?? null,
  });
  if (error) console.error("[verify-msg91-widget] failed to log attempt:", error.message);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const ip = clientIp(req);

  try {
    const { access_token, exam } = await req.json().catch(() => ({}));
    if (!access_token || typeof access_token !== "string") {
      return json({ error: "access_token is required", error_code: "missing_access_token" }, 400);
    }

    // The individual student's sign-in names the exam they chose on the login
    // page. Its shape is checked here and its EXISTENCE in the database below
    // (rpc_create_exam_account) -- this string becomes part of an account's
    // permanent identity, so a typo must not silently mint a second account
    // on the same phone. Absent = the school sign-in, unchanged.
    const examCode = typeof exam === "string" ? exam.trim().toLowerCase() : "";
    if (exam !== undefined && exam !== null && !/^[a-z0-9_]{2,32}$/.test(examCode)) {
      return json({ error: "That exam is not one we offer.", error_code: "unknown_exam" }, 400);
    }

    // Rate-limit by caller IP -- an access-token is single-use/short-lived on
    // MSG91's side, so this guards against someone hammering this endpoint
    // with garbage tokens rather than against a legitimate retry.
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MIN * 60_000).toISOString();
    const { count } = await admin
      .from("auth_verify_attempts")
      .select("*", { count: "exact", head: true })
      .eq("method", "msg91_widget_verify")
      .eq("identifier", ip)
      .gte("created_at", since);
    if ((count ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS) {
      await logAttempt(admin, ip, false, "rate_limited");
      return json({ error: "Too many attempts. Try again later.", error_code: "rate_limited" }, 429);
    }

    const MSG91_AUTH_KEY = Deno.env.get("MSG91_AUTH_KEY");
    if (!MSG91_AUTH_KEY) {
      throw new Error("MSG91 not configured — set MSG91_AUTH_KEY secret");
    }

    let msg91Res: Response;
    try {
      msg91Res = await fetch(MSG91_VERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ authkey: MSG91_AUTH_KEY, "access-token": access_token }),
      });
    } catch (networkErr) {
      await logAttempt(admin, ip, false, "msg91_unreachable");
      return json(
        { error: "Could not reach the verification service. Please try again.", error_code: "msg91_unreachable" },
        503,
      );
    }

    const msg91Data = await msg91Res.json().catch(() => null);
    if (!msg91Res.ok || !msg91Data || msg91Data.type !== "success") {
      const reason = msg91Data?.message ?? `HTTP ${msg91Res.status}`;
      // Fingerprint only — never log the token. Distinguishes "we sent a
      // reqId / garbage" (no JWT shape) from "MSG91 rejected a real JWT"
      // (auth-key mismatch or expired single-use token).
      const tokenFp = {
        length: access_token.length,
        jwt_shaped: access_token.startsWith("eyJ") && access_token.includes("."),
        msg91_http: msg91Res.status,
        msg91_type: msg91Data?.type ?? null,
      };
      console.error("[verify-msg91-widget] MSG91 verifyAccessToken failed:", reason, tokenFp);
      await logAttempt(admin, ip, false, "invalid_or_expired_token");
      return json(
        { error: "That verification could not be confirmed — it may have expired. Please try again.", error_code: "invalid_or_expired_token" },
        400,
      );
    }

    const verifiedPhone = normalizePhone(String(msg91Data.message ?? ""));
    if (!verifiedPhone) {
      console.error("[verify-msg91-widget] MSG91 returned an unparseable phone (length:", String(msg91Data.message ?? "").length, ")");
      await logAttempt(admin, ip, false, "unparseable_phone");
      return json({ error: "Verification succeeded but the phone number was invalid.", error_code: "unparseable_phone" }, 502);
    }

    // From here on, verifiedPhone is the ONLY phone number this function
    // trusts — it came from MSG91's own response, never from the request body.
    const { user_id, ...result } = await linkOrCreatePhoneUser(
      admin,
      verifiedPhone,
      examCode || undefined,
    );

    // The exam account's own space is opened BEFORE the sign-in token is
    // handed back, and the token is withheld if it cannot be. The first thing
    // the app does with a session is call get_auth_context(), which runs
    // link_portal_on_auth() — and that absorbs any account whose profile
    // names no school into the first institution with a matching portal row.
    // A student who signed in first and got their space second would be
    // exposed for exactly that window. Opening it is idempotent, so a retry
    // after a failure here resolves to the same account.
    if (examCode) {
      const { error: spaceErr } = await admin.rpc("rpc_create_exam_account", {
        _account_id: user_id,
        _exam_code: examCode,
        _phone: verifiedPhone,
        _full_name: "",
      });
      if (spaceErr) {
        console.error("[verify-msg91-widget] could not open the exam account:", spaceErr.message);
        await logAttempt(admin, ip, false, "exam_account_not_opened");
        const unknown = /no active exam/i.test(spaceErr.message);
        return json(
          {
            error: unknown
              ? "That exam is not one we offer."
              : "We could not finish setting up your account. Please try again.",
            error_code: unknown ? "unknown_exam" : "exam_account_not_opened",
          },
          unknown ? 400 : 500,
        );
      }
    }

    await logAttempt(admin, ip, true);

    return json({ ...result, verified_phone_masked: maskPhone(verifiedPhone) });
  } catch (e) {
    console.error("[verify-msg91-widget]", e);
    await logAttempt(admin, ip, false, "internal_error").catch(() => {});
    return json({ error: "Something went wrong. Please try again.", error_code: "internal_error" }, 500);
  }
});
