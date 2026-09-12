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

/**
 * One question on an online test: an MCQ, and only an MCQ.
 *
 * ── WHY THERE IS NO `kind` ANY MORE ──────────────────────────────────────
 *
 * This used to be `{ kind: ManualQuestionKind; correct?: string | string[] |
 * number | boolean }` over six kinds — mcq, true_false, fill, short, long,
 * numerical — mapped onto four `question_format` values. Three of the four
 * could not be marked by the only marker that exists (`rpc_test_submit`
 * compares `a.response = q.correct` as jsonb):
 *
 *   short, long   `correct` is NULL by constraint, so every written answer
 *                 scored zero, silently, and the class report then ranked its
 *                 topic 100% wrong. No screen in the product can mark them —
 *                 a teacher never marks an online test, that is the point.
 *   numerical     marks only on exact jsonb equality of a typed number, with
 *                 no tolerance expressible.
 *
 * Ruled 2026-09-12: "for the online test, only MCQ questions can be given …
 * the test automatically gets marked." `20260920020000` makes that structural
 * with a trigger on `test_questions`, so this type is the client agreeing with
 * the table rather than the only thing enforcing it.
 *
 * ── WHY `correctIndex` AND NOT `correct` ─────────────────────────────────
 *
 * The old shape accepted the correct answer as the option's TEXT, typed by
 * hand into a separate field ("Correct option text *"). A typo produced
 * `{indexes: []}` — a key naming no option — and every student's answer then
 * marked wrong with nothing on screen to show why. `20260914110000` refuses
 * that key at the database now, which turns a silent wrong-marking into a
 * refusal, but the right fix is to make the mistake unrepresentable: the
 * builder picks the correct option, and what travels is its index.
 */
export interface ManualQuestionInput {
  question: string;
  /** At least two, each non-empty. True/False is just two options. */
  options: string[];
  /** Index into `options`. The only shape `rpc_test_submit` can mark. */
  correctIndex: number;
  /** Whole numbers only — `tests.max_mark` and `test_marks.mark` are integers. */
  marks?: number;
  explanation?: string | null;
  chapter?: string | null;
  /** The topic this question tests (§10.22: tests carry topic per question). */
  topic?: string | null;
}

/**
 * Validate one question and shape it for `test_questions`.
 *
 * Exported for `testService.questions.test.ts`, which holds each refusal to the
 * database constraint it mirrors — a rule stated in two places is a rule that
 * drifts unless something compares them.
 *
 * Every refusal here is a refusal the database would make anyway — the shape
 * CHECK, the answer-key trigger, the markable-MCQ trigger — restated where the
 * question was written so the teacher is told which question and why, rather
 * than being handed a constraint name for a paper of twenty.
 */
