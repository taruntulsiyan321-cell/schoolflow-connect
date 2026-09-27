/**
 * premium-verify — finish a payment the student just made (or made and then
 * closed the browser on).
 *
 *   POST { razorpay_order_id, razorpay_payment_id?, razorpay_signature? }
 *   → { status: "paid" | "pending" | "unpaid" | "refunded", tier?, ends_at? }
 *
 * A plan is never granted on the app's word. When Checkout's signature is
 * sent it is checked (HMAC of order_id|payment_id with the key secret), and
 * then the payment is read from Razorpay itself: it must belong to this
 * order, and be captured. premium_fulfil_payment checks the amount and grants
 * the plan once — the webhook may already have done it, which is fine.
 *
 * Without a payment id (the student came back later), the order's payments
 * are read from Razorpay and a captured one, if any, is fulfilled.
 */
import { requireUserJwt } from "../_shared/requireAuth.ts";
import { premiumAdminClient } from "../_shared/premium.ts";
import { fetchOrderPayments, fetchPayment, razorpayKeys, type RazorpayPayment } from "../_shared/razorpay.ts";
import { isValidCheckoutSignature } from "../_shared/razorpaySignature.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** What is kept of a payment in our record: no card or contact details. */
function summary(p: RazorpayPayment) {
  return { id: p.id, order_id: p.order_id, amount: p.amount, currency: p.currency, status: p.status, method: p.method ?? null };
}

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
  const rzOrder = typeof body.razorpay_order_id === "string" ? body.razorpay_order_id.trim() : "";
  const rzPayment = typeof body.razorpay_payment_id === "string" ? body.razorpay_payment_id.trim() : "";
  const signature = typeof body.razorpay_signature === "string" ? body.razorpay_signature.trim() : "";
  if (!rzOrder) return json({ error: "razorpay_order_id is required", error_code: "invalid_request" }, 400);

  const uid = auth.value.user.id;
  const admin = premiumAdminClient();

  // Only the buyer's own order.
  const { data: order, error: orderErr } = await admin
    .from("premium_orders")
    .select("id, status, account_id, entitlement_id")
    .eq("razorpay_order_id", rzOrder)
    .eq("account_id", uid)
    .maybeSingle();
  if (orderErr) return json({ error: "Could not check the payment. Please try again.", error_code: "lookup_failed" }, 500);
  if (!order) return json({ error: "No such order.", error_code: "unknown_order" }, 404);
  if (order.status !== "created") return json({ ok: true, status: order.status });

  if (rzPayment && !(await isValidCheckoutSignature(keys.keySecret, rzOrder, rzPayment, signature))) {
    await admin.rpc("premium_record_verify", {
      _razorpay_order_id: rzOrder,
      _razorpay_payment_id: rzPayment,
      _payload: { signature_valid: false },
      _outcome: { ok: false, reason: "bad_signature" },
    });
    return json({ error: "This payment could not be verified.", error_code: "bad_signature" }, 400);
  }

  // Razorpay's record is the truth.
  let payments: RazorpayPayment[];
  try {
    payments = rzPayment ? [await fetchPayment(keys, rzPayment)] : await fetchOrderPayments(keys, rzOrder);
  } catch (e) {
    console.error("Razorpay payment read failed", e instanceof Error ? e.message : e);
    return json({ error: "Could not check the payment. Please try again.", error_code: "provider_error" }, 502);
  }
  payments = payments.filter((p) => p.order_id === rzOrder);

  const captured = payments.find((p) => p.status === "captured");
  if (!captured) {
    const pending = payments.some((p) => p.status === "authorized");
    return json({ ok: false, status: pending ? "pending" : "unpaid" });
  }

  const { data: outcome, error: fulfilErr } = await admin.rpc("premium_fulfil_payment", {
    _razorpay_order_id: rzOrder,
    _razorpay_payment_id: captured.id,
    _amount_paise: captured.amount,
    _currency: captured.currency,
    _status: captured.status,
    _method: captured.method ?? null,
  });
  await admin.rpc("premium_record_verify", {
    _razorpay_order_id: rzOrder,
    _razorpay_payment_id: captured.id,
    _payload: summary(captured),
    _outcome: outcome ?? { ok: false, reason: fulfilErr?.message ?? "fulfil_failed" },
  });
  if (fulfilErr || !outcome) {
    console.error("premium_fulfil_payment failed", fulfilErr?.message ?? fulfilErr);
    return json({ error: "Your payment was received. We are confirming it — please check again in a minute.", error_code: "fulfil_failed" }, 500);
  }
  const o = outcome as { ok: boolean; reason?: string; tier?: string; starts_at?: string; ends_at?: string };
  if (!o.ok) {
    // Received but not grantable (for example a second payment for a paid
    // order): recorded for the owner to refund.
    return json({ ok: false, status: "needs_review", error_code: o.reason,
      error: "Your payment was received but needs a check by our team. You will not be charged twice — contact support if it is not resolved." }, 409);
  }
  return json({ ok: true, status: "paid", tier: o.tier, starts_at: o.starts_at, ends_at: o.ends_at });
});
