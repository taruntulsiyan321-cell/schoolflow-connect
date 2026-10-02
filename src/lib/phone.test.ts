/**
 * Phone normalisation, tested where it runs: the edge copy that
 * verify-msg91-widget uses for every individual sign-in. The client copy
 * (src/lib/phone.ts) lost its last caller with the organisation sign-in paths
 * and was deleted (2026-10-01); the SQL public.normalize_phone() is the other
 * mirror.
 */
import { describe, expect, it } from "vitest";
import { normalizePhone } from "../../supabase/functions/_shared/phone";

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
