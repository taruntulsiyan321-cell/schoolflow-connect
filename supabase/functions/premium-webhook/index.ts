/**
 * premium-webhook — Razorpay's account of what happened to a payment.
 *
 * Called by Razorpay, not by a person, so it has no user JWT (verify_jwt =
 * false in supabase/config.toml). The signature IS the authentication:
 * X-Razorpay-Signature must be HMAC-SHA256 of the RAW body with the webhook
 * secret, compared before the body is parsed — a re-serialised body does not
 * verify. Anything without a valid signature is refused and never read.
 *
 * premium_handle_provider_event records x-razorpay-event-id and acts on the
 * event in one transaction: a duplicate delivery is recognised; a failure
 * answers 500 so Razorpay delivers it again, and nothing half-done is kept.
 *
 * Subscribe it (Razorpay Dashboard → Webhooks) to payment.captured,
 * order.paid, payment.failed, refund.processed and refund.failed.
 */
import { premiumAdminClient } from "../_shared/premium.ts";
import { isValidWebhookSignature, razorpayWebhookSecret } from "../_shared/razorpay.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const secret = razorpayWebhookSecret();
  // Not set up: 503, so Razorpay retries once it is.
  if (!secret) return json({ error: "webhook not configured" }, 503);

  const raw = new Uint8Array(await req.arrayBuffer());
  if (!(await isValidWebhookSignature(secret, raw, req.headers.get("x-razorpay-signature")))) {
    return json({ error: "invalid signature" }, 401);
  }

  const eventId = req.headers.get("x-razorpay-event-id")?.trim() ?? "";
  if (!eventId) return json({ error: "missing x-razorpay-event-id" }, 400);

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw)) as Record<string, unknown>;
  } catch {
    return json({ error: "body is not JSON" }, 400);
  }
  const eventType = typeof payload.event === "string" ? payload.event : "";
  if (!eventType) return json({ error: "missing event" }, 400);

  const { data, error } = await premiumAdminClient().rpc("premium_handle_provider_event", {
    _event_id: eventId,
    _event_type: eventType,
    _payload: payload,
  });
  if (error) {
    console.error("premium_handle_provider_event failed", eventType, eventId, error.message ?? error);
    return json({ error: "not processed" }, 500);
  }
  return json({ ok: true, outcome: data });
});
