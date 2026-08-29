import { describe, expect, it } from "vitest";
import {
  describeDisplayText,
  isIdentifierLike,
  toDisplayText,
  NOT_AVAILABLE,
} from "./safeText";
import { toEnumLabel, humanizeEnumValue, isKnownEnumValue, enumOptions } from "./enums";
import { toPersonName, toPersonNameFrom, toInitials, toClassLabel } from "./people";
import { toUserMessage, toErrorMessage, looksLikeDatabaseNoise } from "./errors";

const UUID = "3f2a9c11-4b8e-4c1a-9f0d-2b7e5a1c8d33";

describe("toDisplayText — the presentation boundary", () => {
  it("passes ordinary text through unchanged", () => {
    expect(toDisplayText("Quadratic Equations")).toBe("Quadratic Equations");
    expect(toDisplayText("अध्याय 3")).toBe("अध्याय 3");
    expect(toDisplayText("π r² is the area")).toBe("π r² is the area");
  });

  it("never renders nullish values as text", () => {
    expect(toDisplayText(null)).toBe(NOT_AVAILABLE);
    expect(toDisplayText(undefined)).toBe(NOT_AVAILABLE);
  });

  it("rejects the literal strings that mean a bug happened upstream", () => {
    for (const leaked of ["undefined", "null", "NaN", "[object Object]", "Infinity"]) {
      const result = describeDisplayText(leaked);
      expect(result.usedFallback, `${leaked} must be rejected`).toBe(true);
      expect(result.reason).toBe("leaked-internal-token");
    }
  });

  it("never stringifies an object, array or function into a text node", () => {
    expect(describeDisplayText({ id: 1 }).reason).toBe("not-a-primitive");
    expect(describeDisplayText([1, 2, 3]).reason).toBe("not-a-primitive");
    expect(describeDisplayText(() => "x").reason).toBe("not-a-primitive");
    expect(describeDisplayText(Promise.resolve(1)).reason).toBe("not-a-primitive");
    expect(toDisplayText({ a: 1 })).toBe(NOT_AVAILABLE);
  });

  it("rejects serialized payloads that reached a text node", () => {
    expect(describeDisplayText('{"answer":"42"}').reason).toBe("json-shaped");
    expect(describeDisplayText("[{\"id\":1}]").reason).toBe("json-shaped");
  });

  it("rejects raw identifiers", () => {
    expect(describeDisplayText(UUID).reason).toBe("uuid");
    // A truncated id is only a name-level violation; other text may be hex.
    expect(describeDisplayText("3f2a9c11", { kind: "name" }).reason).toBe("uuid");
    expect(describeDisplayText("3f2a9c11", { kind: "text" }).usedFallback).toBe(false);
  });

  it("repairs recoverable mojibake instead of hiding it", () => {
    // UTF-8 "π" decoded as CP1252.
    expect(toDisplayText("Ï€ r^2")).toBe("π r^2");
    // Devanagari through the same corruption.
    expect(toDisplayText("à¤†à¤²à¥‹")).toBe("आलो");
  });

  it("refuses to display corruption it cannot repair", () => {
    const result = describeDisplayText("Chapter �� broken");
    expect(result.usedFallback).toBe(true);
    expect(result.reason).toBe("unrepairable-encoding");
    expect(result.text).toBe(NOT_AVAILABLE);
  });

  it("rejects stray control characters", () => {
    expect(describeDisplayText("bad\u0007value").reason).toBe("control-characters");
  });

  it("handles non-string primitives sensibly", () => {
    expect(toDisplayText(0)).toBe("0");
    expect(toDisplayText(12.5)).toBe("12.5");
    expect(describeDisplayText(Number.NaN).reason).toBe("non-finite-number");
    expect(describeDisplayText(Infinity).reason).toBe("non-finite-number");
    expect(toDisplayText(true)).toBe("Yes");
    expect(toDisplayText(false)).toBe("No");
  });

  it("supports an explicit empty state instead of a fallback", () => {
    expect(toDisplayText("", { allowEmpty: true })).toBe("");
    expect(toDisplayText("   ", { allowEmpty: true })).toBe("");
    expect(toDisplayText("")).toBe(NOT_AVAILABLE);
  });

  it("truncates on a word boundary", () => {
    const long = "Understanding the behaviour of quadratic equations in real problems";
    const out = toDisplayText(long, { maxLength: 30 });
    expect(out.length).toBeLessThanOrEqual(31);
    expect(out.endsWith("…")).toBe(true);
    expect(out).not.toContain("  ");
  });

  it("identifies identifier-shaped values", () => {
    expect(isIdentifierLike(UUID)).toBe(true);
    expect(isIdentifierLike("3f2a9c11")).toBe(true);
    expect(isIdentifierLike("Priya Sharma")).toBe(false);
    expect(isIdentifierLike(42)).toBe(false);
  });
});

