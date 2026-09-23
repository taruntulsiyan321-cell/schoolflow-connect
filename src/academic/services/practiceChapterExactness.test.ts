/**
 * A chapter session serves THAT chapter.
 *
 * Two defects, one screen. `academicLabelMatches` falls back to containment in
 * either direction, and the chapter narrowing was a raw PostgREST `or()`
 * string, whose grammar is comma and parenthesis delimited — so any chapter
 * carrying a comma had to be left out of the narrowing altogether, and the
 * containment match was then the only thing deciding.
 *
 * Measured over the live bank 2026-09-23: 34 ordered pairs of chapters in the
 * same class and subject contain one another —
 *
 *   Circles      <- Areas Related to Circles              (Mathematics 10)
 *   Triangles    <- Areas of Parallelograms and Triangles (Mathematics 9)
 *   Integrals    <- Application of Integrals              (Mathematics 12)
 *   Motion       <- Force and Laws of Motion              (Science 9)
 *   Resources    <- Human Resources, and two more         (Social Science 8)
 *
 * — and five chapters carry commas: "Acids, Bases and Salts", "Work, Energy
 * and Power", "Gender, Religion and Caste", "Depreciation, Provisions and
 * Reserves", "Private, Public and Global Enterprises".
 *
 * The stub applies the filters it is given, as PostgREST would. One that
 * ignored them would pass every assertion here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; subject: string; chapter: string; topic_id: string | null; topics: null };

let bank: Row[] = [];
let ilikeCalls: Array<[string, string]> = [];
let orCalls: string[] = [];

const q = (id: string, chapter: string, subject = "Mathematics"): Row =>
  ({ id, subject, chapter, topic_id: null, topics: null });

vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context")>();
  return { ...actual, assertCanOwn: () => {}, assertCanConsume: () => {} };
});

vi.mock("../repository/base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repository/base")>();
  const builder = () => {
    let select = "";
    let range: [number, number] | null = null;
    let wantCount = false;
    const keep: Array<(r: Row) => boolean> = [];
    const self: Record<string, unknown> = {};
    self.select = (s: string, opts?: { count?: string }) => { select = s; wantCount = opts?.count === "exact"; return self; };
    self.eq = () => self;
    self.not = () => self;
    self.in = () => self;
    self.order = () => self;
    self.or = (expr: string) => { orCalls.push(expr); return self; };
    self.ilike = (col: string, value: string) => {
      ilikeCalls.push([col, value]);
      // PostgREST's ilike with no wildcard is an exact, case-insensitive match
      // — and the value is a VALUE, commas and all.
      if (col === "chapter") keep.push((r) => r.chapter.toLowerCase() === value.toLowerCase());
      if (col === "subject") keep.push((r) => r.subject.toLowerCase() === value.toLowerCase());
      return self;
    };
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
  ilikeCalls = [];
  orCalls = [];
  bank = [
    q("circles-1", "Circles"), q("circles-2", "Circles"),
    q("areas-1", "Areas Related to Circles"), q("areas-2", "Areas Related to Circles"),
    q("acids-1", "Acids, Bases and Salts", "Science"), q("acids-2", "Acids, Bases and Salts", "Science"),
    q("metals-1", "Metals and Non-metals", "Science"),
  ];
  vi.spyOn(PracticeService, "resolveCurriculumScope").mockResolvedValue({
    classLevel: 10, board: "rbse", stream: null, classLabel: "10-A",
  });
});

describe("a chapter session serves that chapter", () => {
  it("does not pull in the chapter whose name contains it", async () => {
    const drawn = await PracticeService.listBankQuestions(ctx, { subject: "Mathematics", chapter: "Circles", limit: 50 });
    expect(drawn.map((d) => d.id).sort()).toEqual(["circles-1", "circles-2"]);
  });

  it("CONTROL: the bank really does hold the chapter that contains it", async () => {
    const drawn = await PracticeService.listBankQuestions(ctx, { subject: "Mathematics", chapter: "Areas Related to Circles", limit: 50 });
    expect(drawn.map((d) => d.id).sort()).toEqual(["areas-1", "areas-2"]);
  });

  /**
   * The un-narrowed retry is how a chapter stored under a slug or a mojibake
   * spelling stays reachable. It is also where containment used to decide,
   * because nothing had narrowed the pool.
   */
  it("keeps its exactness on the fallback pass, where nothing narrowed the pool", async () => {
    // Nothing matches the name exactly, so the narrowed pass comes back empty
    // and the un-narrowed retry runs over the whole subject — which is where
    // containment used to decide.
    bank = [q("slug-1", "arithmetic_progressions"), q("areas-1", "Areas Related to Arithmetic Progressions")];
    const drawn = await PracticeService.listBankQuestions(ctx, { subject: "Mathematics", chapter: "Arithmetic Progressions", limit: 50 });
    // The slugged spelling IS this chapter; the longer chapter is not.
    expect(drawn.map((d) => d.id)).toEqual(["slug-1"]);
  });

  it("narrows a chapter whose name has a comma in the DATABASE, not in the browser", async () => {
    const drawn = await PracticeService.listBankQuestions(ctx, { subject: "Science", chapter: "Acids, Bases and Salts", limit: 50 });
    expect(drawn.map((d) => d.id).sort()).toEqual(["acids-1", "acids-2"]);
    expect(
      ilikeCalls.some(([col, value]) => col === "chapter" && value === "Acids, Bases and Salts"),
      "the comma chapter must reach the database as a value",
    ).toBe(true);
    expect(
      orCalls.filter((e) => e.includes("chapter")),
      "a chapter must never be spliced into an or() string, where a comma is a separator",
    ).toEqual([]);
  });
});
