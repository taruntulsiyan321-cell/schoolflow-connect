import { describe, expect, it } from "vitest";
import { extractAccessTokenMeta, classifyMsg91Failure, settingsFrom } from "./msg91Widget";

/** The token verifyMsg91Otp hands on, from a widget success payload. */
const extractToken = (data: Parameters<typeof extractAccessTokenMeta>[0]) =>
  extractAccessTokenMeta(data)?.token ?? null;

describe("the access-token in a widget success payload", () => {
  it("reads the token from data.message when that is the only field", () => {
    expect(extractToken({ message: "abc123" })).toBe("abc123");
  });

  it("reads data['access-token']", () => {
    expect(extractToken({ "access-token": "xyz789" })).toBe("xyz789");
  });

  it("reads data.token", () => {
    expect(extractToken({ token: "tok-1" })).toBe("tok-1");
  });

  it("reads data.accessToken", () => {
    expect(extractToken({ accessToken: "tok-2" })).toBe("tok-2");
  });

  it("prefers access-token over message when both are present (invisible OTP / SDK shape)", () => {
    // Real MSG91 invisible-OTP success: message is the reqId, access-token is the JWT.
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig";
    expect(
      extractToken({
        message: "336870744532313134323444",
        "access-token": jwt,
      }),
    ).toBe(jwt);
  });

  it("prefers a JWT-shaped message over a non-JWT sibling field", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig";
    expect(extractToken({ message: jwt, token: "req-id-not-jwt" })).toBe(jwt);
  });

  it("prefers access-token / token over a non-JWT message", () => {
    expect(extractToken({ message: "req-id-only", token: "tok-from-field" })).toBe(
      "tok-from-field",
    );
  });

  it("returns null for missing/empty/non-string values", () => {
    expect(extractToken(null)).toBeNull();
    expect(extractToken(undefined)).toBeNull();
    expect(extractToken({})).toBeNull();
    expect(extractToken({ message: "" })).toBeNull();
    expect(extractToken({ message: "   " })).toBeNull();
    expect(extractToken({ message: 12345 as unknown as string })).toBeNull();
  });

  it("trims whitespace around a valid token", () => {
    expect(extractToken({ message: "  padded-token  " })).toBe("padded-token");
  });
});

describe("extractAccessTokenMeta", () => {
  const jwt =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig";

  it("returns token plus keys / jwt_shaped / length fingerprint", () => {
    const meta = extractAccessTokenMeta({
      message: "336870744532313134323444",
      "access-token": jwt,
    });
    expect(meta).toEqual({
      token: jwt,
      keys: ["access-token", "message"],
      jwt_shaped: true,
      length: jwt.length,
    });
  });

  it("marks non-JWT tokens as jwt_shaped: false", () => {
    const meta = extractAccessTokenMeta({ token: "req-id-only" });
    expect(meta).toEqual({
      token: "req-id-only",
      keys: ["token"],
      jwt_shaped: false,
      length: "req-id-only".length,
    });
  });

  it("returns null when extractAccessToken would", () => {
    expect(extractAccessTokenMeta(null)).toBeNull();
    expect(extractAccessTokenMeta({})).toBeNull();
    expect(extractAccessTokenMeta({ message: "" })).toBeNull();
  });
});

describe("classifyMsg91Failure", () => {
  it("reads MSG91's own codes first: 703 and 705 are a wrong code, 704 the attempt limit", () => {
    expect(classifyMsg91Failure({ code: 703, message: "x" }).reason).toBe("wrong_code");
    // The live API's answer to a wrong code, measured 2026-10-02.
    expect(classifyMsg91Failure({ code: 705, message: "x", type: "error" }).reason).toBe("wrong_code");
    expect(classifyMsg91Failure({ code: 704, message: "x" }).reason).toBe("too_many");
  });

  it("reads the message when there is no code", () => {
    expect(classifyMsg91Failure({ message: "OTP not match" }).reason).toBe("wrong_code");
    expect(classifyMsg91Failure({ message: "OTP expired" }).reason).toBe("expired");
    expect(classifyMsg91Failure("Max limit reached for this otp verification").reason).toBe("too_many");
  });

  it("a bad number is not read as a wrong code, though both say 'incorrect'", () => {
    expect(classifyMsg91Failure({ message: "Mobile number is incorrect" }).reason).toBe("bad_number");
    expect(classifyMsg91Failure({ message: "OTP is incorrect" }).reason).toBe("wrong_code");
  });

  it("every reason comes with words a student can act on", () => {
    for (const e of [{ code: 703 }, { code: 704 }, { message: "expired" }, { message: "invalid mobile" }, { code: 500 }]) {
      const { message } = classifyMsg91Failure(e);
      expect(message.length).toBeGreaterThan(10);
      expect(message).not.toMatch(/\b70[34]\b|undefined|\[object/);
    }
  });

  it("a call the widget never answered says so", () => {
    expect(classifyMsg91Failure({ message: "no_response" }).reason).toBe("no_response");
    // CONTROL: the word alone inside another message is not the timeout.
    expect(classifyMsg91Failure({ message: "server sent no_response header" }).reason).not.toBe("no_response");
  });

  it("falls back to unknown for an unrecognised shape, without throwing", () => {
    expect(classifyMsg91Failure({ code: 500 }).reason).toBe("unknown");
    expect(() => classifyMsg91Failure(null)).not.toThrow();
    expect(() => classifyMsg91Failure(undefined)).not.toThrow();
  });
});

describe("settingsFrom — the widget's own settings", () => {
  const data = {
    otpLength: "4",
    retryTime: "30",
    retryCount: "2",
    processes: [
      { processVia: { value: "1" }, channel: { value: "11" } },
      { processVia: { value: "5" }, channel: { value: "11" } },
      { processVia: { value: "5" }, channel: { value: "4" } },
    ],
  };

  it("reads the code length, resend wait and limit, and the first resend channel", () => {
    expect(settingsFrom(data)).toEqual({ otpLength: 4, resendAfterSec: 30, resendsAllowed: 2, resendChannel: "11" });
  });

  it("offers no resend when the widget lists no resend process", () => {
    expect(settingsFrom({ ...data, processes: [data.processes[0]] })?.resendChannel).toBeNull();
  });

  it("is not ready until MSG91 has sent a usable code length", () => {
    expect(settingsFrom(undefined)).toBeNull();
    expect(settingsFrom({})).toBeNull();
    expect(settingsFrom({ ...data, otpLength: "abc" })).toBeNull();
  });

  it("falls back to MSG91's own defaults for a missing wait or limit", () => {
    const s = settingsFrom({ otpLength: 6 });
    expect(s).toEqual({ otpLength: 6, resendAfterSec: 25, resendsAllowed: 2, resendChannel: null });
  });
});
