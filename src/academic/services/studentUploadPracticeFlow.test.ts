/**
 * Custom Practice upload flow — focused guards.
 * Spec: docs/custom-practice-upload-spec.md §4.3, §8, §9.1
 *
 * Covers: listForPractice row mapping, attempt snapshot (source=upload /
 * bankQuestionId null), and the honest refusal status path.
 * Fixtures only — no invented student names.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";

type FixtureRow = {
  id: string;
  question_text: string;
  options: string[] | null;
  correct_index: number | null;
  explanation: string | null;
  difficulty: string | null;
  chapter_id: string | null;
  answer_source: "file" | "ai";
  chapters: {
    name?: string;
    curriculum_subjects?: { name?: string } | null;
  } | null;
};

const FIXTURE_ROWS: FixtureRow[] = [
  {
    id: "uq-001",
    question_text: "What is the value of 7 × 8?",
    options: ["48", "54", "56", "64"],
    correct_index: 2,
    explanation: "7 × 8 = 56.",
    difficulty: "hard",
    chapter_id: "chapter-uuid-1",
    answer_source: "file",
    chapters: {
      name: "Integers",
      curriculum_subjects: { name: "Mathematics" },
    },
  },
  {
    id: "uq-002",
    question_text: "Simplify 3x + 2x.",
    options: ["5x", "6x", "x", "3x"],
    correct_index: 0,
    explanation: null,
    difficulty: null,
    chapter_id: null,
    answer_source: "ai",
    chapters: null,
  },
];

const queryCalls = {
  table: "" as string,
  eqs: [] as Array<[string, string]>,
  ilike: null as [string, string] | null,
  not: null as [string, string] | null,
  limit: null as number | null,
};

vi.mock("../repository/base", () => {
  const builder = () => {
    const self: Record<string, unknown> = {};
    for (const m of ["select", "order"]) self[m] = () => self;
    self.eq = (col: string, val: string) => {
      queryCalls.eqs.push([col, val]);
      return self;
    };
    self.ilike = (col: string, val: string) => {
      queryCalls.ilike = [col, val];
      return self;
    };
    self.not = (col: string, op: string, _val?: unknown) => {
      queryCalls.not = [col, op];
      return self;
    };
    self.limit = (n: number) => {
      queryCalls.limit = n;
      return self;
    };
    self.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: FIXTURE_ROWS, error: null });
    return self;
  };
  return {
    getClient: () => ({
      from: (table: string) => {
        queryCalls.table = table;
        return builder();
      },
    }),
    throwIfError: (error: unknown, message: string) => {
      if (error) throw new Error(message);
    },
  };
});

vi.mock("../storage/studentUploadFile", () => ({
  uploadStudentUploadFile: vi.fn(),
  STUDENT_UPLOAD_ACCEPT: "application/pdf,image/*",
}));

const { StudentUploadService, modesForVerdict } = await import("./studentUploadService");

const ctx = {
  schoolId: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  studentId: "00000000-0000-4000-8000-000000000003",
  role: "student" as const,
};

beforeEach(() => {
  queryCalls.table = "";
  queryCalls.eqs = [];
  queryCalls.ilike = null;
  queryCalls.not = null;
  queryCalls.limit = null;
});

describe("listForPractice mapping (§8)", () => {
  it("maps upload rows into the bank-shaped session payload", async () => {
    const rows = await StudentUploadService.listForPractice(
      ctx,
      "upload-uuid-1",
      "practise_all",
      20,
    );

    expect(queryCalls.table).toBe("student_upload_questions");
    expect(queryCalls.eqs).toEqual([
      ["upload_id", "upload-uuid-1"],
      ["owner_id", ctx.userId],
    ]);
    expect(queryCalls.limit).toBe(20);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      id: "uq-001",
      question: "What is the value of 7 × 8?",
      options: ["48", "54", "56", "64"],
      correct_index: 2,
      explanation: "7 × 8 = 56.",
      difficulty: "hard",
      subject: "Mathematics",
      chapter: "Integers",
      chapter_id: "chapter-uuid-1",
      from_upload: true,
      ai_answered: false,
    });
    expect(rows[1]).toMatchObject({
      id: "uq-002",
      question: "Simplify 3x + 2x.",
      difficulty: "medium",
      subject: null,
      chapter: null,
      chapter_id: null,
      from_upload: true,
      ai_answered: true,
    });
  });

  it("returns nothing for read_notes — that mode does not load questions", async () => {
    const rows = await StudentUploadService.listForPractice(
      ctx,
      "upload-uuid-1",
      "read_notes",
    );
    expect(rows).toEqual([]);
    expect(queryCalls.table).toBe("");
  });

  it("narrows practise_hard and practise_by_chapter at the query", async () => {
    await StudentUploadService.listForPractice(ctx, "upload-uuid-1", "practise_hard");
    expect(queryCalls.ilike).toEqual(["difficulty", "hard"]);

    queryCalls.ilike = null;
    await StudentUploadService.listForPractice(ctx, "upload-uuid-1", "practise_by_chapter");
    expect(queryCalls.not).toEqual(["chapter_id", "is"]);
  });

  it("narrows practise_from_notes to derived_from_note_id — never like practise_all", async () => {
    await StudentUploadService.listForPractice(ctx, "upload-uuid-1", "practise_from_notes");
    expect(queryCalls.table).toBe("student_upload_questions");
    expect(queryCalls.not).toEqual(["derived_from_note_id", "is"]);
    expect(queryCalls.ilike).toBeNull();
    // Positive control: practise_all must NOT add that filter.
    queryCalls.not = null;
    await StudentUploadService.listForPractice(ctx, "upload-uuid-1", "practise_all");
    expect(queryCalls.not).toBeNull();
  });
});

describe("attempt snapshot — upload source (§9.1)", () => {
  const practiceSource = stripComments(
    readFileSync(join(__dirname, "../../gurukul/pages/Practice.tsx"), "utf8"),
  );

  function section(startNeedle: string, endNeedle: string): string {
    const start = practiceSource.indexOf(startNeedle);
    expect(start, `${startNeedle} has moved or been renamed`).toBeGreaterThan(-1);
    const end = practiceSource.indexOf(endNeedle, start);
    expect(end, `${endNeedle} no longer follows ${startNeedle}`).toBeGreaterThan(start);
    return practiceSource.slice(start, end);
  }

  it("writes source=upload and bankQuestionId null for fromUpload questions", () => {
    const snap = section("function snapshotOf(", "function record(");
    expect(snap).toContain("const fromUpload = Boolean(q.fromUpload)");
    expect(snap).toContain("const fromCapture = Boolean(q.fromCapture)");
    expect(snap).toContain(
      'source: fromUpload ? "upload" : fromCapture ? "screen_capture" : "practice"',
    );
    expect(snap).toContain("bankQuestionId: privateQ ? null : q.id");
    expect(snap).toContain("uploadQuestionId: fromUpload ? q.id : null");
    expect(snap).toContain("captureQuestionId: fromCapture ? q.id : null");
    // Positive control: a bank attempt must still carry its id.
    expect(snap).toMatch(/bankQuestionId:\s*privateQ\s*\?\s*null\s*:\s*q\.id/);
    // Upload id goes on sourceId — never as bank_question_id.
    expect(snap).toContain("config.upload?.uploadId");
    // Subject comes from the question, not Mixed/General session placeholders.
    expect(snap).toContain("subject: q.subject");
    expect(snap).not.toMatch(/subject:\s*["']Mixed["']/);
    expect(snap).not.toMatch(/subject:\s*["']General["']/);
  });

  it("ConfigView onUploadMode does not set subject Mixed/General", () => {
    const start = practiceSource.indexOf("function onUploadMode(");
    expect(start, "onUploadMode has moved").toBeGreaterThan(-1);
    const end = practiceSource.indexOf("return (", start);
    const block = practiceSource.slice(start, end);
    expect(block).toContain('subject: ""');
    expect(block).not.toMatch(/subject:\s*["']Mixed["']/);
    expect(block).not.toMatch(/subject:\s*["']General["']/);
  });

  it("maps listForPractice from_upload onto BankQuestion.fromUpload", () => {
    const mapped = section("const mapped = rows", ".filter((x): x is BankQuestion => x !== null)");
    expect(mapped).toContain('"from_upload" in r && r.from_upload === true');
    expect(mapped).toContain("fromUpload,");
  });

  it("honest empty for practise_from_notes when no notes-derived questions", () => {
    const empty = section("if (qs.length === 0)", "if (!q) return null;");
    expect(empty).toContain('practiseMode === "practise_from_notes"');
    expect(empty).toContain("No questions written from these notes yet.");
  });
});

describe("refusal path status (§4.3)", () => {
  const uploadUi = stripComments(
    readFileSync(join(__dirname, "../../gurukul/components/CustomPracticeUpload.tsx"), "utf8"),
  );

  it("treats status=unusable or verdict=unusable as refused", () => {
    expect(uploadUi).toContain(
      'const refused = row.status === "unusable" || row.verdict === "unusable"',
    );
    expect(uploadUi).toContain("refused &&");
    expect(uploadUi).toContain("row.refusal_reason");
    // Modes only when ready — a refused upload must not offer practice buttons
    // via an empty-mode fallback.
    expect(uploadUi).toContain('row.status === "ready" && modes.length > 0');
  });

  it("statusLabel surfaces refusal_reason for failed and unusable", () => {
    const label = (() => {
      const start = uploadUi.indexOf("function statusLabel(");
      expect(start).toBeGreaterThan(-1);
      const end = uploadUi.indexOf("export function CustomPracticeUpload(", start);
      expect(end).toBeGreaterThan(start);
      return uploadUi.slice(start, end);
    })();
    expect(label).toContain('row.status === "failed"');
    expect(label).toContain('row.status === "unusable"');
    expect(label).toContain("row.refusal_reason");
  });

  it("modesForVerdict offers nothing for unusable — so refused uploads have no modes", () => {
    expect(modesForVerdict("unusable")).toEqual([]);
  });
});
