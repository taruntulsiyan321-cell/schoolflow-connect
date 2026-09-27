/**
 * Razorpay's two signatures (docs read 2026-09-27), and nothing else:
 *
 *   Checkout  HMAC-SHA256(order_id + "|" + payment_id), key secret
 *   Webhook   HMAC-SHA256(RAW request body), webhook secret,
 *             sent as X-Razorpay-Signature
 *
 * Pure Web Crypto — no Deno globals — so the app's test suite checks it
 * directly (src/lib/razorpaySignature.test.ts) against an independent HMAC.
 * The environment and the Razorpay API live in razorpay.ts.
 */

const encoder = new TextEncoder();

export async function hmacSha256Hex(secret: string, message: string | Uint8Array): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  // A copy, so Web Crypto is handed a buffer it owns (and TypeScript agrees).
  const data = typeof message === "string" ? encoder.encode(message) : Uint8Array.from(message);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Compares in time that does not depend on where the strings differ. */
export function timingSafeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/** Checkout's razorpay_signature for this order and payment. */
export async function isValidCheckoutSignature(
  keySecret: string,
  razorpayOrderId: string,
  razorpayPaymentId: string,
  signature: string,
): Promise<boolean> {
  if (!keySecret || !razorpayOrderId || !razorpayPaymentId || !signature) return false;
  const expected = await hmacSha256Hex(keySecret, `${razorpayOrderId}|${razorpayPaymentId}`);
  return timingSafeEqual(expected, signature.trim().toLowerCase());
}

/** X-Razorpay-Signature over the raw body, exactly as received. */
export async function isValidWebhookSignature(
  webhookSecret: string,
  rawBody: Uint8Array,
  signature: string | null,
): Promise<boolean> {
  if (!webhookSecret || !signature) return false;
  const expected = await hmacSha256Hex(webhookSecret, rawBody);
  return timingSafeEqual(expected, signature.trim().toLowerCase());
}
