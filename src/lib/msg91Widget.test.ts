import { describe, expect, it } from "vitest";
import { extractAccessToken, classifyMsg91Failure } from "./msg91Widget";
import { phoneToSyntheticEmail } from "./msg91Auth";

describe("extractAccessToken", () => {
  it("reads the token from data.message (the documented common case)", () => {
    expect(extractAccessToken({ message: "abc123" })).toBe("abc123");
  });

  it("falls back to data['access-token']", () => {
    expect(extractAccessToken({ "access-token": "xyz789" })).toBe("xyz789");
  });

  it("falls back to data.token", () => {
    expect(extractAccessToken({ token: "tok-1" })).toBe("tok-1");
  });

  it("falls back to data.accessToken", () => {
    expect(extractAccessToken({ accessToken: "tok-2" })).toBe("tok-2");
  });

  it("prefers message over the other candidates when several are present", () => {
    expect(extractAccessToken({ message: "first", token: "second" })).toBe("first");
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

describe("phoneToSyntheticEmail", () => {
  it("strips non-digits and builds the deterministic phone-derived email", () => {
    expect(phoneToSyntheticEmail("+91 98765 43210")).toBe("919876543210@phone.vidyalaya.local");
  });

  it("is stable across differently-formatted input for the same number", () => {
    const a = phoneToSyntheticEmail("+919876543210");
    const b = phoneToSyntheticEmail("91-9876-543-210");
    const c = phoneToSyntheticEmail("(91) 98765 43210");
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});
