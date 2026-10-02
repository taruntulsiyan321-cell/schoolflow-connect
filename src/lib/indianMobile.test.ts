import { describe, expect, it } from "vitest";
import { displayIndianMobile, parseIndianMobile } from "./indianMobile";

describe("parseIndianMobile", () => {
  it("reduces every way a student writes the same number to ten digits", () => {
    for (const raw of ["9876543210", "98765 43210", "+91 98765 43210", "+919876543210", "91-98765-43210", "098765 43210"]) {
      expect(parseIndianMobile(raw), raw).toBe("9876543210");
    }
  });

  it("refuses what is not an Indian mobile number", () => {
    for (const raw of ["", "12345", "98765432", "1234567890", "5876543210", "98765432101", "abcdefghij", "+1 415 555 0100"]) {
      expect(parseIndianMobile(raw), raw).toBeNull();
    }
  });
});

describe("displayIndianMobile", () => {
  it("shows the number back in the familiar grouping", () => {
    expect(displayIndianMobile("9876543210")).toBe("+91 98765 43210");
  });
});
