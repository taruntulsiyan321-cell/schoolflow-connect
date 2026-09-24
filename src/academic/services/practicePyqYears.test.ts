/**
 * The years Previous Year Questions offers are the years its pool can serve.
 *
 * listPyqYears and the PYQ pool are built on one scope (studentBankQuery), and
 * a previous-year question is defined once there: a question with an exam
 * year. The stub below APPLIES the filters it is given — a stub that ignored
 * them would pass every assertion here against a pool with no years in it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string; subject: string; chapter: string; topic_id: string | null; topics: null;
  exam_year: number | null; is_active: boolean; is_approved: boolean; class_level: number;
};

let bank: Row[] = [];
const row = (id: string, subject: string, exam_year: number | null, extra: Partial<Row> = {}): Row => ({
  id, subject, chapter: "Chapter", topic_id: null, topics: null, exam_year,
  is_active: true, is_approved: true, class_level: 10, ...extra,
});

vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context")>();
  return { ...actual, assertCanOwn: () => {}, assertCanConsume: () => {} };
});

vi.mock("../repository/base", () => {
  const builder = () => {
    let select = "";
    let wantCount = false;
    let range: [number, number] | null = null;
    const keep: Array<(r: Row) => boolean> = [];
    const self: Record<string, unknown> = {};
    self.select = (s: string, opts?: { count?: string }) => { select = s; wantCount = opts?.count === "exact"; return self; };
    self.eq = (col: keyof Row, v: unknown) => { keep.push((r) => r[col] === v); return self; };
    self.ilike = (col: keyof Row, v: string) => { keep.push((r) => String(r[col]).toLowerCase() === v.toLowerCase()); return self; };
    self.not = (col: keyof Row, op: string, v: unknown) => {
      if (op !== "is" || v !== null) throw new Error(`unexpected not(${String(col)}, ${op})`);
      keep.push((r) => r[col] !== null);
      return self;
    };
    self.in = (col: keyof Row, vs: unknown[]) => { keep.push((r) => vs.includes(r[col])); return self; };
    self.is = () => self;
    for (const m of ["or", "order"]) self[m] = () => self;   // board and stream: every row here is in scope
    self.range = (a: number, b: number) => { range = [a, b]; return self; };
    self.then = (resolve: (v: unknown) => unknown) => {
      const rows = bank.filter((r) => keep.every((k) => k(r)));
      if (select.includes("question")) {
        return resolve({ data: rows.map((r) => ({ id: r.id, difficulty: "medium", question: `Q ${r.id}`, options: ["a", "b"] })), error: null });
      }
      const [a, b] = range ?? [0, rows.length - 1];
      return resolve({ data: rows.slice(a, b + 1), count: wantCount ? rows.length : null, error: null });
    };
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
  bank = [
    row("m-2023-a", "Mathematics", 2023), row("m-2023-b", "Mathematics", 2023), row("m-2023-c", "Mathematics", 2023),
    row("s-2021-a", "Science", 2021), row("s-2021-b", "Science", 2021),
    row("m-none-a", "Mathematics", null), row("m-none-b", "Mathematics", null), row("s-none-a", "Science", null),
    // Retired, and a different class: in no pool, so in no year.
    row("m-2019-retired", "Mathematics", 2019, { is_active: false }),
    row("m-2018-class9", "Mathematics", 2018, { class_level: 9 }),
  ];
  vi.spyOn(PracticeService, "resolveCurriculumScope").mockResolvedValue({
    classLevel: 10, board: "rbse", stream: null, classLabel: "10-A", examId: null, examCode: null, examName: null,
  });
});

describe("the exam years a student is offered", () => {
  it("are the years the student's pool holds, newest first, each with its count", async () => {
    expect(await PracticeService.listPyqYears(ctx)).toEqual([
      { year: 2023, count: 3 },
      { year: 2021, count: 2 },
    ]);
  });

  it("narrow to the subject chosen", async () => {
    expect(await PracticeService.listPyqYears(ctx, { subject: "Science" })).toEqual([{ year: 2021, count: 2 }]);
  });

  it("are none when no question carries an exam year — the live bank today (KNOWN_ISSUES 57)", async () => {
    bank = bank.map((r) => ({ ...r, exam_year: null }));
    expect(await PracticeService.listPyqYears(ctx)).toEqual([]);
  });

  it("each start a session holding only that year's questions", async () => {
    for (const { year, count } of await PracticeService.listPyqYears(ctx)) {
      const drawn = await PracticeService.listBankQuestions(ctx, { pyqOnly: true, examYear: year, limit: 90 });
      expect(drawn, `year ${year}`).toHaveLength(count);
      expect(drawn.every((q) => bank.find((r) => r.id === q.id)?.exam_year === year)).toBe(true);
    }
  });
});

describe("a previous-year session", () => {
  it("draws only questions that name an exam year", async () => {
    const drawn = await PracticeService.listBankQuestions(ctx, { pyqOnly: true, limit: 90 });
    expect(drawn.map((q) => q.id).sort()).toEqual(["m-2023-a", "m-2023-b", "m-2023-c", "s-2021-a", "s-2021-b"]);
  });

  it("POSITIVE CONTROL: the same pool without the PYQ filter holds the questions that have no year", async () => {
    const drawn = await PracticeService.listBankQuestions(ctx, { limit: 90 });
    expect(drawn.map((q) => q.id)).toEqual(expect.arrayContaining(["m-none-a", "m-none-b", "s-none-a"]));
  });
});
