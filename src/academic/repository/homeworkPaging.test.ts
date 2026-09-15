import { describe, expect, it, vi } from "vitest";

/**
 * Homework counts must not stop at a page. The API returns at most its row
 * limit and says nothing when it stops, so a whole-school or whole-class read
 * that does not page is a count that silently ends there; and one `in.(…)`
 * filter holding hundreds of ids outgrows the request line.
 */
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { listCompletion, listStandingsForClass } from "./homeworkRepository";

type Call = { table: string; in?: string[]; range?: [number, number] };

/** A client that answers each request from `answer`, and records what was asked. */
function fakeClient(answer: (call: Call) => unknown[]) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table };
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "order"]) chain[m] = () => chain;
      chain.in = (_column: string, ids: string[]) => {
        call.in = ids;
        return chain;
      };
      chain.range = (from: number, to: number) => {
        call.range = [from, to];
        return chain;
      };
      chain.then = (resolve: (v: unknown) => void) => {
        calls.push(call);
        resolve({ data: answer(call), error: null });
      };
      return chain;
    },
  };
  return { ctx: { schoolId: "00000000-0000-4000-8000-000000000001", client: client as never }, calls };
}

const completionRow = (i: number) => ({
  homework_id: `hw-${i}`,
  class_id: "class-1",
  students: 2,
  given: 1,
  awaiting_review: 0,
  accepted: 1,
  rejected: 0,
  not_given: 1,
  completion_pct: 50,
});

const rowsFor = (range: [number, number] | undefined, total: number, make: (i: number) => unknown) => {
  const [from, to] = range ?? [0, total - 1];
  return Array.from({ length: Math.max(0, Math.min(to, total - 1) - from + 1) }, (_, k) => make(from + k));
};

describe("homework reads that must reach the end", () => {
  it("reads the whole school's completion page by page", async () => {
    const { ctx, calls } = fakeClient((call) => rowsFor(call.range, 205, completionRow));
    const rows = await listCompletion(ctx);
    expect(rows).toHaveLength(205);
    expect(rows[204].homeworkId).toBe("hw-204");
    expect(calls.map((c) => c.range)).toEqual([
      [0, 199],
      [200, 399],
    ]);
  });

  it("asks for a long list of homework in chunks, and returns every row", async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `hw-${i}`);
    const { ctx, calls } = fakeClient((call) => (call.in ?? []).map((id) => completionRow(Number(id.slice(3)))));
    const rows = await listCompletion(ctx, ids);
    expect(rows.map((r) => r.homeworkId)).toEqual(ids);
    expect(calls.map((c) => c.in?.length)).toEqual([100, 100, 50]);
  });

  it("asks nothing for no homework", async () => {
    const { ctx, calls } = fakeClient(() => []);
    expect(await listCompletion(ctx, [])).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("reads a class's standings page by page", async () => {
    const standing = (i: number) => ({
      homework_id: `hw-${i % 7}`,
      class_id: "class-1",
      student_id: `s-${i}`,
      submission_id: null,
      status: "not_submitted",
      given: false,
      closed: true,
      closes_at: "2026-09-10T11:30:00.000Z",
      due_date: "2026-09-10",
    });
    const { ctx, calls } = fakeClient((call) => rowsFor(call.range, 401, standing));
    const rows = await listStandingsForClass(ctx, "class-1");
    expect(rows).toHaveLength(401);
    expect(calls).toHaveLength(3);
  });
});
