import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { linkOrCreatePhoneUser } from "../_shared/phoneAuthLink.ts";
import { normalizePhone } from "../_shared/phone.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { phone: rawPhone, code } = await req.json();
    const phone = normalizePhone(rawPhone);
    if (!phone || !code) {
      return new Response(JSON.stringify({ error: "phone and code required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: rows } = await admin
      .from("phone_otps")
      .select("*")
      .eq("phone", phone)
      .eq("consumed", false)
      .order("created_at", { ascending: false })
      .limit(1);
    const otp = rows?.[0];
    if (!otp) {
      return new Response(JSON.stringify({ error: "No OTP requested" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (new Date(otp.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "OTP expired" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (otp.attempts >= 5) {
      return new Response(JSON.stringify({ error: "Too many attempts" }), {
        status: 429,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hash = await sha256(String(code));
    if (hash !== otp.code_hash) {
      await admin.from("phone_otps").update({ attempts: otp.attempts + 1 }).eq("id", otp.id);
      return new Response(JSON.stringify({ error: "Invalid code" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    await admin.from("phone_otps").update({ consumed: true }).eq("id", otp.id);

    const result = await linkOrCreatePhoneUser(admin, phone);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: "Something went wrong. Please try again." }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
