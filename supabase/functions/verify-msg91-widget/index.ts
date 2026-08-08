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

/** MSG91 returns the verified number as digits (commonly with country code, no "+"). */
function toE164(msg91Mobile: string): string | null {
  const digits = String(msg91Mobile ?? "").replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

function maskPhone(e164: string): string {
  const digits = e164.replace(/\D/g, "");
  return `+${digits.slice(0, 2)}${"•".repeat(Math.max(0, digits.length - 6))}${digits.slice(-4)}`;
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
    const { access_token } = await req.json().catch(() => ({}));
    if (!access_token || typeof access_token !== "string") {
      return json({ error: "access_token is required", error_code: "missing_access_token" }, 400);
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
      console.error("[verify-msg91-widget] MSG91 verifyAccessToken failed:", reason);
      await logAttempt(admin, ip, false, "invalid_or_expired_token");
      return json(
        { error: "That verification could not be confirmed — it may have expired. Please try again.", error_code: "invalid_or_expired_token" },
        400,
      );
    }

    const verifiedPhone = toE164(String(msg91Data.message ?? ""));
    if (!verifiedPhone) {
      console.error("[verify-msg91-widget] MSG91 returned an unparseable phone:", msg91Data.message);
      await logAttempt(admin, ip, false, "unparseable_phone");
      return json({ error: "Verification succeeded but the phone number was invalid.", error_code: "unparseable_phone" }, 502);
    }

    // From here on, verifiedPhone is the ONLY phone number this function
    // trusts — it came from MSG91's own response, never from the request body.
    const result = await linkOrCreatePhoneUser(admin, verifiedPhone);
    await logAttempt(admin, ip, true);

    return json({ ...result, verified_phone_masked: maskPhone(verifiedPhone) });
  } catch (e) {
    console.error("[verify-msg91-widget]", e);
    await logAttempt(admin, ip, false, "internal_error").catch(() => {});
    return json({ error: e instanceof Error ? e.message : "Unknown error", error_code: "internal_error" }, 500);
  }
});
