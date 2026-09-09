/**
 * TestService — the Tests feature, on `tests` + `test_questions` +
 * `test_attempts` + `test_answers` (Chunk 7.5).
 *
 * ── WHY THIS FILE WAS REWRITTEN, 2026-09-09 ──────────────────────────────
 *
 * Chunk 7.5 replaced `tests.class_id` with `section_subject_id` (§10.22) and
 * dropped `is_published` in favour of `status`. The READ half of this file was
 * updated for that and the WRITE half was not, so every teacher write path was
 * addressed to a table shape that had not existed for weeks:
 *
 *   sent, and not on `tests`   class_id · subject · is_published ·
 *                              question_count · subject_id · max_marks
 *   required, and not sent     section_subject_id (NOT NULL)
 *                              max_mark          (NOT NULL, and the real
 *                                                 column is SINGULAR)
 *
 * `create` sent all six phantom columns, and its fallback insert repeated the
 * same defect, so the retry could not rescue the first attempt. `update`,
 * `publish`, `archive`, `schedule`, `setQuestions` and `remove` each read
 * `class_id` off a row that has none — `String(undefined)`, the literal
 * "undefined", handed to the class-ownership guard.
 *
 * Measured as the caller before the rewrite (probe37):
 *
 *     ERROR: column "class_id" of relation "tests" does not exist
 *
 * and in the data: 72 tests, 0 published, `tests.status` holding exactly one
 * value across the whole database. Not one test in this project was ever
 * created through the app; all 72 arrived from seed SQL.
 *
 * Two database faults were fixed alongside, because the client could not work
 * without them:
 *
 *   20260915000000  `tests_insert` checked `can_manage_test(id)` — a lookup of
 *                   the row being inserted, which does not exist yet, so every
 *                   INSERT was refused. It now tests the NEW row's values.
 *   20260915010000  `tests_status_check` refused 'scheduled' and 'archived',
 *                   two of the four statuses this file writes and the builder
 *                   offers as buttons.
 *
 * ── WHAT IS LOAD-BEARING HERE ────────────────────────────────────────────
 *
 *   - A test anchors on section_subject (§10.22), not on a class. Listing for
 *     a class resolves through `section_subjects` rather than a second
 *     class_id column naming the same fact (G9). Creating one resolves the
 *     other way, and REFUSES rather than guessing when the class teaches more
 *     than one subject and the caller named none.
 *   - Students never receive `correct`. `test_questions` is not SELECT-able by
 *     them at all; the paper comes from `rpc_test_questions_for_attempt`,
 *     which omits the answer key (G14).
 *   - The principal creates nothing. §10: "Cannot create or edit any record
 *     except announcements." The previous guard admitted them through
 *     `isSchoolOperator`, which is admin OR principal.
 */
import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import type { Json } from "@/integrations/supabase/types";
import { emitEvent } from "../repository/eventsRepository";
import { broadcastAcademicWrite } from "../live";
import { assertTeacherOwnsClass } from "../repository/teacherClassesRepository";
import type { TestKind } from "./workLifecycle";
import { ValidationFailedError, AcademicRepositoryError } from "../repository/errors";

/**
 * The four states the builder offers and this file writes.
 *
 * `tests_status_check` admits these four plus 'submitted', which only seeded
 * rows carry — nothing in the application writes it, and it is kept in the
 * constraint because 72 rows would otherwise become un-updatable.
 */
export type TestStatus = "draft" | "scheduled" | "published" | "archived";

function afterTestWrite(
  ctx: ServiceContext,
  meta?: { classId?: string | null; studentId?: string | null; source?: string },
) {
  broadcastAcademicWrite(ctx.schoolId, ["test", "profile"], {
    classId: meta?.classId,
    studentId: meta?.studentId,
    source: meta?.source ?? "TestService",
  });
}

export type ManualQuestionKind =
  | "mcq"
  | "true_false"
  | "fill"
  | "short"
  | "long"
  | "numerical";

export interface CreateTestInput {
  classId: string;
  title: string;
  subject?: string;
  subjectId?: string | null;
  testKind?: TestKind | string;
  difficulty?: string;
  duration_sec?: number;
  maxMarks?: number | null;
  passingMarks?: number | null;
  chapters?: string[];
  topics?: string[];
  instructions?: string | null;
  status?: TestStatus | string;
  scheduledPublishAt?: string | null;
  /** Upload-paper mode: file metadata shown to students */
  paperAttachments?: { name: string; url: string; mimeType?: string }[];
}

export type UpdateTestInput = Partial<CreateTestInput>;

export interface ManualQuestionInput {
  kind: ManualQuestionKind;
  question: string;
  options?: string[];
  correct?: string | string[] | number | boolean;
  marks?: number;
  explanation?: string | null;
}

/**
 * The builder's kind -> `test_questions.question_format`.
 *
 * THE COLUMN IS `question_format`, NOT `kind`. This mapper existed and its
 * result was written to a `kind` column that `public.test_questions` does not
 * have, behind an `.insert(rows as never)` cast — so PostgREST rejected every
 * manual test's questions with `PGRST204` and no manually-built test ever saved
 * one. Same shape as KNOWN_ISSUES 11's `school_id`, in a different table.
 *
 * `long` is no longer collapsed into `short`: the column carries it, and a long
 * answer is budgeted and printed differently from a short one.
 *
 * `fill` maps to `short` because a fill-in-the-blank is prose a person reads —
 * §10.24 auto-marks only structured answers, and jsonb equality on free text is
 * a lottery, not marking.
 */
function mapKindToFormat(kind: ManualQuestionKind): "mcq" | "numerical" | "short" | "long" {
  if (kind === "mcq" || kind === "true_false") return "mcq";
  if (kind === "numerical") return "numerical";
  if (kind === "long") return "long";
  return "short";
}

