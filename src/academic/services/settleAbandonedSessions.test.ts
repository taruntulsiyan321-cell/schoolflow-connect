/**
 * A practice session the student walked away from is finished from the answers
 * it already holds — and only when finishing it tells the truth.
 *
 * Measured on production 2026-09-17: 52 unfinished sessions, holding answers
 * that earned no XP, moved no streak, wrote no chapter tally and appeared in no
 * history. Resuming was removed with the v2 redesign, so nothing was ever
 * coming back for them.
 *
 * The two bounds are the whole rule, and each has a case below:
 *   · newer than ABANDONED_AFTER_MS — a session being sat in another tab right
 *     now must not be closed underneath the student;
 *   · older than SETTLE_WITHIN_MS — finishing credits XP, activity minutes and
 *     a study day NOW, so settling five-week-old practice would hand today a
 *     streak the student did not earn.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const finished: Array<Record<string, unknown>> = [];

vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context")>();
  return { ...actual, assertCanOwn: () => {}, assertCanConsume: () => {} };
});

let sessionRows: Array<{ id: string }> = [];
let attemptRows: Array<{ session_id: string; created_at: string }> = [];

vi.mock("../repository/base", async (importOriginal) => {
  // The real retryTransient comes through: settling calls finish, and a stub
  // that dropped the retry would make this test pass over a finish that is
  // not there at all.
  const actual = await importOriginal<typeof import("../repository/base")>();
  const chain = (rows: unknown[]) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "is", "in", "order", "limit", "not", "or", "gte", "lte"]) {
      self[m] = () => self;
    }
    // Awaiting the builder resolves to the rows, as PostgREST's does.
    self.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
    return self;
  };
  return {
    ...actual,
    getClient: () => ({
      from: (table: string) => chain(table === "practice_sessions" ? sessionRows : attemptRows),
      rpc: (name: string, args: Record<string, unknown>) => {
        if (name === "rpc_finish_practice_session") finished.push(args);
        return Promise.resolve({ data: { session_id: args._session_id }, error: null });
      },
    }),
    throwIfError: (error: unknown, message: string) => {
      if (error) throw new Error(message);
    },
  };
});

vi.mock("../live", () => ({ broadcastAcademicWrite: () => {} }));
vi.mock("../repository/eventsRepository", () => ({
  emitEvent: () => Promise.resolve(),
  emitEventBestEffort: () => Promise.resolve(),
}));
vi.mock("@/lib/studentXpNotify", () => ({ notifyStudentXpUpdated: () => {} }));

const { PracticeService, ABANDONED_AFTER_MS, SETTLE_WITHIN_MS } = await import("./practiceService");

const ctx = {
  schoolId: "00000000-0000-4000-8000-000000000001",
  userId: "user-1",
  studentId: "student-1",
  role: "student" as const,
};

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

beforeEach(() => {
  finished.length = 0;
  sessionRows = [];
  attemptRows = [];
});

describe("settleAbandonedSessions", () => {
  it("finishes a session left an hour ago, from the answers it holds", async () => {
    sessionRows = [{ id: "left" }];
    attemptRows = [
      { session_id: "left", created_at: ago(65 * 60 * 1000) },
      { session_id: "left", created_at: ago(63 * 60 * 1000) },
    ];
    expect(await PracticeService.settleAbandonedSessions(ctx)).toBe(1);
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({
      _session_id: "left",
      // The server re-counts from question_attempts; no client tally is sent.
      _attempts: [],
      _ended_by_user: true,
      _ended_normally: false,
    });
  });

  it("leaves a session that is still being sat in another tab", async () => {
    sessionRows = [{ id: "live" }];
    attemptRows = [{ session_id: "live", created_at: ago(ABANDONED_AFTER_MS - 60 * 1000) }];
    expect(await PracticeService.settleAbandonedSessions(ctx)).toBe(0);
    expect(finished).toHaveLength(0);
  });

  it("leaves practice too old to credit today", async () => {
    sessionRows = [{ id: "ancient" }];
    attemptRows = [{ session_id: "ancient", created_at: ago(SETTLE_WITHIN_MS + 60 * 1000) }];
    expect(await PracticeService.settleAbandonedSessions(ctx)).toBe(0);
    expect(finished).toHaveLength(0);
  });

  it("leaves a session nobody answered — finishing it would record a session that never happened", async () => {
    sessionRows = [{ id: "opened-only" }];
    attemptRows = [];
    expect(await PracticeService.settleAbandonedSessions(ctx)).toBe(0);
    expect(finished).toHaveLength(0);
  });

  it("settles each qualifying session once, and only those", async () => {
    sessionRows = [{ id: "a" }, { id: "b" }, { id: "live" }, { id: "empty" }];
    attemptRows = [
      { session_id: "a", created_at: ago(2 * 60 * 60 * 1000) },
      { session_id: "b", created_at: ago(40 * 60 * 1000) },
      { session_id: "live", created_at: ago(2 * 60 * 1000) },
    ];
    expect(await PracticeService.settleAbandonedSessions(ctx)).toBe(2);
    expect(finished.map((f) => f._session_id)).toEqual(["a", "b"]);
  });

  it("does nothing when there is nothing open", async () => {
    expect(await PracticeService.settleAbandonedSessions(ctx)).toBe(0);
    expect(finished).toHaveLength(0);
  });
});
