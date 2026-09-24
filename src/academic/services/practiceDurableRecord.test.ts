/**
 * What a finished practice session durably says about its questions.
 *
 * §10.8, the transient/durable rule: "While a session is in flight,
 * per-question correctness may exist. It is working state. When the session
 * closes, it must not persist. What survives is: session or tier TOTALS, plus
 * rows for WRONG, SKIPPED and BOOKMARKED" — and "no per-question record of
 * correct answers".
 *
 * Measured 2026-09-23 on production: 1,267 correct per-question rows across
 * finished sessions, each holding the question, the options, the answer key
 * and the student's choice, and 32 saved snapshots that had frozen the same.
 * PracticeService.listSessionAttempts is the ONE read of a session's questions
 * — the review list on the result screen and the snapshot a saved session
 * freezes both come through it — so the rule is applied there.
 *
 * The stub below applies the filter it is given, exactly as PostgREST would.
 * A stub that ignored it would pass every assertion here.
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

describe("a finished session's per-question record", () => {
  it("is the wrong and the skipped — never a question the student got right", async () => {
    const got = (await PracticeService.listSessionAttempts(ctx, "session-1")) as unknown as Row[];
    expect(got.map((r) => r.id).sort()).toEqual(["skipped-1", "skipped-2", "ungraded-1", "wrong-1"]);
    expect(
      got.some((r) => r.is_correct === true),
      "a right answer came back — §10.8 says it does not survive the session",
    ).toBe(false);
  });

  it("POSITIVE CONTROL: without the rule, the same read returns the right answers too", async () => {
    // The rule is one filter. Take it out and the two correct rows come back,
    // which is what the read did before 2026-09-23 — so the assertion above
    // measures the filter, not an empty table.
    expect(rows.filter((r) => r.is_correct === true), "the stub's table does hold right answers").toHaveLength(2);
    await PracticeService.listSessionAttempts(ctx, "session-1");
    expect(orFilters, "the read must narrow in the DATABASE, not in the browser").toEqual([
      "is_correct.is.false,is_correct.is.null,skipped.is.true",
    ]);
  });

  it("returns every question of a session in which nothing went right", async () => {
    rows = rows.filter((r) => r.is_correct !== true);
    const got = await PracticeService.listSessionAttempts(ctx, "session-2");
    expect(got).toHaveLength(4);
  });
});
