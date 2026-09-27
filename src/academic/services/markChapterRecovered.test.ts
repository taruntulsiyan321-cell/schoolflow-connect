/**
 * §4.4 — the student decides, the app advises.
 *
 * "Locked decision: the student is responsible for clearing their own mistake
 * book… If not ready, marking the chapter recovered requires an extra confirm
 * — not a block, a speed bump. Whatever they choose, revision will catch it: a
 * chapter cleared prematurely fails its 7-day check and returns. Do not block.
 * Advise, then catch it downstream."
 *
 * There was no way to do it at all: a student told "not solid yet" could only
 * sit the ladder again. What this measures is that the action does §4.5's list
 * and nothing wider — this chapter's OPEN mistakes, this chapter's state, and
 * a revision date at the first interval.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { REVISION_INTERVALS_DAYS } from "@/academic/recovery/constants";

type Call = { table: string; payload: Record<string, unknown>; filters: Array<[string, unknown]> };

let calls: Call[] = [];
let clearedRows: Array<{ id: string }> = [];

vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context")>();
  return { ...actual, assertCanOwn: () => {}, assertCanConsume: () => {} };
});

vi.mock("../repository/base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repository/base")>();
  const builder = (table: string) => {
    const call: Call = { table, payload: {}, filters: [] };
    const self: Record<string, unknown> = {};
    self.update = (payload: Record<string, unknown>) => { call.payload = payload; calls.push(call); return self; };
    self.eq = (col: string, v: unknown) => { call.filters.push([col, v]); return self; };
    self.select = () => Promise.resolve({ data: clearedRows, error: null });
    self.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
    return self;
  };
  return {
    ...actual,
    getClient: () => ({ from: (table: string) => builder(table) }),
    throwIfError: (error: unknown, message: string) => { if (error) throw new Error(message); },
  };
});

vi.mock("../live", () => ({ broadcastAcademicWrite: () => {} }));

const { RecoveryEngineService } = await import("./recoveryEngineService");
const ctx = { schoolId: "00000000-0000-4000-8000-000000000001", userId: "user-1", studentId: "s", role: "student" as const };

beforeEach(() => {
  calls = [];
  clearedRows = [{ id: "m1" }, { id: "m2" }];
});

describe("marking a chapter recovered anyway", () => {
  it("clears the chapter's OPEN mistakes, and only this student's", async () => {
    await RecoveryEngineService.markChapterRecovered(ctx, "chapter-1");
    const mistakes = calls.find((c) => c.table === "student_mistakes");
    expect(mistakes?.payload.status).toBe("cleared");
    expect(mistakes?.payload.cleared_at).toBeTruthy();
    expect(mistakes?.filters).toEqual(
      expect.arrayContaining([["user_id", "user-1"], ["chapter_id", "chapter-1"], ["status", "open"]]),
    );
  });

  it("CONTROL: it never touches a cleared row, another chapter or another student", async () => {
    await RecoveryEngineService.markChapterRecovered(ctx, "chapter-1");
    for (const call of calls) {
      const cols = Object.fromEntries(call.filters);
      expect(cols.user_id, `${call.table} must be scoped to the caller`).toBe("user-1");
      expect(cols.chapter_id, `${call.table} must be scoped to the chapter`).toBe("chapter-1");
    }
    // A blanket clear would have no status filter at all.
    expect(calls.find((c) => c.table === "student_mistakes")?.filters.some(([c]) => c === "status")).toBe(true);
  });

  it("§4.5: the chapter reads recovered, and revision is scheduled at the first interval", async () => {
    const out = await RecoveryEngineService.markChapterRecovered(ctx, "chapter-1");
    const state = calls.find((c) => c.table === "chapter_state");
    expect(state?.payload.state).toBe("recovered");
    expect(state?.payload.revision_stage).toBe(1);
    expect(state?.payload.recovered_at).toBeTruthy();

    const days = (new Date(out.nextRevisionAt).getTime() - Date.now()) / 86400000;
    expect(Math.round(days)).toBe(REVISION_INTERVALS_DAYS[0]);
    expect(state?.payload.next_revision_at).toBe(out.nextRevisionAt);
  });

  it("reports how many mistakes it cleared, so the screen can say it", async () => {
    expect((await RecoveryEngineService.markChapterRecovered(ctx, "chapter-1")).clearedMistakes).toBe(2);
    clearedRows = [];
    expect((await RecoveryEngineService.markChapterRecovered(ctx, "chapter-1")).clearedMistakes).toBe(0);
  });

  it("refuses without a signed-in student rather than clearing somebody's book", async () => {
    await expect(
      RecoveryEngineService.markChapterRecovered({ ...ctx, userId: "" }, "chapter-1"),
    ).rejects.toThrow(/signed-in/i);
    expect(calls, "nothing may be written without a caller").toEqual([]);
  });
});
