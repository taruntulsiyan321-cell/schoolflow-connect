/**
 * The parent weekly digest payload contract.
 *
 * Two properties are pinned here that nothing else pins, because both are
 * properties of the SHAPE rather than of any screen — and this hook has no
 * caller, so a screen test could not catch either:
 *
 *   1. `attendance.pct` is `number | null`, and a week in which nothing was
 *      marked yields null rather than 0. Ruled correct. `null < 60` is TRUE in
 *      JavaScript, so a 0 here bands a child nobody took a register for as the
 *      WORST rung instead of as unknown.
 *
 *   2. The child payload carries rule 17's five items and NOTHING ELSE — in
 *      particular no `exam_marks`, which was removed in 20260904210000 because
 *      exam marks live in the exam report, and no `alerts`, removed in
 *      20260904190000 along with the feature.
 *
 * ── WHY THE SHAPE ASSERTIONS ARE TYPE-LEVEL ──────────────────────────────
 *
 * The RPC returns `jsonb`, so at runtime this type is an assertion, not a
 * parse — a runtime key check would only ever be inspecting a fixture this
 * file wrote itself, which proves nothing about the type. `Exact<>` below
 * fails `npm run typecheck` (a gate) the moment a key is added or removed, or
 * `pct` stops being nullable. That is the check with teeth.
 *
 * The database half of the same contract is asserted for real, against the
 * real function, in probe6 ("210000 pct is NULL when nothing was marked", with
 * its positive control). Neither half is sufficient alone: the type could be
 * right while the SQL regressed, or the reverse.
 */
import { describe, it, expect } from "vitest";
import { attendanceBand, bandOf } from "@/academic/metrics/bands";
import type {
  ParentDigestAttendance,
  ParentDigestChild,
  ParentDigestHomework,
} from "./useParentWeeklyDigest";

/** True only if A and B are mutually assignable — i.e. exactly the same type. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// ── 1. Nullability, pinned at compile time ────────────────────────────────
// If someone "tidies" `pct` to `number` with a `?? 0`, this stops compiling.
const attendancePctIsNullable: Exact<ParentDigestAttendance["pct"], number | null> = true;
const homeworkPctIsNullable: Exact<ParentDigestHomework["pct"], number | null> = true;

// ── 2. The payload is exactly rule 17's five items ────────────────────────
// Adding `exam_marks` back, or reviving `alerts`, or dropping `remarks`, all
// break this line.
type ExpectedChildKeys =
  | "student_id"
  | "name"
  | "class"
  | "attendance"
  | "homework"
  | "remarks"
  | "test_marks";
const childKeysAreExactlyTheFiveItems: Exact<keyof ParentDigestChild, ExpectedChildKeys> = true;

describe("parent weekly digest — a rate nobody measured is null, never zero", () => {
  // A week in which no register was taken. This is the shape the RPC returns:
  // `marked: 0` with `pct: null`, NOT `pct: 0`.
  const unmeasured: ParentDigestAttendance = {
    present: 0,
    absent: 0,
    late: 0,
    leave: 0,
    half_day: 0,
    marked: 0,
    pct: null,
  };

  it("keeps the compile-time nullability contract", () => {
    expect(attendancePctIsNullable).toBe(true);
    expect(homeworkPctIsNullable).toBe(true);
  });

  it("bands an unmeasured week as unknown, not as the worst rung", () => {
    expect(unmeasured.pct).toBeNull();
    expect(attendanceBand(unmeasured.pct)).toBe("unknown");
  });

  it("would have banded the same week as `low` had pct been 0", () => {
    // The defect this contract exists to prevent, stated as a test so the cost
    // of "simplifying" null to 0 is visible rather than argued about.
    expect(attendanceBand(0)).toBe("low");
    expect(attendanceBand(0)).not.toBe(attendanceBand(unmeasured.pct));
  });

  it("distinguishes unmeasured from a real zero attendance rate", () => {
    // A child who WAS marked, and was absent every day, is genuinely at 0% and
    // must band as low. Only the unmeasured case is unknown.
    const measuredZero: ParentDigestAttendance = {
      ...unmeasured,
      absent: 5,
      marked: 5,
      pct: 0,
    };
    expect(attendanceBand(measuredZero.pct)).toBe("low");
    expect(attendanceBand(unmeasured.pct)).toBe("unknown");
  });

  it("holds for any ladder the digest figures are banded through", () => {
    // Guards the generic entry point too, not just the attendance preset.
    expect(bandOf(null, 60, 80)).toBe("unknown");
    expect(bandOf(0, 60, 80)).toBe("low");
  });
});

describe("parent weekly digest — the payload is five items, and no more", () => {
  it("declares exactly the seven keys rule 17's five items land in", () => {
    expect(childKeysAreExactlyTheFiveItems).toBe(true);
  });

  it("states homework's not-completed half rather than leaving it to subtraction", () => {
    const hw: ParentDigestHomework = { due: 4, submitted: 3, not_completed: 1, pct: 75 };
    expect(hw.not_completed).toBe(1);
    expect(hw.submitted + hw.not_completed).toBe(hw.due);
  });
});
