/**
 * Razorpay, as the premium edge functions use it (docs read 2026-09-27).
 *
 *   Checkout signature  HMAC-SHA256(order_id + "|" + payment_id), key secret
 *   Webhook signature   HMAC-SHA256(RAW request body), webhook secret,
 *                       sent as X-Razorpay-Signature
 *   Duplicate webhooks  expected; told apart by x-razorpay-event-id
 *   Delivery            only after capture — uncaptured payments are refunded
 *
 * Secrets come from the function's environment and nowhere else:
 * RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET. Missing ones
 * make the functions refuse ("payments are not set up"), never guess.
 *
 * The signature helpers are pure (Web Crypto only) so they are tested directly
 * (razorpay.test.ts), against an independent HMAC implementation.
 */

const API = "https://api.razorpay.com/v1";

export type RazorpayKeys = { keyId: string; keySecret: string };

/** The key pair, or null when payments are not set up. */
export function razorpayKeys(): RazorpayKeys | null {
  const keyId = Deno.env.get("RAZORPAY_KEY_ID")?.trim() ?? "";
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET")?.trim() ?? "";
  return keyId && keySecret ? { keyId, keySecret } : null;
}

export function razorpayWebhookSecret(): string | null {
  const s = Deno.env.get("RAZORPAY_WEBHOOK_SECRET")?.trim() ?? "";
  return s || null;
}

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

function authHeader(keys: RazorpayKeys): string {
  return "Basic " + btoa(`${keys.keyId}:${keys.keySecret}`);
}

export type RazorpayOrder = { id: string; amount: number; currency: string; status: string; receipt?: string };
export type RazorpayPayment = {
  id: string;
  order_id: string | null;
  amount: number;
  currency: string;
  status: "created" | "authorized" | "captured" | "refunded" | "failed";
  captured: boolean;
  method?: string;
};

export class RazorpayError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(keys: RazorpayKeys, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: authHeader(keys), "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const desc = (body as { error?: { description?: string } } | null)?.error?.description ?? text.slice(0, 200);
    throw new RazorpayError(`Razorpay ${res.status}: ${desc}`, res.status);
  }
  return body as T;
}

/** A Razorpay order for exactly this amount, carrying our order id. */
export function createOrder(
  keys: RazorpayKeys,
  input: { amountPaise: number; currency: string; receipt: string; notes: Record<string, string> },
): Promise<RazorpayOrder> {
  return call<RazorpayOrder>(keys, "/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: input.amountPaise,
      currency: input.currency,
      receipt: input.receipt.slice(0, 40),
      notes: input.notes,
    }),
  });
}

/** The payment as Razorpay holds it — the truth a plan is granted from. */
export function fetchPayment(keys: RazorpayKeys, paymentId: string): Promise<RazorpayPayment> {
  return call<RazorpayPayment>(keys, `/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
}

/** Every payment attempt made against an order. */
export async function fetchOrderPayments(keys: RazorpayKeys, orderId: string): Promise<RazorpayPayment[]> {
  const r = await call<{ items?: RazorpayPayment[] }>(keys, `/orders/${encodeURIComponent(orderId)}/payments`, {
    method: "GET",
  });
  return Array.isArray(r?.items) ? r.items : [];
}
