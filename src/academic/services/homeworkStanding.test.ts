import { describe, expect, it } from "vitest";
import { canHandIn, homeworkStanding } from "@/academic/services/homeworkService";

/**
 * Where a student stands on one homework, as every screen shows it
 * (docs/gurukul-spec-rules.md, "Homework — RULED 2026-09-13").
 *
 * `given` and `closed` come from `homework_student_status`, the one place the
 * database decides them; these two functions only name the result. The rules
 * that matter: a REJECTED hand-in is not given, and once the deadline passes
 * everything not given is simply not handed in.
 */
const row = (status: "not_submitted" | "submitted" | "accepted" | "rejected", closed: boolean) => ({
  status,
  // As the view has it: given = submitted or accepted.
  given: status === "submitted" || status === "accepted",
  closed,
});

describe("homework standing", () => {
  it("names each of the four statuses, before the deadline", () => {
    expect(homeworkStanding(row("not_submitted", false))).toBe("to_do");
    expect(homeworkStanding(row("submitted", false))).toBe("handed_in");
    expect(homeworkStanding(row("accepted", false))).toBe("accepted");
    expect(homeworkStanding(row("rejected", false))).toBe("rejected");
  });

  it("counts a rejected hand-in as not handed in once the deadline passes", () => {
    expect(homeworkStanding(row("rejected", true))).toBe("not_handed_in");
    expect(homeworkStanding(row("not_submitted", true))).toBe("not_handed_in");
  });

  it("keeps work that was given as given after the deadline", () => {
    expect(homeworkStanding(row("submitted", true))).toBe("handed_in");
    expect(homeworkStanding(row("accepted", true))).toBe("accepted");
  });
});

describe("who may hand in", () => {
  it("allows a first hand-in, a replacement, and a hand-in after rejection, before the deadline", () => {
    expect(canHandIn(row("not_submitted", false))).toBe(true);
    expect(canHandIn(row("submitted", false))).toBe(true);
    expect(canHandIn(row("rejected", false))).toBe(true);
  });

  it("allows nothing after the deadline, and nothing once accepted", () => {
    expect(canHandIn(row("not_submitted", true))).toBe(false);
    expect(canHandIn(row("rejected", true))).toBe(false);
    expect(canHandIn(row("accepted", false))).toBe(false);
  });
});
