/**
 * The §6.3 chapter list's reads: every page, every attempt placed by the bank,
 * and a failed read shown as failed.
 *
 * deriveWeakChapters (weakChapters.test.ts) and WeakChapterList have their own
 * tests; the hook between them had none, and every page test mocks it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

type Rows = Record<string, unknown>[];
const db = vi.hoisted(() => ({
  rpc: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  tables: {} as Record<string, Rows>,
  bank: [] as Array<{ id: string; chapter_id: string }>,
  failing: null as string | null,
  reads: [] as string[],
}));

// A PostgREST stand-in: the paged reads answer their range, the bank answers
// the ids it is asked for, and the table named failing answers with an error.
vi.mock("@/integrations/supabase/client", () => {
  const refused = (what: string) => ({ data: null, error: { message: `${what} refused` } });
  const from = (table: string) => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "eq", "order"]) self[m] = () => self;
    self.range = (lo: number, hi: number) => {
      db.reads.push(`${table}[${lo}-${hi}]`);
      if (db.failing === table) return Promise.resolve(refused(table));
      return Promise.resolve({ data: (db.tables[table] ?? []).slice(lo, hi + 1), error: null });
    };
    self.in = (_column: string, ids: string[]) => {
      db.reads.push(`${table}(${ids.length})`);
      return Promise.resolve({ data: db.bank.filter((r) => ids.includes(r.id)), error: null });
    };
    return self;
  };
  const rpc = (name: string) => {
    db.reads.push(name);
    return Promise.resolve(db.rpc[name] ?? { data: [], error: null });
  };
  return { supabase: { from, rpc } };
});
vi.mock("@/academic", () => ({ useAcademicLive: () => 0 }));

import { useWeakChapters } from "./useWeakChapters";

const STATE = { chapter_id: "c1", chapter: "Ratio Analysis", subject: "Accountancy", state: "has_mistakes" };
const open = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ chapter_id: "c1", status: "open", times_wrong: 1, created_at: `2026-09-01T10:00:${String(i % 60).padStart(2, "0")}Z`, topic: null }));

async function settled(enabled = true, userId: string | null = "u1") {
  const hook = renderHook(() => useWeakChapters(enabled, userId));
  await waitFor(() => expect(hook.result.current.list.status).not.toBe("loading"));
  return hook.result.current.list;
}

beforeEach(() => {
  db.rpc = { rpc_student_chapter_states: { data: [STATE], error: null } };
  db.tables = {};
  db.bank = [];
  db.failing = null;
  db.reads = [];
});

describe("useWeakChapters", () => {
  it("reads every page of a long history, not the first thousand", async () => {
    db.tables.student_mistakes = open(1500);
    const list = await settled();
    expect(list.status === "ready" && list.items.map((r) => [r.chapterId, r.openMistakes])).toEqual([["c1", 1500]]);
    expect(db.reads.filter((r) => r.startsWith("student_mistakes"))).toEqual(["student_mistakes[0-999]", "student_mistakes[1000-1999]"]);
  });

  it("places each attempt in the chapter the bank holds it under, past the first batch of ids", async () => {
    // 250 questions: the first 200 are c2's, quick; the last 50 are c1's, slow.
    db.bank = Array.from({ length: 250 }, (_, i) => ({ id: `q${i}`, chapter_id: i < 200 ? "c2" : "c1" }));
    db.tables.question_attempts = db.bank.map((b, i) => ({ bank_question_id: b.id, time_taken_ms: i < 200 ? 10_000 : 40_000, skipped: false }));
    db.tables.student_mistakes = open(1);
    const list = await settled();
    const c1 = list.status === "ready" ? list.items.find((r) => r.chapterId === "c1") : undefined;
    expect(c1?.avgSecPerQuestion).toBe(40);
    expect(db.reads.filter((r) => r.startsWith("question_bank_student"))).toEqual(["question_bank_student(200)", "question_bank_student(50)"]);
  });

  it("says a failed read failed, never that nothing needs work", async () => {
    db.tables.student_mistakes = open(3);
    db.failing = "chapter_tally";
    expect(await settled()).toEqual({ status: "failed", message: "chapter_tally refused" });
  });

  it("says a refused chapter-state read failed", async () => {
    db.rpc.rpc_student_chapter_states = { data: null, error: { message: "permission denied" } };
    expect(await settled()).toEqual({ status: "failed", message: "permission denied" });
  });

  it("CONTROL: with every read answering and nothing open, the list is read and empty", async () => {
    expect(await settled()).toEqual({ status: "ready", items: [] });
  });

  it("switched off, reads nothing and holds nothing", async () => {
    expect(await settled(false)).toEqual({ status: "ready", items: [] });
    expect(db.reads).toEqual([]);
  });

  it("with no account yet, reads nothing and stays loading", () => {
    const { result } = renderHook(() => useWeakChapters(true, null));
    expect(result.current.list).toEqual({ status: "loading" });
    expect(db.reads).toEqual([]);
  });
});