export function toQuestionRow(
  q: ManualQuestionInput,
  index: number,
  testId: string,
  schoolId: string,
): Record<string, unknown> {
  const human = index + 1;
  const question = (q.question ?? "").trim();
  if (!question) {
    throw new ValidationFailedError([
      { field: `questions.${index}.question`, code: "required", message: `Question ${human} has no text.` },
    ]);
  }

  const options = (q.options ?? []).map((o) => String(o ?? "").trim());
  if (options.length < 2 || options.some((o) => o === "")) {
    throw new ValidationFailedError([
      {
        field: `questions.${index}.options`,
        code: "invalid",
        message: `Question ${human} needs at least two options, and none of them may be blank.`,
      },
    ]);
  }

  const correctIndex = Number(q.correctIndex);
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) {
    throw new ValidationFailedError([
      {
        field: `questions.${index}.correctIndex`,
        code: "invalid",
        message:
          `Question ${human} has no correct option marked. Pick which option is right — ` +
          `without it nothing could ever be marked correct.`,
      },
    ]);
  }

  const marks = q.marks == null ? 1 : Number(q.marks);
  if (!Number.isInteger(marks) || marks < 1) {
    throw new ValidationFailedError([
      {
        field: `questions.${index}.marks`,
        code: "invalid",
        message:
          `Question ${human} is worth ${q.marks} marks. Marks must be whole numbers of at least 1 — ` +
          `a fraction is rounded away by the integer mark columns every marks screen reads.`,
      },
    ]);
  }

  return {
    test_id: testId,
    school_id: schoolId,
    order_index: index,
    question_format: "mcq",
    question,
    options: options as unknown as Json,
    // A POSITION, never a label: this is what rpc_test_submit compares against.
    correct: { indexes: [correctIndex] } as unknown as Json,
    // NULL, by the shape constraint: `answer` is for written questions, and
    // there are none.
    answer: null,
    marks,
    explanation: q.explanation?.trim() || null,
    chapter: q.chapter?.trim() || null,
    concept: q.topic?.trim() || null,
  };
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
export async function resolveSectionSubjectId(
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
  /**
   * The leaderboard, as a position — "plus leaderboard" in the 2026-09-09
   * ruling. How many submitted attempts scored above this one, plus one.
   *
   * NULL when there is no submitted attempt: without that guard the database's
   * `count(*) WHERE score > NULL` is 0 and every non-sitter ranks first.
   *
   * No other student's name or mark is returned with it, deliberately
   * (20260916030000). A rank says where you stand without saying anything
   * about a named child, and a student may still never see the class list.
   */
  rank: number | null;
  class_size: number | null;
  wrong_answers: TestReportWrongAnswer[];
}

/* ── The tests list (20260920070000) ───────────────────────────────────────
 *
 * One row of `rpc_test_list_for_class`. Hand-written for the same reason as the
 * report shapes: the RPC returns `jsonb`, so the generated types can only say
 * `Json`.
 *
 * The role-dependent halves are nullable ON PURPOSE and are NOT interchangeable
 * with zero: `submitted_count` is null for a student because they are not told
 * how many classmates have handed in, and `my_status` is null for staff because
 * they are not sitting it. A screen that reads `submitted_count ?? 0` would
 * print "0 submitted" to a student as though nobody had.
 */
export interface TestListRow {
  id: string;
  title: string | null;
  status: string;
  test_kind: string | null;
  max_mark: number | null;
  total_marks: number | null;
  duration_sec: number | null;
  instructions: string | null;
  created_at: string;
  published_at: string | null;
  scheduled_publish_at: string | null;
  chapter: string | null;
  topic: string | null;
  /** From the section-subject anchor — `tests` has no subject column (§10.22). */
  subject: string | null;
  /** 0 means there is nothing to attempt: an uploaded paper, or an unwritten draft. */
  question_count: number;
  /** Staff only; null for a student. */
  submitted_count: number | null;
  /** Staff only; null for a student. */
  roll_count: number | null;
  /** Student only; null for staff. `'not_started' | 'in_progress' | 'submitted'`. */
  my_status: string | null;
  /** Student only. NULL until they submit — never 0 (§7). */
  my_mark: number | null;
  my_submitted_at: string | null;
}

/** One ranked entry on a test's leaderboard (20260920030000). */
export interface TestLeaderboardEntry {
  student_id: string;
  full_name: string | null;
  roll_number: string | number | null;
  mark: number | null;
  correct_count: number | null;
  total_count: number | null;
  submitted_at: string | null;
  /** Ties share a rank — the same definition as the student report's `rank`. */
  rank: number;
  is_me: boolean;
}

export interface TestLeaderboard {
  test_id: string;
  title: string | null;
  max_mark: number | null;
  subject: string | null;
  submitted_count: number;
  /** How many are on the section's roll, so "7 of 32" can be said. */
  roll_count: number;
  entries: TestLeaderboardEntry[];
}

