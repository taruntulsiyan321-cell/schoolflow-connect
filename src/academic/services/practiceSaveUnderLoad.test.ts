/**
 * A session must not be lost because the database was busy.
 *
 * Measured on production 2026-09-23, as the student, twice in one run:
 *
 *   POST /rest/v1/rpc/rpc_finish_practice_session
 *     -> 500 {"code":"57014","message":"canceling statement due to statement timeout"}
 *
 * and the finished session simply did not save. `rpc_finish_practice_session`
 * de-duplicates the attempts it is sent and then counts the session from
 * question_attempts, so sending it again is safe — the page-exit keepalive
 * path already depends on that. What was missing was sending it again.
 *
 * The other half of the same report ("Battleground overloads it") is measured
 * in useBattlegroundData's own test: the featured-battle maintenance that ran
 * on every reload is what the timeout was competing with.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isTransientDbError, retryTransient } from "../repository/base";

describe("what counts as 'not now'", () => {
  it("retries a statement timeout, a lost lock, a deadlock and a dropped connection", () => {
    for (const code of ["57014", "55P03", "40001", "40P01", "08006", "53300"]) {
      expect(isTransientDbError({ code, message: "x" }), code).toBe(true);
    }
    expect(isTransientDbError(new TypeError("Failed to fetch"))).toBe(true);
  });

  it("CONTROL: never retries a refusal, a constraint or a bad argument", () => {
    for (const code of ["42501", "23514", "23505", "22P02", "PGRST204", "P0001"]) {
      expect(isTransientDbError({ code, message: "x" }), code).toBe(false);
    }
  });
});

describe("retryTransient", () => {
  const noSleep = () => Promise.resolve();

  it("gives the answer once the database is free", async () => {
    let calls = 0;
    const out = await retryTransient(async () => {
      calls += 1;
      if (calls < 3) throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
      return "finished";
    }, { sleep: noSleep });
    expect(out).toBe("finished");
    expect(calls).toBe(3);
  });

  it("gives up after its attempts, with the database's own error", async () => {
    let calls = 0;
    await expect(retryTransient(async () => {
      calls += 1;
      throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    }, { sleep: noSleep })).rejects.toThrow(/statement timeout/);
    expect(calls, "three attempts: the first and two retries").toBe(3);
  });

  it("CONTROL: a refusal fails on the first answer and is not repeated", async () => {
    let calls = 0;
    await expect(retryTransient(async () => {
      calls += 1;
      throw Object.assign(new Error("permission denied"), { code: "42501" });
    }, { sleep: noSleep })).rejects.toThrow(/permission denied/);
    expect(calls, "repeating a refusal only wastes the database's time").toBe(1);
  });

  it("waits between attempts rather than hammering", async () => {
    const waited: number[] = [];
    let calls = 0;
    await retryTransient(async () => {
      calls += 1;
      if (calls < 3) throw { code: "57014", message: "busy" };
      return true;
    }, { sleep: async (ms) => { waited.push(ms); } });
    expect(waited).toEqual([400, 1200]);
  });
});

describe("PracticeService.finish", () => {
  const rpc = vi.fn();

  beforeEach(() => {
    rpc.mockReset();
    vi.resetModules();
  });

  it("saves the session the database refused the first time, and sends the same arguments", async () => {
    vi.doMock("./context", async (importOriginal) => {
      const actual = await importOriginal<typeof import("./context")>();
      return { ...actual, assertCanOwn: () => {}, assertCanConsume: () => {} };
    });
    vi.doMock("../repository/base", async (importOriginal) => {
      const actual = await importOriginal<typeof import("../repository/base")>();
      return {
        ...actual,
        getClient: () => ({ rpc: (...a: unknown[]) => rpc(...a) }),
        // No real waiting in a unit test; the delays themselves are measured above.
        retryTransient: (run: () => Promise<unknown>) => actual.retryTransient(run, { sleep: () => Promise.resolve() }),
      };
    });
    vi.doMock("../live", () => ({ broadcastAcademicWrite: () => {} }));
    vi.doMock("../repository/eventsRepository", () => ({
      emitEvent: () => Promise.resolve(),
      emitEventBestEffort: () => Promise.resolve(),
    }));
    vi.doMock("@/lib/studentXpNotify", () => ({ notifyStudentXpUpdated: () => {} }));

    rpc
      .mockResolvedValueOnce({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } })
      .mockResolvedValueOnce({ data: { session_id: "s1", xp_earned: 30 }, error: null });

    const { PracticeService } = await import("./practiceService");
    const ctx = { schoolId: "00000000-0000-4000-8000-000000000001", userId: "u", studentId: "s", role: "student" as const };
    const out = await PracticeService.finish(ctx, { _session_id: "s1", _attempts: [{ q: 1 }] });

    expect(out).toEqual({ session_id: "s1", xp_earned: 30 });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0]).toEqual(rpc.mock.calls[1]);
    expect(rpc.mock.calls[1][0]).toBe("rpc_finish_practice_session");
  });
});