/** True when the format is auto-marked by `rpc_test_submit`'s jsonb equality. */
function isAutoMarked(format: string): boolean {
  return format === "mcq" || format === "multi" || format === "numerical";
}

function toOptions(kind: ManualQuestionKind, options?: string[]): Json {
  if (kind === "true_false") return ["True", "False"];
  return options ?? [];
}

function toCorrect(
  kind: ManualQuestionKind,
  correct?: ManualQuestionInput["correct"],
  options?: string[],
): Json {
  // Grader (rpc_test_submit) expects: MCQ/TF → {indexes:[i]}, numerical → {value}, short → {text}
  if (kind === "true_false") {
    const opts = toOptions(kind, options) as string[];
    const isTrue = correct === true || correct === "True" || correct === "true" || correct === 0 || correct === "0";
    const idx = isTrue ? 0 : 1;
    // Prefer matching option text if provided
    if (typeof correct === "string") {
      const found = opts.findIndex((o) => o.toLowerCase() === correct.toLowerCase());
      if (found >= 0) return { indexes: [found] };
    }
    return { indexes: [idx] };
  }
  if (kind === "mcq") {
    if (typeof correct === "number" && Number.isFinite(correct)) return { indexes: [correct] };
    if (typeof correct === "boolean") return { indexes: [correct ? 0 : 1] };
    if (typeof correct === "string" && options?.length) {
      const found = options.findIndex((o) => o === correct || o.toLowerCase() === correct.toLowerCase());
      if (found >= 0) return { indexes: [found] };
      const asNum = Number(correct);
      if (Number.isInteger(asNum) && asNum >= 0 && asNum < options.length) return { indexes: [asNum] };
    }
    if (Array.isArray(correct)) {
      const idxs = correct
        .map((c) => {
          if (typeof c === "number") return c;
          if (typeof c === "string" && options?.length) {
            const found = options.findIndex((o) => o === c || o.toLowerCase() === c.toLowerCase());
            return found >= 0 ? found : Number(c);
          }
          return NaN;
        })
        .filter((n) => Number.isInteger(n) && n >= 0);
      if (idxs.length) return { indexes: idxs };
    }
    return { indexes: [] };
  }
  if (kind === "numerical") {
    if (typeof correct === "number") return { value: correct };
    if (typeof correct === "string" && correct.trim() !== "" && !Number.isNaN(Number(correct))) {
      return { value: Number(correct) };
    }
    return { value: 0 };
  }
  // short / long / fill
  if (Array.isArray(correct)) return { text: String(correct[0] ?? "") };
  if (correct == null) return { text: "" };
  return { text: String(correct) };
}

/**
 * Who may write a test.
 *
 * PRINCIPAL IS EXCLUDED, DELIBERATELY. This used to open with
 * `if (isSchoolOperator(ctx.role)) return;`, and `isSchoolOperator` is admin OR
 * principal — so a principal could create, edit, publish and delete tests.
 * §10: the principal "cannot create or edit any record except announcements".
 * `can_manage_test` and `can_create_test` in the database do not admit them
 * either, so this is the service agreeing with the fence rather than being the
 * only thing enforcing it.
 */
async function assertTeacherCanWriteTest(ctx: ServiceContext, classId: string) {
  if (ctx.role === "admin" || ctx.role === "super_admin") return;
  if (ctx.role !== "teacher") {
    throw new ForbiddenError("Only teachers and admins may manage tests");
  }
  // Class ownership only — subject soft-check was blocking real teachers
  await assertTeacherOwnsClass(toRepoContext(ctx), ctx.userId, classId);
}

/**
 * §10.22: a test anchors on the section-subject, not on a class. Creating one
 * therefore has to resolve `(class, subject) -> section_subject_id`.
 *
 * It REFUSES rather than picking when the class teaches several subjects and
 * the caller named none. Guessing here would file a Physics test under
 * Mathematics and there would be nothing on screen to show it had happened —
 * the test would simply appear in the wrong subject's analysis for the rest of
 * the year.
 */
async function resolveSectionSubjectId(
  ctx: ServiceContext,
  classId: string,
  subject?: string | null,
): Promise<string> {
  const { data, error } = await getClient(toRepoContext(ctx))
    .from("section_subjects")
    .select("id, curriculum_subjects(name)")
    .eq("section_id", classId)
    .eq("school_id", ctx.schoolId);
  throwIfError(error, "Failed to resolve the subject this test belongs to");

  const rows = (data ?? []) as { id: string; curriculum_subjects?: { name?: string } | null }[];
  const nameOf = (r: (typeof rows)[number]) => (r.curriculum_subjects?.name ?? "").trim();

  if (rows.length === 0) {
    throw new ValidationFailedError([
      {
        field: "classId",
        code: "no_section_subject",
        message:
          "This class has no subjects set up yet, so a test has nothing to anchor on (§10.22). " +
          "Add the subject to the section first.",
      },
    ]);
  }

  const wanted = (subject ?? "").trim().toLowerCase();
  if (wanted) {
    const hit = rows.find((r) => nameOf(r).toLowerCase() === wanted);
    if (hit) return hit.id;
  }
  if (rows.length === 1) return rows[0].id;

  throw new ValidationFailedError([
    {
      field: "subject",
      code: "ambiguous_subject",
      message:
        `Choose which subject this test is for. This class teaches: ` +
        rows.map(nameOf).filter(Boolean).join(", "),
    },
  ]);
}

/**
 * The class a fetched test belongs to, read back through its anchor.
 *
 * Every write path needs this for the ownership guard and for the live
 * broadcast. It used to be `String(row.class_id)` on a row that has no
 * `class_id`, which produced the string "undefined" and handed that to
 * `assertTeacherOwnsClass`. Throwing beats passing a fake id on: a guard given
 * nonsense refuses everyone, which reads as a permissions bug.
 */
