/**
 * premium-checkout — start paying for a plan.
 *
 *   POST { product_code, terms_version, guardian_confirmed: true }
 *   → { order_id, razorpay_order_id, key_id, amount_paise, currency, ... }
 *
 * The database makes our order (premium_begin_order: the price, plan and
 * validity come from the product, never from this request) and refuses
 * anything that should not be sold. Then Razorpay is asked for an order of
 * exactly that amount, and the two are tied together. The app opens Checkout
 * with razorpay_order_id; premium-verify and premium-webhook finish it.
 */
import { requireUserJwt } from "../_shared/requireAuth.ts";
import { premiumAdminClient } from "../_shared/premium.ts";
import { createOrder, razorpayKeys } from "../_shared/razorpay.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** What a student reads when the database refuses to sell. */
const REFUSALS: Record<string, string> = {
  sales_closed: "Plans are not on sale yet.",
  not_an_individual_account: "Plans are for individual exam accounts.",
  terms_not_accepted: "Please read and accept the current Terms and Refund Policy.",
  guardian_not_confirmed: "Please confirm you are 18 or older, or that your parent or guardian is paying.",
  unknown_product: "That plan is not available.",
  lower_plan_while_higher_active: "You already have a higher plan. You can buy this one after it ends.",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const auth = await requireUserJwt(req);
  if (!auth.ok) return auth.response;

  const keys = razorpayKeys();
  if (!keys) return json({ error: "Payments are not set up yet.", error_code: "payments_not_configured" }, 503);

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Request body must be JSON", error_code: "invalid_json" }, 400);
  }
  const product = typeof body.product_code === "string" ? body.product_code.trim() : "";
  const terms = typeof body.terms_version === "string" ? body.terms_version.trim() : "";
  if (!product) return json({ error: "product_code is required", error_code: "invalid_request" }, 400);

  const uid = auth.value.user.id;
  const admin = premiumAdminClient();

  const { data: begun, error: beginErr } = await admin.rpc("premium_begin_order", {
    _account: uid,
    _product: product,
    _terms_version: terms,
    _guardian_confirmed: body.guardian_confirmed === true,
  });
  if (beginErr || !begun) {
    console.error("premium_begin_order failed", beginErr?.message ?? beginErr);
    return json({ error: "Could not start the payment. Please try again.", error_code: "order_failed" }, 500);
  }
  const b = begun as {
    ok: boolean; reason?: string; order_id?: string; amount_paise?: number; currency?: string;
    tier?: string; validity_days?: number; display_name?: string;
  };
  if (!b.ok) {
    return json({ error: REFUSALS[b.reason ?? ""] ?? "This plan cannot be bought right now.", error_code: b.reason }, 409);
  }

  let rz;
  try {
    rz = await createOrder(keys, {
      amountPaise: b.amount_paise!,
      currency: b.currency!,
      receipt: b.order_id!,
      notes: { order_id: b.order_id!, account_id: uid, product },
    });
  } catch (e) {
    console.error("Razorpay order creation failed", e instanceof Error ? e.message : e);
    return json({ error: "Could not start the payment. Please try again.", error_code: "provider_error" }, 502);
  }
  // Razorpay must hold exactly what we will charge.
  if (rz.amount !== b.amount_paise || rz.currency !== b.currency) {
    console.error("Razorpay order does not match ours", { ours: b, theirs: rz });
    return json({ error: "Could not start the payment. Please try again.", error_code: "provider_mismatch" }, 502);
  }

  const { data: attached, error: attachErr } = await admin.rpc("premium_attach_provider_order", {
    _order_id: b.order_id,
    _razorpay_order_id: rz.id,
  });
  if (attachErr || attached !== true) {
    console.error("premium_attach_provider_order failed", attachErr?.message ?? attached);
    return json({ error: "Could not start the payment. Please try again.", error_code: "order_failed" }, 500);
  }

  return json({
    ok: true,
    order_id: b.order_id,
    razorpay_order_id: rz.id,
    key_id: keys.keyId,
    amount_paise: b.amount_paise,
    currency: b.currency,
    tier: b.tier,
    validity_days: b.validity_days,
    display_name: b.display_name,
  });
});