/** One question of a student's own submitted paper (20260920050000). */
export interface TestAnswerSheetQuestion {
  question_id: string;
  order_index: number | null;
  question: string;
  options: unknown;
  question_format: string | null;
  marks: number | null;
  topic: string;
  their_answer: unknown;
  correct_answer: unknown;
  explanation: string | null;
  marks_awarded: number | null;
  /** False when they left it blank, which is not the same as answering wrong. */
  answered: boolean;
  is_correct: boolean;
  time_ms: number | null;
}

export interface TestAnswerSheet {
  test_id: string;
  student_id: string;
  title: string | null;
  max_mark: number | null;
  mark: number | null;
  correct_count: number | null;
  total_count: number | null;
  submitted_at: string | null;
  time_spent_sec: number | null;
  submitted: boolean;
  /** Empty until the paper is handed in — the key never travels before that. */
  questions: TestAnswerSheetQuestion[];
}

/** What each student of the section scored (20260920040000). */
export interface TestClassMarks {
  test_id: string;
  title: string | null;
  max_mark: number | null;
  subject: string | null;
  class_id: string;
  submitted_count: number;
  class_average: number | null;
  students: TestReportStudentRow[];
}

/** One MCQ from the shared question bank, ready to put on a paper. */
export interface BankQuestion {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string | null;
  classLevel: number | null;
  subject: string | null;
  chapter: string | null;
  topic: string | null;
  difficulty: string | null;
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
      // The subject rides along from the anchor. It used to be left out, and
      // four callers then read `row.subject` off a table that has no such
      // column (§10.22) — so every one of them rendered an empty subject.
      .select("*, section_subjects!inner(section_id, curriculum_subjects(name))")
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

