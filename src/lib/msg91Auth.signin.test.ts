/**
 * Finishing a phone sign-in.
 *
 * Two things this must get exactly right, and both were wrong or missing
 * before 2026-09-23:
 *
 * 1. The redeem body. GoTrue refuses a /auth/v1/verify carrying the email
 *    beside the token_hash — measured live: 400 validation_failed, "Only the
 *    token_hash and type should be provided", against 200 and a session for
 *    the hash alone. Sending the address broke every mobile sign-in.
 * 2. The exam. An individual student's account is identified by phone AND
 *    exam, so the chosen exam has to reach the edge function with the
 *    verification; a school sign-in must send no exam at all.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const invokeEdgeFunction = vi.fn();
const verifyOtp = vi.fn();

vi.mock("@/lib/edgeFunction", () => ({
  invokeEdgeFunction: (...args: unknown[]) => invokeEdgeFunction(...args),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { verifyOtp: (...args: unknown[]) => verifyOtp(...args) } },
}));

import { completeMsg91SignIn } from "./msg91Auth";

const OK = {
  data: {
    success: true,
    email: "919876543210.cuet@exam.vidyalaya.local",
    token_hash: "hash-123",
    type: "email",
    is_new_user: true,
    verified_phone_masked: "+91••••3210",
  },
  error: null,
};

beforeEach(() => {
  invokeEdgeFunction.mockReset();
  verifyOtp.mockReset();
  invokeEdgeFunction.mockResolvedValue(OK);
  verifyOtp.mockResolvedValue({ error: null });
});

describe("completeMsg91SignIn", () => {
  it("redeems the token_hash without the email beside it", async () => {
    const res = await completeMsg91SignIn("access-token", "cuet");

    expect(res.ok).toBe(true);
    expect(verifyOtp).toHaveBeenCalledTimes(1);
    const body = verifyOtp.mock.calls[0][0];
    expect(body).toEqual({ token_hash: "hash-123", type: "email" });
    expect("email" in body).toBe(false);
  });

  it("sends the chosen exam with the verification", async () => {
    await completeMsg91SignIn("access-token", "cuet");
    expect(invokeEdgeFunction).toHaveBeenCalledWith("verify-msg91-widget", {
      access_token: "access-token",
      exam: "cuet",
    });
  });

  it("sends no exam for a school sign-in", async () => {
    await completeMsg91SignIn("access-token");
    const payload = invokeEdgeFunction.mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toEqual({ access_token: "access-token" });
    expect("exam" in payload).toBe(false);
  });

  it("reports the verification failure rather than a session", async () => {
    invokeEdgeFunction.mockResolvedValue({ data: null, error: "That exam is not one we offer." });
    const res = await completeMsg91SignIn("access-token", "nope");
    expect(res).toEqual({ ok: false, error: "That exam is not one we offer." });
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
