import { describe, expect, it } from "vitest";
import { parseLoginIdentifier, portalFieldsFromIdentifier } from "./loginIdentifier";

describe("parseLoginIdentifier", () => {
  it("parses an email identifier", () => {
    expect(parseLoginIdentifier("Teacher@School.EDU")).toEqual({ kind: "email", value: "teacher@school.edu" });
  });

  it("rejects a malformed email", () => {
    expect(parseLoginIdentifier("not-an-email@")).toBeNull();
  });

  // Regression test: previously a bare digit-strip with no country-code
  // normalization, so an admin typing a plain 10-digit Indian mobile number
  // here produced a portal_phone value that could never match the
  // country-code-prefixed number link_portal_on_auth compares it against
  // once the student/parent verifies via the MSG91 widget.
  it("normalizes a bare 10-digit mobile number to the canonical country-code-prefixed form", () => {
    expect(parseLoginIdentifier("9876543210")).toEqual({ kind: "phone", value: "919876543210" });
  });

  it("normalizes an already-prefixed mobile number to the same canonical form", () => {
    expect(parseLoginIdentifier("+91 98765 43210")).toEqual({ kind: "phone", value: "919876543210" });
  });

  it("rejects an implausibly short phone number", () => {
    expect(parseLoginIdentifier("12345")).toBeNull();
  });

  it("rejects empty input", () => {
    expect(parseLoginIdentifier("")).toBeNull();
    expect(parseLoginIdentifier("   ")).toBeNull();
  });
});

describe("portalFieldsFromIdentifier", () => {
  it("sets portal_phone (canonical) and nulls portal_email for a phone identifier", () => {
    expect(portalFieldsFromIdentifier("9876543210")).toEqual({
      portal_email: null,
      portal_phone: "919876543210",
    });
  });

  it("sets portal_email and nulls portal_phone for an email identifier", () => {
    expect(portalFieldsFromIdentifier("parent@school.edu")).toEqual({
      portal_email: "parent@school.edu",
      portal_phone: null,
    });
  });

  it("returns an empty object for unparseable input", () => {
    expect(portalFieldsFromIdentifier("not valid")).toEqual({});
  });
});