function sectionIdOfTest(row: unknown): string {
  const ss = (row as { section_subjects?: { section_id?: string | null } | null } | null)
    ?.section_subjects;
  const id = ss?.section_id;
  if (!id) {
    throw new AcademicRepositoryError(
      "test_without_section",
      "This test does not resolve to a class — its section-subject anchor is missing.",
    );
  }
  return String(id);
}

/**
 * Sole source of truth for "may a student/parent see this test."
 *
 * `is_published` was a boolean beside `status`, which is the same fact twice
 * and drifts the moment one is written without the other (G9). Chunk 7.5 kept
 * the enum and dropped the boolean, so `status` is now the only place the
 * answer lives and there is nothing left to disagree with it.
 */
export function isPublishedFlag(row: Record<string, unknown>): boolean {
  return row.status === "published";
}

/* ── The test report (§10.25) ──────────────────────────────────────────────
 *
 * These shapes mirror the jsonb that `rpc_test_class_report` and
 * `rpc_test_student_report` build (20260916000000, corrected by
 * 20260916010000). They are hand-written because the RPCs return `jsonb`, so
 * the generated types can only say `Json` — there is nothing to derive from.
 *
 * Every numeric field is nullable on purpose. `class_average` is NULL when
 * nobody has submitted, and a student who never sat the test carries a NULL
 * `mark`. "Not measured" and "scored zero" are different facts and the UI must
 * not be able to conflate them by reading a 0 that the database never wrote.
 */

/** One row of the class list: every student in the section, submitted or not. */
export interface TestReportStudentRow {
  student_id: string;
  full_name: string | null;
  roll_number: string | number | null;
  /** NULL when this student did not submit — never 0. */
  mark: number | null;
  correct_count: number | null;
  total_count: number | null;
  submitted_at: string | null;
  submitted: boolean;
}

/** One ranked weakness. Only topics with at least one wrong answer appear. */
export interface TestReportTopicRow {
  topic: string;
  asked: number;
  wrong: number;
  wrong_pct: number | null;
}

export interface TestClassReport {
  test_id: string;
  title: string | null;
  max_mark: number | null;
  subject: string | null;
  submitted_count: number;
  /** NULL when nobody has submitted yet. */
  class_average: number | null;
  average_seconds_per_question: number | null;
  weakest_topics: TestReportTopicRow[];
  students: TestReportStudentRow[];
}

/** One question this student did not get right, with the topic on it. */
export interface TestReportWrongAnswer {
  question_id: string;
  order_index: number | null;
  question: string;
  topic: string;
  marks: number | null;
  question_format: string | null;
  /**
   * The choice list. `their_answer` and `correct_answer` are POSITIONS
   * (`{"indexes":[1]}`), not text, so without this there is nothing a screen
   * can render but raw jsonb. Added by `20260916020000`.
   */
  options: unknown;
  their_answer: unknown;
  correct_answer: unknown;
  explanation: string | null;
  /** False when they left it blank, which is not the same as answering wrong. */
  answered: boolean;
}

export interface TestStudentReport {
  test_id: string;
  student_id: string;
  full_name: string | null;
  mark: number | null;
  max_mark: number | null;
  correct_count: number | null;
  total_count: number | null;
  submitted_at: string | null;
  /**
   * Whether there is a submitted attempt at all.
   *
   * `wrong_answers` is empty in two completely different situations — they sat
   * it and got everything right, and they never sat it — and a screen that
   * renders both as "no wrong answers" states something false about the second
   * (G4). Added by `20260916020000`, which is also where the empty array for a
   * non-sitter comes from: before it, a student who had sat nothing received
   * every question of the paper with its correct answer.
   */
  submitted: boolean;
  wrong_answers: TestReportWrongAnswer[];
}

/** `tests` columns that describe when the test was created, for reuse below. */
const TEST_WITH_ANCHOR = "*, section_subjects(section_id, curriculum_subjects(name))";

/**
 * TestService — usable teacher workflows first.
 */
