/**
 * A stream narrows content from Class 11. Not before.
 *
 * Wisdom Campus is tagged `commerce`, and the practice pool filtered EVERY
 * read with `stream.eq.commerce OR stream.is.null` whatever the class — so a
 * Class 10 student's bank was being narrowed by a stream they are not in.
 * Measured on the live bank 2026-09-23: all 15,186 active, approved questions
 * at Classes 5–10 carry a NULL stream, so nothing is lost TODAY; the filter is
 * a trap waiting for the first Class 9/10 question that is tagged, which would
 * then be invisible to exactly the students it was written for.
 *
 * The two subject allowlists already drew this line (`classLevel >= 11`);
 * `contentStreamForClass` is the same line for the question pool, and the
 * stub below applies the filter so a pool that ignored it cannot pass.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { contentStreamForClass } from "@/lib/curriculumScope";

type Row = { id: string; subject: string; chapter: string; topic_id: string | null; topics: null; stream: string | null };

let bank: Row[] = [];
let orFilters: string[] = [];
let catalogArgs: Record<string, unknown> | null = null;

const q = (id: string, stream: string | null): Row =>
  ({ id, subject: "Mathematics", chapter: "Real Numbers", topic_id: null, topics: null, stream });

vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context")>();
  return { ...actual, assertCanOwn: () => {}, assertCanConsume: () => {} };
});

vi.mock("../repository/base", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../repository/base")>();
  const builder = () => {
    let select = "";
    let wantCount = false;
    let range: [number, number] | null = null;
    const keep: Array<(r: Row) => boolean> = [];
    const self: Record<string, unknown> = {};
    self.select = (s: string, opts?: { count?: string }) => { select = s; wantCount = opts?.count === "exact"; return self; };
    for (const m of ["eq", "ilike", "not", "in", "order", "is"]) self[m] = () => self;
    self.or = (expr: string) => {
      orFilters.push(expr);
      // `stream.eq.commerce,stream.is.null` — the only or() this test is about.
      if (/^stream\./.test(expr)) {
        const wanted = expr.match(/stream\.eq\.([a-z]+)/)?.[1] ?? null;
        keep.push((r) => r.stream === null || r.stream === wanted);
      }
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
    getClient: () => ({
      from: () => builder(),
      rpc: (_name: string, args: Record<string, unknown>) => {
        catalogArgs = args;
        return Promise.resolve({ data: [], error: null });
      },
    }),
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

const atClass = (classLevel: number) =>
  vi.spyOn(PracticeService, "resolveCurriculumScope").mockResolvedValue({
    classLevel, board: "rbse", stream: "commerce", classLabel: `${classLevel}-A`,
    examId: null, examCode: null, examName: null, syllabusChapterIds: null,
  });

beforeEach(() => {
  orFilters = [];
  catalogArgs = null;
  bank = [q("untagged", null), q("science-tagged", "science"), q("commerce-tagged", "commerce")];
});

describe("contentStreamForClass", () => {
  it("is nothing below Class 11, and the school's stream from Class 11", () => {
    for (const level of [5, 8, 9, 10]) expect(contentStreamForClass("commerce", level), `class ${level}`).toBeNull();
    expect(contentStreamForClass("commerce", 11)).toBe("commerce");
    expect(contentStreamForClass("commerce", 12)).toBe("commerce");
  });

  it("keeps the stream when the class is unknown, and has none to apply without one", () => {
    // Conservative, like the subject allowlists: never widen on a guess.
    expect(contentStreamForClass("commerce", null)).toBe("commerce");
    expect(contentStreamForClass(null, 12)).toBeNull();
  });
});

describe("the question pool of a commerce-tagged school", () => {
  it("does not narrow a Class 10 student's bank by stream", async () => {
    atClass(10);
    const drawn = await PracticeService.listBankQuestions(ctx, { subject: "Mathematics", limit: 50 });
    expect(drawn.map((d) => d.id).sort()).toEqual(["commerce-tagged", "science-tagged", "untagged"]);
    expect(orFilters.filter((e) => e.startsWith("stream.")), "no stream filter belongs on a Class 10 read").toEqual([]);
  });

  it("CONTROL: it still narrows at Class 11, where a stream is real", async () => {
    atClass(11);
    const drawn = await PracticeService.listBankQuestions(ctx, { subject: "Mathematics", limit: 50 });
    expect(drawn.map((d) => d.id).sort()).toEqual(["commerce-tagged", "untagged"]);
    expect(orFilters.filter((e) => e.startsWith("stream."))).toEqual(["stream.eq.commerce,stream.is.null"]);
  });

  it("asks the bank catalog without a stream below Class 11, and with one above", async () => {
    atClass(10);
    await PracticeService.listBankCatalog(ctx, {});
    expect(catalogArgs).toMatchObject({ _class_level: 10, _board: "rbse" });
    expect(catalogArgs && "_stream" in catalogArgs).toBe(false);

    atClass(12);
    await PracticeService.listBankCatalog(ctx, {});
    expect(catalogArgs).toMatchObject({ _class_level: 12, _stream: "commerce" });
  });
});
