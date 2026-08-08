import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MSG91_OTP_URL = "https://control.msg91.com/api/v5/otp";

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { phone } = await req.json();
    if (!phone || !/^\+[1-9]\d{6,14}$/.test(phone)) {
      return new Response(JSON.stringify({ error: "Invalid phone (E.164 required)" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const MSG91_AUTH_KEY = Deno.env.get("MSG91_AUTH_KEY");
    const MSG91_TEMPLATE_ID = Deno.env.get("MSG91_TEMPLATE_ID");
    if (!MSG91_AUTH_KEY) throw new Error("MSG91 not configured — set MSG91_AUTH_KEY secret");
    if (!MSG91_TEMPLATE_ID) throw new Error("Set MSG91_TEMPLATE_ID secret to your DLT-approved MSG91 OTP template ID");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Rate-limit: max 3 OTPs per phone per 10 min
    const since = new Date(Date.now() - 10 * 60_000).toISOString();
    const { count } = await supabase.from("phone_otps").select("*", { count: "exact", head: true }).eq("phone", phone).gte("created_at", since);
    if ((count ?? 0) >= 3) {
      return new Response(JSON.stringify({ error: "Too many requests. Try later." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const code_hash = await sha256(code);
    const expires_at = new Date(Date.now() + 5 * 60_000).toISOString();
    await supabase.from("phone_otps").insert({ phone, code_hash, expires_at });

    // MSG91 expects the mobile number without the leading "+" (e.g. 919876543210).
    const mobile = phone.replace(/^\+/, "");

    const r = await fetch(MSG91_OTP_URL, {
      method: "POST",
      headers: {
        authkey: MSG91_AUTH_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        template_id: MSG91_TEMPLATE_ID,
        mobile,
        otp: code,
        otp_expiry: 5,
      }),
    });
    const data = await r.json();
    // MSG91 returns 200 with {type:"error", message:"..."} on failure, not just non-2xx.
    if (!r.ok || data?.type === "error") throw new Error(`MSG91 ${r.status}: ${JSON.stringify(data)}`);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