export const TestService = {
  async listForClass(
    ctx: ServiceContext,
    classId: string,
    opts?: { status?: string; testKind?: string },
  ) {
    assertCanConsume(ctx, "test");
    const repo = toRepoContext(ctx);
    // A test anchors on section_subject (§10.22), so the class is reached
    // through it rather than through a second class_id column naming the same
    // fact (G9). !inner makes this a filtering join: a test whose
    // section_subject belongs to another class is excluded by the join itself,
    // not by a post-filter that a forgotten call site could skip.
    let q = getClient(repo)
      .from("tests")
      .select("*, section_subjects!inner(section_id)")
      .eq("section_subjects.section_id", classId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (ctx.schoolId) {
      q = q.eq("school_id", ctx.schoolId);
    }

    const { data, error } = await q;
    // The pre-7.5 version retried without school_id when that column was
    // "missing". It is NOT missing on tests, and a retry that drops the
    // institution filter is a fence that disappears on error. Removed.
    throwIfError(error, "Failed to list tests");
    let rows = data ?? [];
    if (ctx.role === "student" || ctx.role === "parent") {
      rows = rows.filter((r) => isPublishedFlag(r as Record<string, unknown>));
    } else if (opts?.status) {
      rows = rows.filter((r) => String((r as { status?: string }).status ?? "") === opts.status);
    }
    if (opts?.testKind) {
      rows = rows.filter((r) => String((r as { test_kind?: string }).test_kind ?? "class_test") === opts.testKind);
    }
    return rows;
  },

  async get(ctx: ServiceContext, testId: string) {
    assertCanConsume(ctx, "test");
    // A test has no subject column of its own — it anchors on section_subject
    // (§10.22), so the subject is whatever that section teaches. `section_id`
    // comes back in the same round trip because every write path needs it for
    // the ownership guard.
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("tests")
      .select(TEST_WITH_ANCHOR)
      .eq("id", testId)
      .maybeSingle();
    throwIfError(error, "Failed to load test");
    if (!data) throw new ForbiddenError("Test not found");
    if (
      (ctx.role === "student" || ctx.role === "parent") &&
      !isPublishedFlag(data as Record<string, unknown>)
    ) {
      throw new ForbiddenError("This test is not published yet");
    }
    return data;
  },

  /**
   * The paper. Staff get the whole row including `correct`; students never do.
   *
   * G14: this used to `select("*")` for everyone, which meant the answer key
   * reached the client of the person about to sit the test. The fence is the
   * GRANT, so test_questions is no longer SELECT-able by students at all — a
   * student calling this path would get zero rows, not a filtered row. They
   * go through rpc_test_questions_for_attempt, whose RETURNS list omits
   * `correct` and `explanation`.
   */
  async listQuestions(ctx: ServiceContext, testId: string) {
    assertCanConsume(ctx, "test");
    // Enforce publish gate for students/parents (same as get)
    await this.get(ctx, testId);
    const client = getClient(toRepoContext(ctx));

    if (ctx.role === "student" || ctx.role === "parent") {
      const attemptId = await this.startAttempt(ctx, testId);
      const { data, error } = await client.rpc("rpc_test_questions_for_attempt", {
        _attempt_id: attemptId,
      } as never);
      throwIfError(error, "Failed to list questions");
      return (data ?? []) as Record<string, unknown>[];
    }

    const { data, error } = await client
      .from("test_questions")
      .select("*")
      .eq("test_id", testId)
      .order("order_index", { ascending: true });
    throwIfError(error, "Failed to list questions");
    return data ?? [];
  },

  async create(ctx: ServiceContext, input: CreateTestInput) {
    assertCanOwn(ctx, "test");
    await assertTeacherCanWriteTest(ctx, input.classId);
    if (!input.title?.trim()) {
      throw new ValidationFailedError([
        { field: "title", code: "required", message: "Test title is required" },
      ]);
    }

    // §10.22: resolve the anchor before anything else, so an ambiguous subject
    // fails before a row exists rather than after.
    const sectionSubjectId = await resolveSectionSubjectId(ctx, input.classId, input.subject);

    // `tests.max_mark` is NOT NULL with CHECK (max_mark > 0). The builder
    // already has the field and fills it from the question total in manual
    // mode, so asking for it is surfacing the table's own rule rather than
    // inventing one — and defaulting it would put a fabricated denominator on
    // every mark computed against this test.
    const maxMark = Number(input.maxMarks ?? 0);
    if (!Number.isFinite(maxMark) || maxMark <= 0) {
      throw new ValidationFailedError([
        {
          field: "maxMarks",
          code: "required",
          message: "Set the maximum mark for this test — every mark is scored against it.",
        },
      ]);
    }

    const status = (input.status ?? "draft") as string;
    const published = status === "published";
    const paperNote =
      input.paperAttachments && input.paperAttachments.length
        ? `\n\n[Paper attachments]\n${input.paperAttachments
            .map((a) => `- ${a.name}: ${a.url}`)
            .join("\n")}`
        : "";

    // Every key below is a column `public.tests` actually has. The previous
    // version sent six that it does not, then retried with a payload carrying
    // four of the same six — a fallback that repeated the defect it was there
    // to survive. There is no fallback now: one payload, addressed correctly.
    const row: Record<string, unknown> = {
      school_id: ctx.schoolId,
      section_subject_id: sectionSubjectId,
      created_by: ctx.userId,
      title: input.title.trim(),
      max_mark: Math.round(maxMark),
      total_marks: input.maxMarks ?? null,
      passing_marks: input.passingMarks ?? null,
      status,
      test_kind: input.testKind ?? "class_test",
      difficulty: input.difficulty ?? "medium",
      duration_sec: input.duration_sec ?? 1800,
      instructions: `${input.instructions ?? ""}${paperNote}`.trim() || null,
      chapter: input.chapters?.[0] ?? null,
      topic: input.topics?.[0] ?? null,
      chapters: input.chapters ?? [],
      topics: input.topics ?? [],
      scheduled_publish_at: input.scheduledPublishAt ?? null,
      published_at: published ? new Date().toISOString() : null,
    };

    const { data, error } = await getClient(toRepoContext(ctx))
      .from("tests")
      .insert(row as never)
      .select(TEST_WITH_ANCHOR)
      .single();
    throwIfError(error, "Failed to create test");

    const created = data as { id: string };
    if (published || status === "scheduled") {
      await emitEvent(toRepoContext(ctx), {
        eventType: published ? "test.published" : "test.scheduled",
        entityType: "test",
        entityId: created.id,
        classId: input.classId,
        payload: {
          title: input.title,
          subject: input.subject,
          testKind: input.testKind ?? "class_test",
        },
      }).catch(() => undefined);
    }
    afterTestWrite(ctx, {
      classId: input.classId,
      source: "TestService.create",
    });
    return data;
  },

  /** Replace all questions for a test (manual builder). */
  async setQuestions(ctx: ServiceContext, testId: string, questions: ManualQuestionInput[]) {
    assertCanOwn(ctx, "test");
    const repo = toRepoContext(ctx);
    const test = await this.get(ctx, testId);
    const classId = sectionIdOfTest(test);
    await assertTeacherCanWriteTest(ctx, classId);

    await getClient(repo).from("test_questions").delete().eq("test_id", testId);

    if (questions.length === 0) {
      // `question_count` was written here and does not exist on `tests`. The
      // count is derivable from test_questions and storing it would be the
      // same fact twice (G9), so it is simply not stored.
      await getClient(repo)
        .from("tests")
        .update({ total_marks: 0, updated_at: new Date().toISOString() } as never)
        .eq("id", testId);
      return [];
    }

    const rows = questions.map((q, i) => {
      const question_format = mapKindToFormat(q.kind);
      const auto = isAutoMarked(question_format);
      // `test_questions_shape_matches_format` (20260914050000) refuses a row
      // that carries both, and refuses a written question with no `answer`.
      // The two branches are the constraint, restated where the row is built.
      const key = toCorrect(q.kind, q.correct, q.options);
      return {
        test_id: testId,
        order_index: i,
        question_format,
        question: q.question.trim(),
        options: toOptions(q.kind, q.options),
        correct: auto ? key : null,
        answer: auto
          ? null
          // A written question's model answer is TEXT, not jsonb. `toCorrect`
          // returns `{text}` for these kinds, so the string comes out of there.
          : String((key as { text?: unknown })?.text ?? "").trim() || "(no model answer given)",
        marks: q.marks ?? 1,
        explanation: q.explanation ?? null,
        school_id: ctx.schoolId,
      };
    });

    const { data, error } = await getClient(repo)
      .from("test_questions")
      .insert(rows)
      .select("*");
    throwIfError(error, "Failed to save questions");

    const total = rows.reduce((s, r) => s + Number(r.marks), 0);
    await getClient(repo)
      .from("tests")
      .update({ total_marks: total, updated_at: new Date().toISOString() } as never)
      .eq("id", testId);

    afterTestWrite(ctx, { classId, source: "TestService.setQuestions" });
    return data ?? [];
  },

  async update(ctx: ServiceContext, testId: string, patch: UpdateTestInput) {
    assertCanOwn(ctx, "test");
    const repo = toRepoContext(ctx);
    const existing = await this.get(ctx, testId);
    const classId = sectionIdOfTest(existing);
    await assertTeacherCanWriteTest(ctx, classId);

    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.difficulty !== undefined) row.difficulty = patch.difficulty;
    if (patch.duration_sec !== undefined) row.duration_sec = patch.duration_sec;
    if (patch.instructions !== undefined) row.instructions = patch.instructions;
    if (patch.chapters?.[0] !== undefined) row.chapter = patch.chapters[0];
    if (patch.topics?.[0] !== undefined) row.topic = patch.topics[0];
    // `subject` is not a column on `tests` (§10.22 — it comes from the anchor),
    // and `max_marks` is not one either; the mark column is `max_mark`.
    if (patch.maxMarks !== undefined && patch.maxMarks !== null) {
      const m = Number(patch.maxMarks);
      if (!Number.isFinite(m) || m <= 0) {
        throw new ValidationFailedError([
          { field: "maxMarks", code: "invalid", message: "Maximum mark must be greater than zero." },
        ]);
      }
      row.total_marks = patch.maxMarks;
      row.max_mark = Math.round(m);
    }
    if (patch.passingMarks !== undefined) row.passing_marks = patch.passingMarks;
    if (patch.testKind !== undefined) row.test_kind = patch.testKind;
    if (patch.chapters !== undefined) row.chapters = patch.chapters;
    if (patch.topics !== undefined) row.topics = patch.topics;
    if (patch.status !== undefined) {
      row.status = patch.status;
      // `is_published` was set here in lockstep with status. The column is
      // gone; `status` is the single source (see isPublishedFlag).
      if (patch.status === "published") row.published_at = new Date().toISOString();
    }
    if (patch.scheduledPublishAt !== undefined) {
      row.scheduled_publish_at = patch.scheduledPublishAt;
    }

    const { data, error } = await getClient(repo)
      .from("tests")
      .update(row as never)
      .eq("id", testId)
      .select(TEST_WITH_ANCHOR)
      .single();
    throwIfError(error, "Failed to update test");
    afterTestWrite(ctx, { classId, source: "TestService.update" });
    return data;
  },

  async publish(ctx: ServiceContext, testId: string) {
    assertCanOwn(ctx, "test");
    const repo = toRepoContext(ctx);
    const existing = (await this.get(ctx, testId)) as Record<string, unknown>;
    const classId = sectionIdOfTest(existing);
    await assertTeacherCanWriteTest(ctx, classId);

    const now = new Date().toISOString();
    const { data, error } = await getClient(repo)
      .from("tests")
      .update({ status: "published", published_at: now, updated_at: now } as never)
      .eq("id", testId)
      .select(TEST_WITH_ANCHOR)
      .single();
    throwIfError(error, "Failed to publish test");
    await emitEvent(repo, {
      eventType: "test.published",
      entityType: "test",
      entityId: testId,
      classId,
      payload: {
        title: existing.title,
        subject: subjectOfTest(existing),
        testKind: (existing.test_kind as string) ?? "class_test",
      },
    }).catch(() => undefined);
    afterTestWrite(ctx, { classId, source: "TestService.publish" });
    return data;
  },

  async archive(ctx: ServiceContext, testId: string) {
    assertCanOwn(ctx, "test");
    const existing = await this.get(ctx, testId);
    const classId = sectionIdOfTest(existing);
    await assertTeacherCanWriteTest(ctx, classId);
    const now = new Date().toISOString();
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("tests")
      .update({ status: "archived", archived_at: now, updated_at: now } as never)
      .eq("id", testId)
      .select(TEST_WITH_ANCHOR)
      .single();
    throwIfError(error, "Failed to archive test");
    afterTestWrite(ctx, { classId, source: "TestService.archive" });
    return data;
  },

  async schedule(ctx: ServiceContext, testId: string, at: string) {
    assertCanOwn(ctx, "test");
    const existing = (await this.get(ctx, testId)) as Record<string, unknown>;
    const classId = sectionIdOfTest(existing);
    await assertTeacherCanWriteTest(ctx, classId);
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("tests")
      .update({
        status: "scheduled",
        scheduled_publish_at: at,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", testId)
      .select(TEST_WITH_ANCHOR)
      .single();
    throwIfError(error, "Failed to schedule test");
    await emitEvent(toRepoContext(ctx), {
      eventType: "test.scheduled",
      entityType: "test",
      entityId: testId,
      classId,
      payload: {
        title: existing.title,
        subject: subjectOfTest(existing),
        testKind: (existing.test_kind as string) ?? "class_test",
        scheduledPublishAt: at,
      },
    }).catch(() => undefined);
    afterTestWrite(ctx, { classId, source: "TestService.schedule" });
    return data;
  },

  async remove(ctx: ServiceContext, testId: string) {
    assertCanOwn(ctx, "test");
    const repo = toRepoContext(ctx);
    let classId: string | null = null;
    try {
      const existing = await this.get(ctx, testId);
      classId = sectionIdOfTest(existing);
      await assertTeacherCanWriteTest(ctx, classId);
    } catch {
      /* still attempt delete */
    }
    // STUDENT DATA IS CHECKED BEFORE ANYTHING IS DELETED, and the order matters.
    //
    // Two constraints now refuse this delete, for the same reason and with
    // different messages:
    //
    //   test_marks_test_fk          RESTRICT (20260904180000) — marks
    //   test_attempts_test_id_fkey  RESTRICT (20260904220000) — attempts
    //
    // Both are student data and must outlive the test row. `test_questions`
    // deliberately still CASCADEs: questions are the test's own body, not
    // student data, and are meaningless without their parent.
    //
    // These are separate requests with no transaction around them. Deleting
    // test_questions first and discovering a refusal second would leave the
    // test in place with its questions gone, and nothing to roll that back.
    // So both refusals are ANTICIPATED rather than caught: ask first, and stop
    // before touching anything.
    //
    // Marks are asked about first because a marked test is the commoner case
    // and names the more actionable thing.
    const { count: markCount, error: markErr } = await getClient(repo)
      .from("test_marks")
      .select("id", { count: "exact", head: true })
      .eq("test_id", testId);
    throwIfError(markErr, "Failed to check whether this test has marks");

    if ((markCount ?? 0) > 0) {
      throw new AcademicRepositoryError(
        "test_has_marks",
        `This test cannot be deleted: ${markCount} student mark(s) are recorded against it, ` +
          `and marks are kept even when a test is removed. Delete the marks first if that is really intended.`,
      );
    }

    const { count: attemptCount, error: attemptErr } = await getClient(repo)
      .from("test_attempts")
      .select("id", { count: "exact", head: true })
      .eq("test_id", testId);
    throwIfError(attemptErr, "Failed to check whether this test has attempts");

    if ((attemptCount ?? 0) > 0) {
      // Worth saying what an attempt IS, because a teacher looking at an
      // unmarked test will reasonably think nothing is attached to it. An
      // attempt with no mark is a student who opened the test and did not
      // submit, or who was force-closed and recorded as "Not given" — the
      // record a disputed result would be settled from.
      throw new AcademicRepositoryError(
        "test_has_attempts",
        `This test cannot be deleted: ${attemptCount} student attempt(s) are recorded against it. ` +
          `An attempt is kept even when no mark was given — it is the record of who sat the test ` +
          `and what happened, including students who did not submit.`,
      );
    }

    await getClient(repo).from("test_questions").delete().eq("test_id", testId);
    const { error } = await getClient(repo).from("tests").delete().eq("id", testId);
    // Belt and braces: a mark or an attempt written between the checks above
    // and this delete still reaches the constraint, and 23503 is unreadable to
    // a teacher. Which constraint fired decides which message is true, so the
    // name is read off the error rather than assumed — attributing an attempt
    // refusal to marks would send the teacher to look for marks that are not
    // there.
    if (error?.code === "23503") {
      const detail = `${error.message ?? ""} ${error.details ?? ""}`;
      if (detail.includes("test_attempts")) {
        throw new AcademicRepositoryError(
          "test_has_attempts",
          "This test cannot be deleted: a student attempt was recorded against it while the deletion was in progress.",
        );
      }
      if (detail.includes("test_marks")) {
        throw new AcademicRepositoryError(
          "test_has_marks",
          "This test cannot be deleted: marks were recorded against it while the deletion was in progress.",
        );
      }
      // A third constraint we do not know about. Say that, rather than
      // guessing at one of the two we do — a wrong-but-confident message is
      // worse here than an honest vague one.
      throw new AcademicRepositoryError(
        "test_has_dependent_records",
        "This test cannot be deleted: other records still refer to it.",
      );
    }
    throwIfError(error, "Failed to delete test");
    afterTestWrite(ctx, { classId, source: "TestService.remove" });
  },

  /**
   * How many questions each of these tests carries — staff only.
   *
   * The teacher's list used to read `question_count` off the test row. That
   * column does not exist on `tests`, so `t.question_count ?? 0` rendered
   * "0 Q" against every test ever built. The count is not stored, deliberately
   * (it would be the same fact as `test_questions` twice, G9), so it is
   * counted here instead.
   *
   * NOT folded into `listForClass`: `test_questions` is not SELECT-able by
   * students at all — the answer key fence is the GRANT (G14) — so embedding
   * a count in the shared list query would break the student's own test list.
   */
  async countQuestions(
    ctx: ServiceContext,
    testIds: string[],
  ): Promise<Record<string, number>> {
    assertCanConsume(ctx, "test");
    if (ctx.role === "student" || ctx.role === "parent") {
      throw new ForbiddenError("Question counts are staff-only");
    }
    if (!testIds.length) return {};
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("test_questions")
      .select("test_id")
      .in("test_id", testIds);
    throwIfError(error, "Failed to count test questions");
    const counts: Record<string, number> = {};
    for (const id of testIds) counts[id] = 0;
    for (const row of (data ?? []) as { test_id: string }[]) {
      counts[row.test_id] = (counts[row.test_id] ?? 0) + 1;
    }
    return counts;
  },

  /**
   * The class's test report (§10.25) — class average, weakest topics ranked,
   * average time per question, and the full student list with marks.
   *
   * ── WHY THERE IS NO ROLE CHECK IN THIS FUNCTION ─────────────────────────
   *
   * `rpc_test_class_report` calls `can_read_test_report`, which is the ONLY
   * place in the system that decides who may read a report. Restating the rule
   * here would put the same fact in two homes (G9), and the two would disagree
   * the moment one is widened — which is not hypothetical: the role set here is
   * contested against locked-decisions §10.25 and is expected to change.
   * Widening is meant to be one edit to that SQL function and nothing else.
   *
   * A caller who may not read gets 42501 from Postgres, screened into a
   * sentence by `throwIfError` + the page's `toErrorMessage`.
   */
  async classReport(ctx: ServiceContext, testId: string): Promise<TestClassReport | null> {
    const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_test_class_report", {
      _test_id: testId,
    });
    throwIfError(error, "Failed to load this test's class report");
    return (data ?? null) as TestClassReport | null;
  },

  /**
   * One student's part of the same report: their mark, and the questions they
   * did not get right with the topic on each.
   *
   * Fenced by `can_read_test_student_report` — the staff who may read the class
   * report, or that student themselves. Same reasoning as `classReport`: the
   * rule is not repeated here.
   */
  async studentReport(
    ctx: ServiceContext,
    testId: string,
    studentId: string,
  ): Promise<TestStudentReport | null> {
    const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_test_student_report", {
      _test_id: testId,
      _student_id: studentId,
    });
    throwIfError(error, "Failed to load this student's test report");
    return (data ?? null) as TestStudentReport | null;
  },

  /** Empty library framework — content added later. */
  async listQuestionLibrary(
    _ctx: ServiceContext,
    _filters: {
      board?: string;
      classLevel?: string;
      subject?: string;
      book?: string;
      chapter?: string;
      topic?: string;
      kind?: string;
      difficulty?: string;
    },
  ) {
    assertCanConsume(_ctx, "test");
    // Framework only — no content yet
    return [] as {
      id: string;
      question: string;
      kind: string;
      options: string[];
      correct: unknown;
      marks: number;
      difficulty: string;
      chapter: string;
      topic: string;
    }[];
  },

  /** Latest attempt for the current user on a Test/test (submitted preferred). */
  async getMyAttempt(ctx: ServiceContext, testId: string) {
    assertCanConsume(ctx, "student_test_attempt");
    const client = getClient(toRepoContext(ctx));
    let q = client
      .from("test_attempts")
      .select("*")
      .eq("test_id", testId)
      .order("started_at", { ascending: false })
      .limit(5);
    if (ctx.userId) q = q.eq("user_id", ctx.userId);
    const { data, error } = await q;
    throwIfError(error, "Failed to load test attempt");
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) return null;
    const submitted = rows.find(
      (r) => r.submitted_at != null || String(r.status ?? "") === "submitted",
    );
    return (submitted ?? rows[0]) as Record<string, unknown>;
  },

  /**
   * Latest attempts for a student across Tests (parent/teacher/operator read path).
   */
  async listLatestAttemptsForStudent(
    ctx: ServiceContext,
    studentId: string,
    testIds: string[],
  ): Promise<Record<string, Record<string, unknown>>> {
    assertCanConsume(ctx, "student_test_attempt");
    const { assertMayAccessStudent } = await import("./parentAccess");
    await assertMayAccessStudent(ctx, studentId);
    if (!testIds.length) return {};

    const client = getClient(toRepoContext(ctx));
    const { data: student, error: sErr } = await client
      .from("students")
      .select("id, user_id")
      .eq("id", studentId)
      .eq("school_id", ctx.schoolId)
      .maybeSingle();
    throwIfError(sErr, "Failed to load student for test attempts");
    if (!student) return {};

    let q = client
      .from("test_attempts")
      .select("*")
      .in("test_id", testIds)
      .order("started_at", { ascending: false })
      .limit(200);
    if (student.user_id) {
      q = q.or(`student_id.eq.${studentId},user_id.eq.${student.user_id}`);
    } else {
      q = q.eq("student_id", studentId);
    }
    const { data, error } = await q;
    throwIfError(error, "Failed to list student test attempts");

    const byTest: Record<string, Record<string, unknown>> = {};
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const testId = String(row.test_id ?? "");
      if (!testId || byTest[testId]) continue;
      const submitted =
        row.submitted_at != null || String(row.status ?? "") === "submitted";
      byTest[testId] = { ...row, _submitted: submitted };
    }
    return byTest;
  },

  async startAttempt(ctx: ServiceContext, testId: string) {
    assertCanOwn(ctx, "student_test_attempt");
    // Service-layer publish gate (RPC also enforces after migration applied)
    const test = (await this.get(ctx, testId)) as Record<string, unknown>;
    if (ctx.role === "student" && !isPublishedFlag(test)) {
      throw new ForbiddenError("This test is not published yet");
    }
    const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_test_start", {
      _test_id: testId,
    } as never);
    throwIfError(error, "Failed to start test attempt");
    return data;
  },

  /** Persist one mid-attempt answer — UI must not raw-upsert `test_answers`. */
  async saveAnswer(
    ctx: ServiceContext,
    args: {
      attemptId: string;
      questionId: string;
      response: Record<string, unknown>;
    },
  ): Promise<void> {
    assertCanOwn(ctx, "student_test_attempt");
    const client = getClient(toRepoContext(ctx));
    const { data: att, error: attErr } = await client
      .from("test_attempts")
      .select("status, submitted_at")
      .eq("id", args.attemptId)
      .maybeSingle();
    throwIfError(attErr, "Failed to load attempt");
    if (
      att &&
      (String(att.status ?? "") === "submitted" || att.submitted_at != null)
    ) {
      throw new ValidationFailedError([
        {
          field: "attemptId",
          code: "already_submitted",
          message: "This test is already submitted — answers are locked.",
        },
      ]);
    }
    // school_id is NOT NULL on test_answers, and its restrictive tenant fence
    // checks it on write. test_answers allowed it to be absent; this one does
    // not, which is the fence doing its job rather than an inconvenience.
    if (!ctx.schoolId) {
      throw new ForbiddenError("No institution in context — cannot save an answer");
    }
    const { error } = await client.from("test_answers").upsert(
      {
        attempt_id: args.attemptId,
        question_id: args.questionId,
        school_id: ctx.schoolId,
        response: args.response as never,
      },
      { onConflict: "attempt_id,question_id" },
    );
    throwIfError(error, "Failed to save test answer");
  },

  async listAnswers(ctx: ServiceContext, attemptId: string) {
    assertCanConsume(ctx, "student_test_attempt");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("test_answers")
      .select("*")
      .eq("attempt_id", attemptId);
    throwIfError(error, "Failed to list test answers");
    return data ?? [];
  },

  async submitAttempt(ctx: ServiceContext, attemptId: string, answers?: unknown) {
    assertCanOwn(ctx, "student_test_attempt");
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client.rpc("rpc_test_submit", {
      _attempt_id: attemptId,
      ...(answers != null ? { _answers: answers } : {}),
    } as never);
    throwIfError(error, "Failed to submit test attempt");

    // Prefer RPC jsonb; fall back to re-reading attempt (older void RPC).
    let result = data as {
      score?: number;
      total?: number;
      total_count?: number;
      correct_count?: number;
      accuracy?: number;
    } | null;
    if (result == null || (result.accuracy == null && result.total_count == null && result.total == null)) {
      const { data: att } = await client
        .from("test_attempts")
        .select("score, correct_count, total_count")
        .eq("id", attemptId)
        .maybeSingle();
      if (att) {
        const total = Number(att.total_count ?? 0);
        const correct = Number(att.correct_count ?? 0);
        result = {
          score: Number(att.score ?? 0),
          total_count: total,
          correct_count: correct,
          accuracy: total > 0 ? Math.round((1000 * correct) / total) / 10 : 0,
        };
      }
    }

    // Prefer ctx.studentId; fall back to attempt row so sync/parent fan-out always has an id
    let studentId = ctx.studentId ?? null;
    if (!studentId) {
      const { data: attRow } = await client
        .from("test_attempts")
        .select("student_id, user_id")
        .eq("id", attemptId)
        .maybeSingle();
      if (attRow?.student_id) {
        studentId = String(attRow.student_id);
      } else if (attRow?.user_id) {
        const { data: stu } = await client
          .from("students")
          .select("id")
          .eq("user_id", attRow.user_id)
          .eq("school_id", ctx.schoolId)
          .maybeSingle();
        if (stu?.id) studentId = String(stu.id);
      }
    }

    await emitEvent(toRepoContext(ctx), {
      eventType: "test.attempt.completed",
      entityType: "student_test_attempt",
      entityId: attemptId,
      studentId,
      payload: {
        score: result?.score ?? null,
        accuracy: result?.accuracy ?? null,
      },
    }).catch(() => undefined);
    const { notifyStudentXpUpdated } = await import("@/lib/studentXpNotify");
    broadcastAcademicWrite(ctx.schoolId, ["test", "xp", "profile"], {
      studentId,
      source: "TestService.submitAttempt",
    });
    notifyStudentXpUpdated();

    try {
      const { ProgressionService } = await import("./progressionService");
      await ProgressionService.awardSafe(ctx, {
        ruleCode: "test.attempt",
        sourceType: "student_test_attempt",
        sourceId: attemptId,
        idempotencyKey: `test.attempt:${attemptId}`,
      });
      const total = Number(result?.total_count ?? result?.total ?? 0);
      const accuracy =
        typeof result?.accuracy === "number"
          ? result.accuracy
          : total > 0
            ? Math.round(
                (1000 * Number(result?.correct_count ?? result?.score ?? 0)) / total,
              ) / 10
            : null;
      if (accuracy != null && accuracy >= 90) {
        await ProgressionService.awardSafe(ctx, {
          ruleCode: "test.high_accuracy",
          sourceType: "student_test_attempt",
          sourceId: attemptId,
          idempotencyKey: `test.high:${attemptId}`,
          meta: { accuracy },
        });
      }
      await ProgressionService.notifyExternalXpChange(ctx, {
        source: "test.attempt.completed",
        attempt_id: attemptId,
      });
    } catch {
      /* optional until migration applied */
    }

    return result ?? data;
  },
};

/**
 * The subject a fetched test belongs to, read through its anchor.
 *
 * A test has no `subject` column (§10.22). Event payloads used to carry
 * `existing.subject`, which was always undefined on a row that does not have
 * it — so every `test.published` event went out with the subject missing.
 */
function subjectOfTest(row: unknown): string | undefined {
  const ss = (row as {
    section_subjects?: { curriculum_subjects?: { name?: string } | null } | null;
  } | null)?.section_subjects;
  return ss?.curriculum_subjects?.name ?? undefined;
}
