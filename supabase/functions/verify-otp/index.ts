import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function findUserByEmailOrPhone(
  admin: ReturnType<typeof createClient>,
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { phone, code } = await req.json();
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

    const phoneDigits = String(phone).replace(/[^0-9]/g, "");
    const email = `${phoneDigits}@phone.vidyalaya.local`;
    const password = crypto.randomUUID() + "!Aa1";

    let user = await findUserByEmailOrPhone(admin, email, phoneDigits);
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

    return new Response(
      JSON.stringify({
        success: true,
        email,
        token_hash: tokenHash,
        type: "email",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
