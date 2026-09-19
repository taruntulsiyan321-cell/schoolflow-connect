/**
 * A practice session is drawn from EVERY question its filters admit.
 *
 * listBankQuestions used to read a window of min(400, limit x 8) rows with no
 * order, and PostgREST returns such a read in the same physical order every
 * time — so it was the same rows on every request. Measured 2026-09-18 as the
 * Class 10 student: Subject Practice in Social Science drew from the same 160
 * of 953 questions, and Custom Practice across all subjects drew from an 80-row
 * window that was 62 English, 11 Maths and no Social Science or Hindi at all.
 *
 * Here the database is a stub serving a 2,500-question pool in pages, exactly
 * as PostgREST would: a page per .range(), at most 1,000 rows each.
 *
 * The same stub serves a small labelled bank for Weak Areas practice, whose
 * targets are matched in the browser after the pool is read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; subject: string; chapter: string; topic_id: string; topics: { name: string } };

const POOL: Row[] = Array.from({ length: 2500 }, (_, i) => ({
  id: `q-${String(i).padStart(5, "0")}`,
  subject: ["Mathematics", "Science", "Social Science", "English", "Hindi"][i % 5],
  chapter: `Chapter ${i % 25}`,
  topic_id: `t-${i % 100}`,
  topics: { name: `Topic ${i % 100}` },
}));

let pool: Row[] = POOL;

const calls = { ranges: [] as Array<[number, number]>, limits: [] as number[], textFetches: [] as string[][] };

vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context")>();
  return { ...actual, assertCanOwn: () => {}, assertCanConsume: () => {} };
});

vi.mock("../repository/base", () => {
  const builder = () => {
    let select = "";
    let range: [number, number] | null = null;
    let ids: string[] | null = null;
    const self: Record<string, unknown> = {};
    for (const m of ["eq", "or", "order", "ilike", "not", "gte", "lte", "is"]) self[m] = () => self;
    self.select = (s: string) => { select = s; return self; };
    self.limit = (n: number) => { calls.limits.push(n); range = [0, n - 1]; return self; };
    self.range = (a: number, b: number) => { calls.ranges.push([a, b]); range = [a, b]; return self; };
    self.in = (col: string, values: string[]) => { if (col === "id") ids = values; return self; };
    self.then = (resolve: (v: unknown) => unknown) => {
      if (select.includes("question")) {
        // The question text, for the drawn ids.
        calls.textFetches.push(ids ?? []);
        const rows = pool.filter((r) => (ids ?? []).includes(r.id)).map((r) => ({
          id: r.id, difficulty: "medium", question: `Question ${r.id}`, options: ["a", "b"], correct_index: 0, explanation: null,
        }));
        return resolve({ data: rows, error: null });
      }
      const [a, b] = range ?? [0, pool.length - 1];
      return resolve({ data: pool.slice(a, Math.min(b + 1, a + 1000)), error: null });
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
  pool = POOL;
  calls.ranges = [];
  calls.limits = [];
  calls.textFetches = [];
  vi.spyOn(PracticeService, "resolveCurriculumScope").mockResolvedValue({
    classLevel: 10, board: "rbse", stream: null, classLabel: "10-A",
  });
});

describe("a session is drawn from the whole pool", () => {
  it("reads every page of the pool, not a fixed window", async () => {
    await PracticeService.listBankQuestions(ctx, { limit: 20 });
    expect(calls.limits, "a .limit() window is how the same rows came back every time").toEqual([]);
    expect(calls.ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("fetches question text only for the questions drawn", async () => {
    const drawn = await PracticeService.listBankQuestions(ctx, { limit: 20 });
    expect(drawn).toHaveLength(20);
    expect(calls.textFetches).toHaveLength(1);
    expect(calls.textFetches[0]).toHaveLength(20);
    expect(new Set(calls.textFetches[0])).toEqual(new Set(drawn.map((q) => q.id)));
    expect(drawn.every((q) => q.question === `Question ${q.id}`)).toBe(true);
  });

  it("can ask any question in the pool — the last page as often as the first", async () => {
    const seenByPage = [0, 0, 0];
    for (let i = 0; i < 60; i++) {
      for (const q of await PracticeService.listBankQuestions(ctx, { limit: 20 })) {
        seenByPage[Math.floor(Number(q.id.slice(2)) / 1000)] += 1;
      }
    }
    // 1,200 draws over 1,000 / 1,000 / 500 rows: roughly 480 / 480 / 240.
    expect(seenByPage[0]).toBeGreaterThan(350);
    expect(seenByPage[1]).toBeGreaterThan(350);
    expect(seenByPage[2]).toBeGreaterThan(150);
  });

  it("varies between sessions", async () => {
    const a = (await PracticeService.listBankQuestions(ctx, { limit: 20 })).map((q) => q.id).sort();
    const b = (await PracticeService.listBankQuestions(ctx, { limit: 20 })).map((q) => q.id).sort();
    expect(a).not.toEqual(b);
  });

  it("covers every subject when no subject is chosen", async () => {
    const subjects = new Set<string>();
    for (let i = 0; i < 10; i++) {
      for (const q of await PracticeService.listBankQuestions(ctx, { limit: 20 })) subjects.add(q.subject);
    }
    expect([...subjects].sort()).toEqual(["English", "Hindi", "Mathematics", "Science", "Social Science"]);
  });
});

describe("a weak topic draws that topic, and nothing that merely shares words with it", () => {
  const bank = (chapter: string, topic: string, n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `${chapter}/${topic}/${i}`,
      subject: "Mathematics",
      chapter,
      topic_id: `${chapter}/${topic}`,
      topics: { name: topic },
    }));

  it("keeps each target inside its own topic and its own chapter", async () => {
    pool = [
      ...bank("Triangles", "Areas of Similar Triangles", 10),
      // Measured 2026-09-18: drawn into a Weak Areas session with no mastery
      // row of its own, because the weak topic above contains "Triangles".
      ...bank("Triangles", "Angle Bisector Theorem", 10),
      ...bank("Polynomials", "Zeroes of a Polynomial", 10),
      ...bank("Circles", "Introduction", 5),
      // Same topic name, a chapter whose name contains "Circles".
      ...bank("Areas Related to Circles", "Introduction", 5),
    ];
    const drawn = await PracticeService.listBankQuestions(ctx, {
      limit: 100,
      weakTargets: [
        { subject: "Mathematics", chapter: "Triangles", concept: "Areas of Similar Triangles" },
        // A mastery row with no topic of its own names its chapter: all of it.
        { subject: "Mathematics", chapter: "Polynomials", concept: "Polynomials" },
        { subject: "Mathematics", chapter: "Circles", concept: "Introduction" },
      ],
    });
    const drawnTopics = new Set(drawn.map((q) => q.id.split("/").slice(0, 2).join("/")));
    expect([...drawnTopics].sort()).toEqual([
      "Circles/Introduction",
      "Polynomials/Zeroes of a Polynomial",
      "Triangles/Areas of Similar Triangles",
    ]);
    expect(drawn).toHaveLength(25);
  });
});