  /**
   * The paper as the teacher built it, for editing.
   *
   * `listQuestions` above serves two audiences and shapes itself by role, which
   * is right for reading a paper and wrong for editing one: it returns raw
   * `test_questions` rows, where the key is jsonb (`{"indexes":[2]}`) and the
   * topic lives in `concept`. The builder speaks `correctIndex` and `topic`, so
   * one of the two has to translate — and doing it here, beside `toQuestionRow`
   * which translates the other way, keeps the pair in one file where they can
   * be read against each other.
   */
  async listQuestionsForEditing(
    ctx: ServiceContext,
    testId: string,
  ): Promise<(ManualQuestionInput & { id: string })[]> {
    assertCanOwn(ctx, "test");
    if (ctx.role === "student" || ctx.role === "parent") {
      throw new ForbiddenError("The answer key is staff-only");
    }
    const rows = (await this.listQuestions(ctx, testId)) as Record<string, unknown>[];
    return rows.map((r) => {
      const options = Array.isArray(r.options) ? (r.options as unknown[]).map((o) => String(o ?? "")) : [];
      const indexes = (r.correct as { indexes?: unknown } | null)?.indexes;
      // -1 rather than 0 when the key names nothing: a question whose key could
      // not be read must show as unanswered in the builder so the teacher fixes
      // it, not silently as option A.
      const correctIndex = Array.isArray(indexes) && typeof indexes[0] === "number" ? (indexes[0] as number) : -1;
      return {
        id: String(r.id ?? ""),
        question: String(r.question ?? ""),
        options,
        correctIndex,
        marks: Number(r.marks ?? 1),
        explanation: r.explanation == null ? null : String(r.explanation),
        chapter: r.chapter == null ? null : String(r.chapter),
        topic: r.concept == null ? null : String(r.concept),
      };
    });
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

  /**
   * Replace all questions for a test, and keep the mark totals honest.
   *
   * `tests.max_mark` is the denominator every mark on this test is scored
   * against, and it is written here as well as at create time: a paper whose
   * questions changed after it was created had a stale denominator, so a
   * student scoring 3 of 3 could be shown as 3 of 5. Both columns are set from
   * the same sum, which is the only figure that can be right.
   */
  async setQuestions(ctx: ServiceContext, testId: string, questions: ManualQuestionInput[]) {
    assertCanOwn(ctx, "test");
    const repo = toRepoContext(ctx);
    const test = await this.get(ctx, testId);
    const classId = sectionIdOfTest(test);
    await assertTeacherCanWriteTest(ctx, classId);
    if (!ctx.schoolId) {
      throw new ForbiddenError("No institution in context — cannot save questions");
    }

    // Validate the WHOLE paper before deleting anything. Deleting first and
    // failing on question 7 of 10 would leave the test with no questions at
    // all — and a published test with no questions is one a student is offered
    // and then refused by `rpc_test_start`.
    const rows = questions.map((q, i) => toQuestionRow(q, i, testId, ctx.schoolId));

    // A student may already have an attempt in flight. Replacing the paper
    // under them would make their saved answers point at deleted questions
    // (ON DELETE CASCADE removes those answers with them), so this refuses
    // rather than quietly discarding somebody's work.
    const { count: attemptCount, error: attemptErr } = await getClient(repo)
      .from("test_attempts")
      .select("id", { count: "exact", head: true })
      .eq("test_id", testId);
    throwIfError(attemptErr, "Failed to check whether this test has been attempted");
    if ((attemptCount ?? 0) > 0) {
      throw new AcademicRepositoryError(
        "test_has_attempts",
        `This test's questions cannot be changed: ${attemptCount} student attempt(s) are already recorded ` +
          `against it, and replacing a question would delete the answers given to it. ` +
          `Create a new test instead.`,
      );
    }

    await getClient(repo).from("test_questions").delete().eq("test_id", testId);

    if (rows.length === 0) {
      // `question_count` was written here and does not exist on `tests`. The
      // count is derivable from test_questions and storing it would be the
      // same fact twice (G9), so it is simply not stored.
      await getClient(repo)
        .from("tests")
        .update({ total_marks: 0, updated_at: new Date().toISOString() } as never)
        .eq("id", testId);
      afterTestWrite(ctx, { classId, source: "TestService.setQuestions" });
      return [];
    }

    const { data, error } = await getClient(repo)
      .from("test_questions")
      .insert(rows as never)
      .select("*");
    throwIfError(error, "Failed to save questions");

    const total = rows.reduce((s, r) => s + Number(r.marks), 0);
    await getClient(repo)
      .from("tests")
      .update({
        total_marks: total,
        max_mark: total,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", testId);

    afterTestWrite(ctx, { classId, source: "TestService.setQuestions" });
    return data ?? [];
  },

  /**
   * Build a whole test in the only order that is safe: DRAFT, then questions,
   * then publish or schedule.
   *
   * ── WHAT THIS REPLACES, AND WHY IT WAS WRONG ────────────────────────────
   *
   * The builder called `create` with `status: 'published'` and THEN wrote the
   * questions:
   *
   *     const created = await TestService.create(ctx, { ..., status: 'published' })
   *     if (questions.length) await TestService.setQuestions(ctx, created.id, ...)
   *
   * Between those two awaits the test was published with NO QUESTIONS. A
   * student refreshing their Tests screen in that window was offered a paper
   * `rpc_test_start` then refused with "test has no questions" — and if the
   * second call failed at all (one bad question is enough), the test STAYED
   * published and empty, permanently, with nothing on the teacher's screen to
   * say so.
   *
   * Publishing last also means a validation failure costs the teacher nothing:
   * the test exists as a draft with their questions in it, and they can fix the
   * one question that was refused instead of rebuilding the paper.
   */
  async createWithQuestions(
    ctx: ServiceContext,
    input: CreateTestInput,
    questions: ManualQuestionInput[],
    publish: { mode: "draft" } | { mode: "now" } | { mode: "schedule"; at: string },
  ) {
    // Validate the paper first, before a row exists. `toQuestionRow` needs a
    // test id it cannot have yet, so it is called with a placeholder purely to
    // run the checks — the real rows are built inside setQuestions.
    questions.forEach((q, i) => toQuestionRow(q, i, "00000000-0000-0000-0000-000000000000", ctx.schoolId ?? ""));

    const total = questions.reduce((s, q) => s + Number(q.marks ?? 1), 0);
    const created = (await this.create(ctx, {
      ...input,
      // The paper decides the denominator when there is one; the form's own
      // figure is only used for an uploaded paper with no questions here.
      maxMarks: questions.length > 0 ? total : (input.maxMarks ?? null),
      status: "draft",
      scheduledPublishAt: null,
    })) as { id: string };

    if (questions.length > 0) {
      await this.setQuestions(ctx, created.id, questions);
    }

    if (publish.mode === "now") return await this.publish(ctx, created.id);
    if (publish.mode === "schedule") return await this.schedule(ctx, created.id, publish.at);
    return await this.get(ctx, created.id);
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

  /**
   * The tests this teacher has set, for their own profile.
   *
   * The teacher's profile showed their name, subjects and linked accounts and
   * nothing about their work. "Check that the teacher's profile is updated with
   * the test they have given" (2026-09-12) is this: how many tests they have
   * set, how many are live, and how the class answered the recent ones.
   *
   * Both reads are the author's own rows — `can_read_test_row` admits
   * `_created_by = auth.uid()` and `test_attempts_staff_read` admits attempts
   * on tests they created — so this adds no fence and needs none.
   */
  async summaryForTeacher(
    ctx: ServiceContext,
    opts?: { limit?: number },
  ): Promise<{
    total: number;
    published: number;
    drafts: number;
    submissions: number;
    recent: {
      id: string;
      title: string;
      subject: string | null;
      status: string;
      createdAt: string | null;
      submittedCount: number;
    }[];
  }> {
    assertCanConsume(ctx, "test");
    if (!ctx.userId) {
      throw new ForbiddenError("No signed-in user — cannot list the tests you have set");
    }
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client
      .from("tests")
      .select("id, title, status, created_at, section_subjects(curriculum_subjects(name))")
      .eq("created_by", ctx.userId)
      .eq("school_id", ctx.schoolId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(200);
    throwIfError(error, "Failed to load the tests you have set");

    const rows = (data ?? []) as Record<string, unknown>[];
    const ids = rows.map((r) => String(r.id));

    // One request for every attempt across those tests, counted here rather
    // than asked for per test.
    const counts = new Map<string, number>();
    let submissions = 0;
    if (ids.length > 0) {
      const { data: attempts, error: attErr } = await client
        .from("test_attempts")
        .select("test_id, status")
        .in("test_id", ids)
        .eq("status", "submitted")
        .limit(5000);
      throwIfError(attErr, "Failed to count submissions on your tests");
      for (const a of (attempts ?? []) as { test_id: string }[]) {
        counts.set(a.test_id, (counts.get(a.test_id) ?? 0) + 1);
        submissions += 1;
      }
    }

    const statusOf = (r: Record<string, unknown>) => String(r.status ?? "draft");
    return {
      total: rows.length,
      published: rows.filter((r) => statusOf(r) === "published").length,
      drafts: rows.filter((r) => statusOf(r) === "draft" || statusOf(r) === "scheduled").length,
      submissions,
      recent: rows.slice(0, opts?.limit ?? 5).map((r) => ({
        id: String(r.id),
        title: String(r.title ?? "Test"),
        subject: subjectOfTest(r) ?? null,
        status: statusOf(r),
        createdAt: r.created_at ? String(r.created_at) : null,
        submittedCount: counts.get(String(r.id)) ?? 0,
      })),
    };
  },

  /**
   * A student's own recent test marks, newest first — the profile shows the
   * MARKS, not an average of them (v2 Screen 12).
   *
   * No extra fence is written here on purpose. `test_marks_read` already admits
   * `student_id IN my_own_or_children_student_ids()`, so a student reaches
   * their own row and a parent their child's, and staff reach the tests they
   * can read or manage. Re-stating that rule in the service is how the two
   * copies drift (G9); the policy is the one place it lives.
   */
  async listMarksForStudent(
    ctx: ServiceContext,
    studentId: string,
    limit = 10,
  ): Promise<{ testId: string; title: string; mark: number | null; maxMark: number | null; takenAt: string | null }[]> {
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("test_marks")
      .select("test_id, mark, created_at, tests(title, max_mark)")
      .eq("student_id", studentId)
      .order("created_at", { ascending: false })
      .limit(limit);
    throwIfError(error, "Failed to load test marks");
    return ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const t = row.tests as { title?: string; max_mark?: number } | null;
      return {
        testId: String(row.test_id ?? ""),
        title: t?.title ?? "Test",
        // NULL mark means not marked. It is never 0 (§7).
        mark: row.mark == null ? null : Number(row.mark),
        maxMark: t?.max_mark == null ? null : Number(t.max_mark),
        takenAt: row.created_at ? String(row.created_at) : null,
      };
    });
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
   * The tests of a class, with everything the two list screens need — through
   * `rpc_test_list_for_class` (20260920070000).
   *
   * ── WHY THIS EXISTS BESIDE `listForClass` ───────────────────────────────
   *
   * `listForClass` is a table read: the `tests` rows of a section, as rows.
   * Four callers want exactly that (the teacher's dashboard counts, the
   * insights tab, the student's calendar, the parent panel) and are served by
   * it unchanged.
   *
   * The two LIST SCREENS need three things no client can compute:
   *
   *   subject          `tests` has no subject column (§10.22) — it comes from
   *                    the section-subject anchor
   *   question_count   `test_questions` is closed to students (G14), so a
   *                    student's screen cannot tell an attemptable test from
   *                    an uploaded paper
   *   own state / how many submitted
   *                    `test_attempts` is the caller's own rows for a student
   *                    and the author's tests for staff, so neither side can
   *                    count what it needs
   *
   * The RPC shapes its payload by who asks: a student gets published tests and
   * their OWN attempt state; staff get every live test and the submitted
   * count. That asymmetry is the fence, not a convenience — see the migration.
   */
  async listForClassDetailed(
    ctx: ServiceContext,
    classId: string,
  ): Promise<TestListRow[]> {
    assertCanConsume(ctx, "test");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_test_list_for_class", {
      _class_id: classId,
    } as never);
    throwIfError(error, "Failed to load this class's tests");
    // The RPC returns `jsonb`, which the generated types can only describe as
    // `Json` — hence the hop through `unknown`. The shape is asserted by the
    // migration's own proof block, not by this cast.
    return ((data ?? []) as unknown as TestListRow[]) ?? [];
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

  /**
   * The question bank a teacher picks from — "choose from the questions".
   *
   * ── WHAT THIS REPLACES ──────────────────────────────────────────────────
   *
   * `listQuestionLibrary` returned `[]`, unconditionally, with the comment
   * "Framework only — no content yet" and a screen reading "Library coming
   * soon — NCERT content will be added later." Measured: `public.question_bank`
   * holds 21,696 rows, 21,681 of them approved and active, every one an MCQ,
   * every one carrying a chapter and a difficulty, across 516 chapters. The
   * content was there the whole time; the function was a stub.
   *
   * ── THE FOUR FILTERS THAT ARE NOT OPTIONAL ──────────────────────────────
   *
   *   is_approved   §10.20 makes approval a super-admin act and
   *                 `trg_question_bank_approval_is_super_admin_only` enforces
   *                 it. An unapproved row is a contribution nobody has vetted;
   *                 putting one on a test would publish it to a class and walk
   *                 straight around that rule.
   *   is_active     a retired or replaced question (15 rows) is not a question
   *                 to set.
   *   question_format = 'mcq'
   *                 an online test holds nothing else (20260920020000), and the
   *                 bank's own columns only ever held MCQs — `options` and
   *                 `correct_index` are NOT NULL.
   *   board         the same test `rpc_fill_paper_section_from_bank` applies:
   *                 this school's board, or a question marked 'both'. A CBSE
   *                 class is not set an RBSE paper because the filter was left
   *                 off.
   *
   * `correct_index` comes back as the INDEX it is. The builder hands it to
   * `setQuestions` as `correctIndex` and nothing converts a label anywhere.
   */
  async searchQuestionBank(
    ctx: ServiceContext,
    filters: {
      classLevel?: number | null;
      subject?: string | null;
      chapter?: string | null;
      topic?: string | null;
      difficulty?: string | null;
      search?: string | null;
      limit?: number;
    },
  ): Promise<BankQuestion[]> {
    assertCanOwn(ctx, "test");
    if (ctx.role === "student" || ctx.role === "parent") {
      throw new ForbiddenError("The question bank is staff-only");
    }
    const client = getClient(toRepoContext(ctx));

    // The school's board decides which questions are its own. Read once per
    // call rather than cached: a wrong board is a wrong paper.
    let board: string | null = null;
    if (ctx.schoolId) {
      const { data: school } = await client
        .from("schools")
        .select("board")
        .eq("id", ctx.schoolId)
        .maybeSingle();
      board = (school as { board?: string | null } | null)?.board ?? null;
    }

    let q = client
      .from("question_bank")
      // `question_bank` carries no marks column — what a question is worth is
      // the teacher's decision on their own paper, not the bank's.
      .select(
        "id, question, options, correct_index, explanation, class_level, subject, chapter, topic, concept, difficulty, board",
      )
      .eq("is_approved", true)
      .eq("is_active", true)
      .eq("question_format", "mcq")
      .limit(Math.min(Math.max(filters.limit ?? 40, 1), 100));

    // `schools.board` is CHECK-constrained to rbse|cbse|icse|other|both, so this
    // can only ever be one of five words — and it is still filtered before it
    // reaches a PostgREST `or`, because a value interpolated into a filter
    // string is the shape that breaks the day the constraint is widened.
    const safeBoard = board && /^[a-z_]+$/i.test(board) ? board : null;
    if (safeBoard) q = q.or(`board.eq.${safeBoard},board.eq.both`);
    if (filters.classLevel != null) q = q.eq("class_level", filters.classLevel);
    if (filters.subject) q = q.eq("subject", filters.subject);
    if (filters.chapter) q = q.eq("chapter", filters.chapter);
    if (filters.topic) q = q.eq("topic", filters.topic);
    if (filters.difficulty) q = q.eq("difficulty", filters.difficulty);
    if (filters.search?.trim()) q = q.ilike("question", `%${filters.search.trim()}%`);

    const { data, error } = await q;
    throwIfError(error, "Failed to search the question bank");

    return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id ?? ""),
      question: String(row.question ?? ""),
      options: Array.isArray(row.options) ? (row.options as unknown[]).map((o) => String(o ?? "")) : [],
      correctIndex: Number(row.correct_index ?? 0),
      explanation: row.explanation == null ? null : String(row.explanation),
      classLevel: row.class_level == null ? null : Number(row.class_level),
      subject: row.subject == null ? null : String(row.subject),
      chapter: row.chapter == null ? null : String(row.chapter),
      topic:
        row.topic == null || String(row.topic).trim() === ""
          ? row.concept == null
            ? null
            : String(row.concept)
          : String(row.topic),
      difficulty: row.difficulty == null ? null : String(row.difficulty),
    }));
  },

