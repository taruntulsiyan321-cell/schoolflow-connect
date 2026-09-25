/**
 * What a finished practice session keeps about its questions: every one.
 *
 * Ruled by the owner on 2026-09-25: a finished session keeps the record of
 * its right answers too (the "no per-question record of correct answers" part
 * of §10.8 is withdrawn). From 2026-09-23 this read had filtered them out, so
 * reopening a session showed only what went wrong. PracticeService.
 * listSessionAttempts is the ONE read of a session's questions — the review
 * list on the result screen and the snapshot a saved session freezes both
 * come through it.
 *
 * The stub applies any filter it is given, exactly as PostgREST would, so a
 * read that still narrowed the rows would fail here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; question: string; is_correct: boolean | null; skipped: boolean | null };

let rows: Row[] = [];
let orFilters: string[] = [];

vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context")>();
  return { ...actual, assertCanOwn: () => {}, assertCanConsume: () => {} };
});

/** `is_correct.is.false,is_correct.is.null,skipped.is.true` → a row predicate. */
function orPredicate(expr: string): (r: Row) => boolean {
  const arms = expr.split(",").map((arm) => {
    const [col, op, value] = arm.split(".");
    if (op !== "is") throw new Error(`the stub only knows .is: ${arm}`);
    const want = value === "null" ? null : value === "true";
    return (r: Row) => (r as unknown as Record<string, unknown>)[col] === want;
  });
  return (r) => arms.some((a) => a(r));
}

vi.mock("../repository/base", () => {
  const builder = () => {
    const keep: Array<(r: Row) => boolean> = [];
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) self[m] = () => self;
    self.or = (expr: string) => { orFilters.push(expr); keep.push(orPredicate(expr)); return self; };
    self.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows.filter((r) => keep.every((k) => k(r))), error: null });
    return self;
  };
  return {
    getClient: () => ({ from: () => builder() }),
    throwIfError: (error: unknown, message: string) => { if (error) throw new Error(message); },
  };
});

vi.mock("../live", () => ({ broadcastAcademicWrite: () => {} }));
vi.mock("../repository/eventsRepository", () => ({
  emitEvent: () => Promise.resolve(),
  emitEventBestEffort: () => Promise.resolve(),
}));
vi.mock("@/lib/studentXpNotify", () => ({ notifyStudentXpUpdated: () => {} }));

const { PracticeService } = await import("./practiceService");
const ctx = { schoolId: "00000000-0000-4000-8000-000000000001", userId: "u", studentId: "s", role: "student" as const };

beforeEach(() => {
  orFilters = [];
  rows = [
    { id: "right-1", question: "answered correctly", is_correct: true, skipped: false },
    { id: "right-2", question: "answered correctly too", is_correct: true, skipped: false },
    { id: "wrong-1", question: "got it wrong", is_correct: false, skipped: false },
    { id: "skipped-1", question: "skipped it", is_correct: false, skipped: true },
    // A skip the server marked correct-less rather than wrong, and an
    // ungraded row: both are "not a right answer" and both survive.
    { id: "skipped-2", question: "skipped, ungraded", is_correct: null, skipped: true },
    { id: "ungraded-1", question: "never graded", is_correct: null, skipped: false },
  ];
});

describe("a finished session's questions", () => {
  it("are every question, right answers included", async () => {
    const got = (await PracticeService.listSessionAttempts(ctx, "session-1")) as unknown as Row[];
    expect(got.map((r) => r.id).sort()).toEqual(["right-1", "right-2", "skipped-1", "skipped-2", "ungraded-1", "wrong-1"]);
  });

  it("CONTROL: the stub does narrow when asked, so the read above asked for no narrowing", async () => {
    await PracticeService.listSessionAttempts(ctx, "session-1");
    expect(orFilters, "the read no longer filters the session's rows").toEqual([]);
    const narrowed = rows.filter(orPredicate("is_correct.is.false,is_correct.is.null,skipped.is.true"));
    expect(narrowed.some((r) => r.is_correct === true), "the old filter really did drop right answers").toBe(false);
  });
});
