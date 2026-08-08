import { describe, expect, it } from "vitest";
import { normalizePhone, toE164Display, samePhone } from "./phone";

describe("normalizePhone", () => {
  it("prefixes a bare 10-digit Indian mobile number with the default country code", () => {
    expect(normalizePhone("9876543210")).toBe("919876543210");
  });

  it("leaves an already country-code-prefixed number as digits-only", () => {
    expect(normalizePhone("+91 98765 43210")).toBe("919876543210");
    expect(normalizePhone("919876543210")).toBe("919876543210");
  });

  it("is stable across every format MSG91/admin entry could produce for the same number", () => {
    const forms = ["9876543210", "+919876543210", "91-9876-543-210", "(91) 98765 43210", "919876543210"];
    const normalized = forms.map(normalizePhone);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe("919876543210");
  });

  it("returns null for garbage/too-short input", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it("returns null for implausibly long input", () => {
    expect(normalizePhone("1234567890123456")).toBeNull();
  });
});

describe("toE164Display", () => {
  it("adds a leading + to the canonical form", () => {
    expect(toE164Display("9876543210")).toBe("+919876543210");
  });

  it("returns null for invalid input", () => {
    expect(toE164Display("bad")).toBeNull();
  });
});

describe("samePhone", () => {
  it("recognizes the same number regardless of formatting, including bare-vs-country-code-prefixed", () => {
    expect(samePhone("9876543210", "+91 98765 43210")).toBe(true);
    expect(samePhone("919876543210", "9876543210")).toBe(true);
  });

  it("returns false for genuinely different numbers", () => {
    expect(samePhone("9876543210", "9876543211")).toBe(false);
  });

  it("returns false when either side is unparseable", () => {
    expect(samePhone("", "9876543210")).toBe(false);
    expect(samePhone("9876543210", "")).toBe(false);
  });
});
