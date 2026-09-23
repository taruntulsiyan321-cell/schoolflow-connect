/**
 * Four screens asking for the student's snapshot ask the server once.
 *
 * `rpc_student_academic_snapshot` counts homework and tests, builds the weak
 * topic list, walks the recovery queue and the revision ladder, reads 28 days
 * of activity, computes exam readiness — and writes, through
 * `_rebuild_revision_queue`. Measured on production 2026-09-23, from
 * pg_stat_statements: 29,322 calls, 1,975 s of database time, max 7.7 s. It is
 * the call that returns 57014 on the home and analysis screens
 * (KNOWN_ISSUES 74).
 *
 * It had no sharing at all: Dashboard, Analysis, the Practice hub and the
 * Battleground each called it, and the hook re-fires on live events across
 * seven domains — so one XP bump asked four times at once.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => rpc(...a) },
}));

const {
  readStudentAcademicSnapshot,
  resetStudentAcademicSnapshot,
  SNAPSHOT_FRESH_MS,
  SNAPSHOT_LIVE_COALESCE_MS,
} = await import("./useStudentAcademicSnapshot");

const deferred = () => {
  let resolve!: (v: unknown) => void;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => {
  rpc.mockReset();
  resetStudentAcademicSnapshot();
});

describe("the shared snapshot read", () => {
  it("serves four callers that ask together from ONE request", async () => {
    const d = deferred();
    rpc.mockReturnValue(d.promise);
    const all = Promise.all([
      readStudentAcademicSnapshot(),
      readStudentAcademicSnapshot(),
      readStudentAcademicSnapshot(),
      readStudentAcademicSnapshot(),
    ]);
    expect(rpc, "four screens, one call").toHaveBeenCalledTimes(1);
    d.resolve({ data: { mistake_count: 7 }, error: null });
    const results = await all;
    expect(results.every((r) => r?.mistake_count === 7)).toBe(true);
  });

  it("reuses the answer while it is fresh, and asks again once it is not", async () => {
    rpc.mockResolvedValue({ data: { mistake_count: 1 }, error: null });
    await readStudentAcademicSnapshot();
    await readStudentAcademicSnapshot();
    expect(rpc).toHaveBeenCalledTimes(1);
    // maxAgeMs is the whole of the freshness rule, so it is measured directly.
    await readStudentAcademicSnapshot({ maxAgeMs: 0 });
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(SNAPSHOT_FRESH_MS).toBeGreaterThan(0);
  });

  /**
   * A live event will not take the ordinary 15-second answer — something
   * changed — but it takes a three-second one, so a burst of XP events during
   * a battle costs one read instead of six (measured in the browser).
   */
  it("CONTROL: a live event refuses a stale answer but coalesces a burst", async () => {
    rpc.mockResolvedValue({ data: { mistake_count: 1 }, error: null });
    await readStudentAcademicSnapshot();
    expect(rpc).toHaveBeenCalledTimes(1);

    // Six events in the same moment: the answer is younger than the live
    // window, so they share it.
    for (let i = 0; i < 6; i++) await readStudentAcademicSnapshot({ maxAgeMs: SNAPSHOT_LIVE_COALESCE_MS });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(SNAPSHOT_LIVE_COALESCE_MS).toBeLessThan(SNAPSHOT_FRESH_MS);

    // An event after that window must be a real read, or a screen would keep
    // showing a figure that has changed.
    await readStudentAcademicSnapshot({ maxAgeMs: 0 });
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failure, and every waiting caller hears about it", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } });
    const first = readStudentAcademicSnapshot();
    const second = readStudentAcademicSnapshot();
    await expect(first).rejects.toMatchObject({ code: "57014" });
    await expect(second).rejects.toMatchObject({ code: "57014" });
    expect(rpc).toHaveBeenCalledTimes(1);

    rpc.mockResolvedValueOnce({ data: { mistake_count: 2 }, error: null });
    await expect(readStudentAcademicSnapshot()).resolves.toMatchObject({ mistake_count: 2 });
    expect(rpc, "a failed read must not be remembered as an answer").toHaveBeenCalledTimes(2);
  });
});
