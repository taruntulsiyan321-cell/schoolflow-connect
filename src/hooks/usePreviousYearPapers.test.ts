import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * The paper a previous-year question was set in, for a screen that holds
 * questions as an attempt froze them. Read from the student's own view of the
 * bank, for exactly the questions on screen, and only the previous-year ones.
 */
const asked = vi.hoisted(() => ({ calls: [] as Array<[string, ...unknown[]]>, reply: { data: null as unknown, error: null as unknown } }));

vi.mock("@/integrations/supabase/client", () => {
  const chain = {
    select: (...a: unknown[]) => { asked.calls.push(["select", ...a]); return chain; },
    in: (...a: unknown[]) => { asked.calls.push(["in", ...a]); return chain; },
    not: (...a: unknown[]) => { asked.calls.push(["not", ...a]); return Promise.resolve(asked.reply); },
  };
  return { supabase: { from: (t: string) => { asked.calls.push(["from", t]); return chain; } } };
});

const { loadPreviousYearPapers, usePreviousYearPapers } = await import("./usePreviousYearPapers");

beforeEach(() => {
  asked.calls = [];
  asked.reply = { data: [], error: null };
});

describe("loadPreviousYearPapers", () => {
  it("asks the student's view for these questions, previous-year ones only", async () => {
    asked.reply = { data: [{ id: "q2", source: "CUET (UG) 2023 · 30 May · Shift 3", exam_year: 2023 }], error: null };
    const got = await loadPreviousYearPapers(["q1", "q2"]);
    expect(asked.calls).toEqual([
      ["from", "question_bank_student"],
      ["select", "id, source, exam_year"],
      ["in", "id", ["q1", "q2"]],
      ["not", "exam_year", "is", null],
    ]);
    expect([...got]).toEqual([["q2", { source: "CUET (UG) 2023 · 30 May · Shift 3", exam_year: 2023 }]]);
  });

  it("asks nothing for no questions", async () => {
    expect((await loadPreviousYearPapers([])).size).toBe(0);
    expect(asked.calls).toEqual([]);
  });

  it("fails, rather than answering empty, when the read fails", async () => {
    asked.reply = { data: null, error: { message: "503" } };
    await expect(loadPreviousYearPapers(["q1"])).rejects.toThrow("503");
  });
});

describe("usePreviousYearPapers", () => {
  it("holds the papers it read, asking once for a set of ids however it is ordered", async () => {
    asked.reply = { data: [{ id: "q1", source: "CUET (UG) 2022 · 25 May · Shift 1", exam_year: 2022 }], error: null };
    const { result, rerender } = renderHook(({ ids }) => usePreviousYearPapers(ids), { initialProps: { ids: ["q2", "q1", "q1"] } });
    await waitFor(() => expect(result.current.get("q1")?.exam_year).toBe(2022));
    expect(asked.calls.find((c) => c[0] === "in")).toEqual(["in", "id", ["q1", "q2"]]);
    const reads = asked.calls.filter((c) => c[0] === "from").length;
    rerender({ ids: ["q1", "q2"] });
    expect(asked.calls.filter((c) => c[0] === "from").length).toBe(reads);
  });

  it("shows no papers when the read fails, and the questions stay", async () => {
    asked.reply = { data: null, error: { message: "offline" } };
    const { result } = renderHook(() => usePreviousYearPapers(["q1"]));
    await waitFor(() => expect(asked.calls.some((c) => c[0] === "not")).toBe(true));
    expect(result.current.size).toBe(0);
  });
});
