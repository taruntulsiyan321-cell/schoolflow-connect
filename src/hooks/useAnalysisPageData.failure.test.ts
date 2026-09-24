/**
 * One failed count is a failed load — never a zero.
 *
 * useAnalysisPageData reads the answer totals as three head counts. Each was
 * taken as `count ?? 0`, so when one timed out (the 8-second statement timeout
 * this database hits under load) the page printed "0 correct" and a 0%
 * accuracy beside real figures, with nothing on screen to say a read had
 * failed. A failed sessions read likewise became "No score trend data yet".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({ failing: null as string | null }));

// A PostgREST stand-in: every builder method chains, and awaiting the chain
// resolves to rows or a count — or to an error for the query named failing.
vi.mock("@/integrations/supabase/client", () => {
  const query = (table: string) => {
    const filters: string[] = [];
    let head = false;
    const self: Record<string, unknown> = {};
    for (const m of ["eq", "not", "gte", "order", "limit", "maybeSingle"]) {
      self[m] = (...a: unknown[]) => { filters.push(`${m}:${String(a[0])}:${String(a[1])}`); return self; };
    }
    self.select = (_cols: string, opts?: { head?: boolean }) => { head = Boolean(opts?.head); return self; };
    self.then = (resolve: (v: unknown) => unknown) => {
      const key = table === "question_attempts" && head
        ? (filters.some((f) => f.startsWith("eq:is_correct")) ? "correct"
          : filters.some((f) => f.startsWith("eq:skipped")) ? "skipped" : "attempts")
        : table;
      if (h.failing === key) return resolve({ data: null, count: null, error: { message: "canceling statement due to statement timeout", code: "57014" } });
      if (head) return resolve({ data: null, count: key === "attempts" ? 20 : key === "correct" ? 8 : 2, error: null });
      if (table === "students") return resolve({ data: null, error: null });
      return resolve({ data: [], error: null });
    };
    return self;
  };
  return { supabase: { from: (t: string) => query(t) } };
});
vi.mock("@/hooks/useAuth", () => {
  const value = { user: { id: "u1" } };
  return { useAuth: () => value };
});
vi.mock("@/academic", () => ({ useAcademicLive: () => 0 }));

import { useAnalysisPageData } from "./useAnalysisPageData";

describe("useAnalysisPageData — a failed read is not a zero", () => {
  beforeEach(() => { h.failing = null; });

  it("POSITIVE CONTROL: with every read answering, the counts arrive", async () => {
    const { result } = renderHook(() => useAnalysisPageData(true));
    await waitFor(() => expect(result.current.data).not.toBeNull());
    expect(result.current.data?.totals).toMatchObject({ correct: 8, skipped: 2, wrong: 10 });
    expect(result.current.error).toBeNull();
  });

  for (const which of ["correct", "attempts", "skipped", "practice_sessions"]) {
    it(`a failed ${which} read reports an error and no figures`, async () => {
      h.failing = which;
      const { result } = renderHook(() => useAnalysisPageData(true));
      await waitFor(() => expect(result.current.error).not.toBeNull());
      expect(result.current.data).toBeNull();
    });
  }
});
