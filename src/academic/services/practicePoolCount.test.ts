/**
 * Custom Practice says what its filters hold BEFORE the student starts.
 *
 * Subject, chapter, topic and difficulty are each optional and each narrows
 * the bank, and the screen offered every combination of them — including the
 * ones holding nothing. The student picked, pressed Start, waited for a
 * session to load, and met "No questions match those filters yet" on a screen
 * they could only leave. Measured on the live bank 2026-09-23: 4 of 237
 * chapter-and-difficulty pairs at Class 10 hold no question at all.
 *
 * What makes the count trustworthy is that it comes from the SAME scope and
 * the SAME narrowing the draw uses. The stub applies the filters, so a count
 * that ignored one would be caught here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; subject: string; chapter: string; difficulty: string; topic_id: string | null };

let bank: Row[] = [];
let headRange: Array<[number, number]> = [];

const q = (id: string, over: Partial<Row> = {}): Row =>
  ({ id, subject: "Mathematics", chapter: "Real Numbers", difficulty: "medium", topic_id: null, ...over });

vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context")>();
  return { ...actual, assertCanOwn: () => {}, assertCanConsume: () => {} };
});

vi.mock("../repository/base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repository/base")>();
  const builder = () => {
    const keep: Array<(r: Row) => boolean> = [];
    const self: Record<string, unknown> = {};
    self.select = () => self;
    self.order = () => self;
    self.or = () => self;
    self.not = () => self;
    self.in = () => self;
    self.is = () => self;
    self.eq = (col: string, v: unknown) => {
      if (col === "difficulty" || col === "topic_id") keep.push((r) => (r as unknown as Record<string, unknown>)[col] === v);
      return self;
    };
    self.ilike = (col: string, v: string) => {
      if (col === "subject" || col === "chapter") keep.push((r) => String((r as unknown as Record<string, string>)[col]).toLowerCase() === v.toLowerCase());
      return self;
    };
    self.range = (a: number, b: number) => {
      headRange.push([a, b]);
      const rows = bank.filter((r) => keep.every((k) => k(r)));
      // A HEAD request: the count, and no rows worth speaking of.
      return Promise.resolve({ data: rows.slice(a, b + 1), count: rows.length, error: null });
    };
    return self;
  };
  return {
    ...actual,
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
  headRange = [];
  bank = [
    q("m-easy-1", { difficulty: "easy" }),
    q("m-easy-2", { difficulty: "easy" }),
    q("m-medium-1"),
    q("m-hard-1", { difficulty: "hard", chapter: "Polynomials" }),
    q("s-medium-1", { subject: "Science", chapter: "Life Processes" }),
  ];
  vi.spyOn(PracticeService, "resolveCurriculumScope").mockResolvedValue({
    classLevel: 10, board: "rbse", stream: null, classLabel: "10-A", examId: null, examCode: null, examName: null,
  });
});

describe("what a Custom selection holds", () => {
  it("counts everything in scope when nothing is chosen", async () => {
    expect(await PracticeService.countBankPool(ctx, {})).toBe(5);
  });

  it("narrows by subject, chapter and difficulty together", async () => {
    expect(await PracticeService.countBankPool(ctx, { subject: "Mathematics" })).toBe(4);
    expect(await PracticeService.countBankPool(ctx, { subject: "Mathematics", difficulty: "easy" })).toBe(2);
    expect(await PracticeService.countBankPool(ctx, { subject: "Mathematics", chapter: "Polynomials" })).toBe(1);
  });

  it("is ZERO for a combination the bank cannot serve — the dead end", async () => {
    // Polynomials holds one hard question and nothing easy.
    expect(await PracticeService.countBankPool(ctx, { subject: "Mathematics", chapter: "Polynomials", difficulty: "easy" })).toBe(0);
  });

  it("CONTROL: the same selection with a difficulty the chapter has is not zero", async () => {
    expect(await PracticeService.countBankPool(ctx, { subject: "Mathematics", chapter: "Polynomials", difficulty: "hard" })).toBe(1);
  });

  it("treats 'mixed' as no difficulty filter at all", async () => {
    expect(await PracticeService.countBankPool(ctx, { subject: "Mathematics", difficulty: "mixed" })).toBe(4);
  });

  it("asks for the count, not the questions", async () => {
    await PracticeService.countBankPool(ctx, {});
    expect(headRange, "a count must not pull a page of rows").toEqual([[0, 0]]);
  });

  it("is zero when the class cannot be resolved, rather than counting another class's bank", async () => {
    vi.spyOn(PracticeService, "resolveCurriculumScope").mockResolvedValue({
      classLevel: null, board: "rbse", stream: null, classLabel: null, examId: null, examCode: null, examName: null,
    });
    expect(await PracticeService.countBankPool(ctx, {})).toBe(0);
  });
});
