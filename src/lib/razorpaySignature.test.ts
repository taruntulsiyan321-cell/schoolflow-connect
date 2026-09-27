/**
 * The signature checks a plan is granted on (supabase/functions/_shared/razorpaySignature.ts).
 *
 * Checked against Node's own HMAC — an implementation that shares no code
 * with the one under test — and against tampering: a signature for another
 * payment, another order, a changed body, a different secret, or nothing at
 * all must each be refused.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  hmacSha256Hex,
  isValidCheckoutSignature,
  isValidWebhookSignature,
  timingSafeEqual,
} from "../../supabase/functions/_shared/razorpaySignature.ts";

const SECRET = "test_key_secret_for_signature_checks";
const hmac = (secret: string, msg: string | Buffer) => createHmac("sha256", secret).update(msg).digest("hex");

describe("hmacSha256Hex", () => {
  it("agrees with an independent implementation", async () => {
    for (const msg of ["", "order_ABC|pay_XYZ", "ünïcödé ✓", "x".repeat(10_000)]) {
      expect(await hmacSha256Hex(SECRET, msg)).toBe(hmac(SECRET, msg));
    }
  });
});

describe("the Checkout signature", () => {
  const order = "order_IluGWxBm9U8zJ8";
  const payment = "pay_IH4NVgf4Dreq1l";
  const good = hmac(SECRET, `${order}|${payment}`);

  it("accepts the signature Razorpay makes: HMAC(order_id|payment_id)", async () => {
    expect(await isValidCheckoutSignature(SECRET, order, payment, good)).toBe(true);
    expect(await isValidCheckoutSignature(SECRET, order, payment, good.toUpperCase())).toBe(true);
  });

  it("refuses a signature for another payment, another order, or another secret", async () => {
    expect(await isValidCheckoutSignature(SECRET, order, "pay_other", good)).toBe(false);
    expect(await isValidCheckoutSignature(SECRET, "order_other", payment, good)).toBe(false);
    expect(await isValidCheckoutSignature("another_secret", order, payment, good)).toBe(false);
    // The pieces the other way round is a different message.
    expect(await isValidCheckoutSignature(SECRET, order, payment, hmac(SECRET, `${payment}|${order}`))).toBe(false);
  });

  it("refuses anything missing", async () => {
    expect(await isValidCheckoutSignature(SECRET, order, payment, "")).toBe(false);
    expect(await isValidCheckoutSignature("", order, payment, good)).toBe(false);
    expect(await isValidCheckoutSignature(SECRET, "", payment, good)).toBe(false);
  });
});

describe("the webhook signature", () => {
  const body = Buffer.from(JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_1", amount: 19900 } } } }));
  const good = hmac(SECRET, body);

  it("accepts HMAC of the raw body", async () => {
    expect(await isValidWebhookSignature(SECRET, new Uint8Array(body), good)).toBe(true);
  });

  it("refuses a body that changed by one byte, even one re-serialised to the same JSON", async () => {
    const changed = Buffer.from(body.toString().replace("19900", "19901"));
    expect(await isValidWebhookSignature(SECRET, new Uint8Array(changed), good)).toBe(false);
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(body.toString()), null, 1));
    expect(await isValidWebhookSignature(SECRET, new Uint8Array(reserialised), good)).toBe(false);
  });

  it("refuses a missing signature or secret", async () => {
    expect(await isValidWebhookSignature(SECRET, new Uint8Array(body), null)).toBe(false);
    expect(await isValidWebhookSignature("", new Uint8Array(body), good)).toBe(false);
  });
});

describe("timingSafeEqual", () => {
  it("is plain equality in its answers", () => {
    expect(timingSafeEqual("abc", "abc")).toBe(true);
    expect(timingSafeEqual("abc", "abd")).toBe(false);
    expect(timingSafeEqual("abc", "abcd")).toBe(false);
    expect(timingSafeEqual("", "")).toBe(true);
  });
});