describe("toEnumLabel — internal tokens never reach the user", () => {
  it("maps registered values to curated labels", () => {
    expect(toEnumLabel("half_day", "attendance_status")).toBe("Half day");
    expect(toEnumLabel("in_progress", "case_status")).toBe("In progress");
    expect(toEnumLabel("surprise_test", "exam_type")).toBe("Surprise test");
    expect(toEnumLabel("beat_topper", "featured_kind")).toBe("Beat the Topper");
    expect(toEnumLabel("partial", "fee_status")).toBe("Partly paid");
  });

  it("is case and whitespace tolerant", () => {
    expect(toEnumLabel(" HALF_DAY ", "attendance_status")).toBe("Half day");
  });

  it("humanizes unregistered values rather than leaking the token", () => {
    expect(toEnumLabel("brand_new_state", "attendance_status")).toBe("Brand new state");
    expect(toEnumLabel("weird", "case_status")).toBe("Weird");
  });

  it("never returns a raw snake_case token for any registered domain", () => {
    const domains = [
      "attendance_status",
      "case_status",
      "exam_type",
      "test_attempt_status",
      "battle_status",
    ] as const;
    for (const domain of domains) {
      for (const { value, label } of enumOptions(domain)) {
        expect(label, `${domain}.${value}`).not.toMatch(/_/);
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });

  it("preserves acronyms", () => {
    expect(humanizeEnumValue("mcq_question")).toBe("MCQ question");
    expect(toEnumLabel("pdf", "resource_type")).toBe("PDF");
  });

  it("falls back for unusable values", () => {
    expect(toEnumLabel(null, "attendance_status")).toBe("—");
    expect(toEnumLabel({}, "attendance_status")).toBe("—");
    expect(toEnumLabel("", "attendance_status")).toBe("—");
  });

  it("reports membership accurately", () => {
    expect(isKnownEnumValue("half_day", "attendance_status")).toBe(true);
    expect(isKnownEnumValue("nope", "attendance_status")).toBe(false);
  });
});

describe("toPersonName — a missing name is never an id", () => {
  it("returns real names unchanged", () => {
    expect(toPersonName("Priya Sharma", { kind: "student" })).toBe("Priya Sharma");
  });

  it("never returns a UUID or a UUID fragment", () => {
    expect(toPersonName(UUID, { kind: "student" })).toBe("Unnamed student");
    expect(toPersonName("3f2a9c11", { kind: "student" })).toBe("Unnamed student");
    expect(toPersonName(UUID.slice(0, 8), { kind: "teacher" })).toBe("Unnamed teacher");
  });

  it("uses kind-appropriate fallbacks", () => {
    expect(toPersonName(null, { kind: "parent" })).toBe("Unnamed parent");
    expect(toPersonName(null)).toBe("Unnamed");
    expect(toPersonName(null, { fallback: "Removed" })).toBe("Removed");
  });

  it("picks the first usable candidate and skips ids", () => {
    expect(toPersonNameFrom([null, UUID, "Arjun Mehta"], { kind: "student" })).toBe(
      "Arjun Mehta",
    );
    expect(toPersonNameFrom([undefined, ""], { kind: "student" })).toBe("Unnamed student");
  });

  it("derives initials only from real names", () => {
    expect(toInitials("Priya Sharma")).toBe("PS");
    expect(toInitials(UUID)).toBe("");
    expect(toInitials(null)).toBe("");
  });

  it("builds class labels without leaking ids", () => {
    expect(toClassLabel("10", "A")).toBe("10-A");
    expect(toClassLabel("10", null)).toBe("10");
    expect(toClassLabel(null, "A")).toBe("Unassigned");
  });
});

describe("toUserMessage — database text never reaches the user", () => {
  it("blocks raw row-level-security messages", () => {
    const err = Object.assign(
      new Error('new row violates row-level security policy for table "leave_requests"'),
      { code: "42501" },
    );
    const msg = toUserMessage(err);
    expect(msg).not.toContain("leave_requests");
    expect(msg).not.toContain("row-level security");
    expect(msg).toBe(
      "You don't have permission for this action. Contact your school admin.",
    );
  });

  it("blocks constraint names", () => {
    const err = Object.assign(
      new Error(
        'duplicate key value violates unique constraint "students_school_admission_uidx"',
      ),
      { code: "23505" },
    );
    const msg = toUserMessage(err);
    expect(msg).not.toContain("students_school_admission_uidx");
    expect(msg).toBe("That record already exists.");
  });

  it("blocks schema-cache / missing function detail", () => {
    const err = Object.assign(
      new Error(
        "Could not find the function public.rpc_weak_areas_v2(p_user) in the schema cache",
      ),
      { code: "PGRST202" },
    );
    const msg = toUserMessage(err);
    expect(msg).not.toContain("rpc_weak_areas_v2");
    expect(msg).not.toContain("schema cache");
    expect(msg).toBe("This feature isn't available right now.");
  });

  it("passes through application-authored PL/pgSQL messages", () => {
    const err = Object.assign(
      new Error("Join a class to play the Daily Challenge"),
      { code: "P0001" },
    );
    expect(toUserMessage(err)).toBe("Join a class to play the Daily Challenge");
  });

  it("redacts identifiers interpolated into authored messages", () => {
    const err = Object.assign(
      new Error(`Attendance is locked for class ${UUID} on 2026-08-20 — unlock it first`),
      { code: "P0001" },
    );
    const msg = toUserMessage(err);
    expect(msg).not.toContain(UUID);
    expect(msg).toContain("Attendance is locked");
  });

  it("collapses unmapped database codes to the generic message", () => {
    const err = Object.assign(new Error("something internal happened"), {
      code: "XX000",
    });
    expect(toUserMessage(err)).toBe("Something went wrong. Please try again.");
  });

  it("maps HTTP statuses from edge functions", () => {
    expect(toUserMessage({ status: 403 })).toContain("permission");
    expect(toUserMessage({ status: 429 })).toContain("Too many attempts");
    expect(toUserMessage({ status: 503 })).toContain("temporarily unavailable");
  });

  it("recognises network failures", () => {
    expect(toUserMessage(new TypeError("Failed to fetch"))).toBe(
      "Network error. Check your connection and try again.",
    );
  });

  it("never leaks a stack frame", () => {
    const err = new Error("boom\n    at loadThing (/src/x.ts:10:3)");
    expect(toUserMessage(err)).not.toContain("at loadThing");
  });

  it("keeps plain authored copy from app code", () => {
    expect(toUserMessage("No students are marked yet.")).toBe(
      "No students are marked yet.",
    );
  });

  it("honours a caller fallback", () => {
    expect(toErrorMessage(new Error("relation \"x\" does not exist"), "Couldn't load")).toBe(
      "Couldn't load",
    );
  });

  it("detects database noise directly", () => {
    expect(looksLikeDatabaseNoise("violates check constraint \"c\"")).toBe(true);
    expect(looksLikeDatabaseNoise("Join a class first")).toBe(false);
  });

  it("handles nullish and exotic throws", () => {
    expect(toUserMessage(null)).toBe("Something went wrong. Please try again.");
    expect(toUserMessage(undefined)).toBe("Something went wrong. Please try again.");
    expect(toUserMessage(123)).toBe("Something went wrong. Please try again.");
  });
});
