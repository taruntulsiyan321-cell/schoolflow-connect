import { describe, expect, it } from "vitest";
import { validateEmail } from "./emailValidation";

/**
 * Signing in asks Supabase whether an account exists; this only catches what is
 * not an address at all, and the typos of popular providers. It used to refuse
 * any domain extension missing from a curated list — which locked out every
 * Riverside Public School login (`…@rps.e2e.test`) before Supabase was asked.
 */
describe("validateEmail, for signing in", () => {
  it("accepts an existing account on any real-shaped domain, the E2E school's included", () => {
    for (const address of [
      "teacher01@rps.e2e.test",
      "student.8a.01@rps.e2e.test",
      "principal@dps.school",
      "office@riverside.education",
      "head@college.edu.au",
    ]) {
      expect(validateEmail(address), address).toEqual({ ok: true, email: address, message: "" });
    }
  });

  it("trims and lower-cases what it accepts", () => {
    expect(validateEmail("  Principal@RPS.E2E.Test ").email).toBe("principal@rps.e2e.test");
  });

  it("still catches a popular provider's typo, and says what was meant", () => {
    expect(validateEmail("asha@gmail.con")).toEqual({ ok: false, email: "", message: "Did you mean asha@gmail.com?" });
    expect(validateEmail("asha@gmial.com").message).toBe("Did you mean asha@gmail.com?");
  });

  it("refuses what is not an address", () => {
    for (const bad of ["", "asha", "asha@", "@school.in", "asha@school", "asha..b@school.in", "asha@school.c"]) {
      expect(validateEmail(bad).ok, JSON.stringify(bad)).toBe(false);
    }
  });
});
