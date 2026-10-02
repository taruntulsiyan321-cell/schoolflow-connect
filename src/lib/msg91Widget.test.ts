import { describe, expect, it } from "vitest";
import { extractAccessToken, extractAccessTokenMeta, classifyMsg91Failure } from "./msg91Widget";

describe("extractAccessToken", () => {
  it("reads the token from data.message when that is the only field", () => {
    expect(extractAccessToken({ message: "abc123" })).toBe("abc123");
  });

  it("reads data['access-token']", () => {
    expect(extractAccessToken({ "access-token": "xyz789" })).toBe("xyz789");
  });

  it("reads data.token", () => {
    expect(extractAccessToken({ token: "tok-1" })).toBe("tok-1");
  });

  it("reads data.accessToken", () => {
    expect(extractAccessToken({ accessToken: "tok-2" })).toBe("tok-2");
  });

  it("prefers access-token over message when both are present (invisible OTP / SDK shape)", () => {
    // Real MSG91 invisible-OTP success: message is the reqId, access-token is the JWT.
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig";
    expect(
      extractAccessToken({
        message: "336870744532313134323444",
        "access-token": jwt,
      }),
    ).toBe(jwt);
  });

  it("prefers a JWT-shaped message over a non-JWT sibling field", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.sig";
    expect(extractAccessToken({ message: jwt, token: "req-id-not-jwt" })).toBe(jwt);
  });

  it("prefers access-token / token over a non-JWT message", () => {
    expect(extractAccessToken({ message: "req-id-only", token: "tok-from-field" })).toBe(
      "tok-from-field",
    );
  });

  it("returns null for missing/empty/non-string values", () => {
    expect(extractAccessToken(null)).toBeNull();
    expect(extractAccessToken(undefined)).toBeNull();
    expect(extractAccessToken({})).toBeNull();
    expect(extractAccessToken({ message: "" })).toBeNull();
    expect(extractAccessToken({ message: "   " })).toBeNull();
    expect(extractAccessToken({ message: 12345 as unknown as string })).toBeNull();
  });

  it("trims whitespace around a valid token", () => {
    expect(extractAccessToken({ message: "  padded-token  " })).toBe("padded-token");
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
  it("classifies a cancellation from a string reason", () => {
    expect(classifyMsg91Failure("User cancelled the widget").reason).toBe("cancelled");
  });

  it("classifies a cancellation from an error object message", () => {
    expect(classifyMsg91Failure({ message: "Widget closed by user" }).reason).toBe("cancelled");
  });

  it("classifies a timeout", () => {
    expect(classifyMsg91Failure({ message: "OTP request timeout" }).reason).toBe("timeout");
    expect(classifyMsg91Failure("session expired").reason).toBe("timeout");
  });

  it("falls back to unknown for an unrecognised shape, without throwing", () => {
    const result = classifyMsg91Failure({ code: 500 });
    expect(result.reason).toBe("unknown");
    expect(result.message).toBeTruthy();
  });

  it("never throws on null/undefined input", () => {
    expect(() => classifyMsg91Failure(null)).not.toThrow();
    expect(() => classifyMsg91Failure(undefined)).not.toThrow();
  });
});