  /**
   * The chapters this class's bank actually has questions for, with how many.
   *
   * A chapter filter that offers a chapter with nothing behind it is worse than
   * no filter: the teacher picks it, sees an empty list, and cannot tell
   * whether the bank is empty or their filter is wrong.
   */
  async listBankChapters(
    ctx: ServiceContext,
    args: { classLevel: number; subject: string },
  ): Promise<{ chapter: string; count: number }[]> {
    assertCanOwn(ctx, "test");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("question_bank")
      .select("chapter")
      .eq("is_approved", true)
      .eq("is_active", true)
      .eq("question_format", "mcq")
      .eq("class_level", args.classLevel)
      .eq("subject", args.subject)
      .limit(5000);
    throwIfError(error, "Failed to list the bank's chapters");
    const counts = new Map<string, number>();
    for (const row of (data ?? []) as { chapter: string | null }[]) {
      const name = (row.chapter ?? "").trim();
      if (!name) continue;
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([chapter, count]) => ({ chapter, count }))
      .sort((a, b) => a.chapter.localeCompare(b.chapter));
  },

  /**
   * The per-test leaderboard (rule 13, 2026-09-12 ruling) — ranked, and
   * ordered so the first student to finish leads on equal marks.
   *
   * No role check here and none in the RPC's caller: `can_read_test_leaderboard`
   * is the only home for that rule (see 20260920030000). A caller who may not
   * read gets 42501, screened into a sentence by `throwIfError`.
   */
  async leaderboard(ctx: ServiceContext, testId: string): Promise<TestLeaderboard | null> {
    const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_test_leaderboard", {
      _test_id: testId,
    } as never);
    throwIfError(error, "Failed to load this test's leaderboard");
    return (data ?? null) as TestLeaderboard | null;
  },

  /**
   * One student's submitted paper, for review: every question with their own
   * answer, the key, the explanation and the time taken.
   *
   * Refused outright until the paper is handed in — that condition lives in
   * `can_read_test_student_report` and is the fence that stopped a student
   * reading the answer key before sitting (20260916020000).
   */
  async answerSheet(
    ctx: ServiceContext,
    testId: string,
    studentId: string,
  ): Promise<TestAnswerSheet | null> {
    const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_test_answer_sheet", {
      _test_id: testId,
      _student_id: studentId,
    } as never);
    throwIfError(error, "Failed to load this test paper");
    return (data ?? null) as TestAnswerSheet | null;
  },

  /**
   * What each student of the section scored — the principal's class tab, and
   * the one definition of that list (`rpc_test_class_report` composes it).
   *
   * Fenced by `can_read_test_marks`: the teachers of the section, or the
   * principal of that school. Not the admin, whose stated need is counts.
   */
  async classMarks(ctx: ServiceContext, testId: string): Promise<TestClassMarks | null> {
    const { data, error } = await getClient(toRepoContext(ctx)).rpc("rpc_test_class_marks", {
      _test_id: testId,
    } as never);
    throwIfError(error, "Failed to load this test's marks");
    return (data ?? null) as TestClassMarks | null;
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

  /**
   * Persist one mid-attempt answer — UI must not raw-upsert `test_answers`.
   *
   * `timeMs` is how long the student spent on THIS question. It is the only
   * source for §10.25's "average time per question", which the teacher's report
   * has always displayed and which was structurally NULL for every test ever
   * taken: the column existed and nothing ever wrote it.
   */
  async saveAnswer(
    ctx: ServiceContext,
    args: {
      attemptId: string;
      questionId: string;
      response: Record<string, unknown>;
      timeMs?: number | null;
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
    const timeMs =
      args.timeMs == null || !Number.isFinite(args.timeMs) || args.timeMs < 0
        ? null
        : Math.min(Math.round(args.timeMs), 86_400_000);

    const { error } = await client.from("test_answers").upsert(
      {
        attempt_id: args.attemptId,
        question_id: args.questionId,
        school_id: ctx.schoolId,
        response: args.response as never,
        ...(timeMs == null ? {} : { time_ms: timeMs }),
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

  /**
   * Hand the paper in, and grade it.
   *
   * `answers` is what the SCREEN is holding, and passing it is belt and braces
   * rather than the main path: each answer is already saved as it is chosen.
   * It matters for the one case the incremental saves cannot cover — an answer
   * whose own save failed (the attempt screen marks those "Not saved") still
   * reaches the marking, because `rpc_test_submit` upserts what it is given
   * before grading.
   *
   * Each entry is `{ question_id, response, time_ms? }`; `time_ms` is carried
   * through so a per-question timing that never made it to the server still
   * lands.
   */
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
