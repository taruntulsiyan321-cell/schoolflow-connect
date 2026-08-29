/**
 * TestService — the Tests feature, on `tests` + `test_questions` +
 * `test_attempts` + `test_answers` (Chunk 7.5).
 *
 * It previously ran on `tests`, which was a second implementation of the same
 * feature: Chunk 6 built `tests`/`test_marks` for the teacher-uploads-marks
 * flow while Test carried the student-takes-a-test-in-app flow, and both were
 * called "test".
 *
 * Two things here are NOT simple renames:
 *
 *   - A test anchors on section_subject (§10.22), not on a class. Listing for
 *     a class resolves through section_subjects rather than a second class_id
 *     column naming the same fact (G9).
 *   - Students never receive `correct`. test_questions is not SELECT-able by
 *     them at all; the paper comes from rpc_test_questions_for_attempt, which
 *     omits the answer key (G14).
 */
import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { emitEvent } from "../repository/eventsRepository";
import { broadcastAcademicWrite } from "../live";
import { assertTeacherOwnsClass } from "../repository/teacherClassesRepository";
import { isSchoolOperator } from "./context";
import type { TestKind } from "./workLifecycle";
import { ValidationFailedError } from "../repository/errors";

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

function mapKindToDb(kind: ManualQuestionKind): "mcq" | "multi" | "numerical" | "short" {
  if (kind === "mcq" || kind === "true_false") return "mcq";
  if (kind === "numerical") return "numerical";
  return "short";
}

function toOptions(kind: ManualQuestionKind, options?: string[]): unknown[] {
  if (kind === "true_false") return ["True", "False"];
  return options ?? [];
}

function toCorrect(
  kind: ManualQuestionKind,
  correct?: ManualQuestionInput["correct"],
  options?: string[],
): unknown {
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

async function assertTeacherCanWriteTest(ctx: ServiceContext, classId: string) {
  if (isSchoolOperator(ctx.role)) return;
  if (ctx.role !== "teacher") {
    throw new ForbiddenError("Only teachers may manage tests");
  }
  // Class ownership only — subject soft-check was blocking real teachers
  await assertTeacherOwnsClass(toRepoContext(ctx), ctx.userId, classId);
}

/**
 * Sole source of truth for "may a student/parent see this test." Every
 * write path (create/update/publish/archive/schedule) sets is_published in
 * lockstep with status, so trusting status as an alternative here only ever
 * adds risk, never legitimate coverage — a hand-edited or seeded row where
 * status="published" but is_published=false must stay hidden. Confirmed via
 * a live incident: a seeded draft Test with exactly that mismatch was
 * reachable and attemptable by a real student through this exact OR check.
 */
export function isPublishedFlag(row: Record<string, unknown>): boolean {
  // `is_published` was a boolean beside `status`, which is the same fact
  // twice and drifts the moment one is written without the other (G9). 7.5
  // kept the enum and dropped the boolean.
  return row.status === "published";
}

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
      rows = rows.filter((r) => String((r as { status?: string }).status ?? "") === opts.status
        || (opts.status === "published" && (r as { is_published?: boolean }).is_published));
    }
    if (opts?.testKind) {
      rows = rows.filter((r) => String((r as { test_kind?: string }).test_kind ?? "class_test") === opts.testKind);
    }
    return rows;
  },

  async get(ctx: ServiceContext, testId: string) {
    assertCanConsume(ctx, "test");
    // A test has no subject column of its own — it anchors on section_subject
    // (§10.22), so the subject is whatever that section teaches. Resolved here
    // once and surfaced as `subject`, so no screen has to know the join.
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("tests")
      .select("*, section_subjects(curriculum_subjects(name))")
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

  /** Create test — base schema first, optional workspace columns. */
  async create(ctx: ServiceContext, input: CreateTestInput) {
    assertCanOwn(ctx, "test");
    await assertTeacherCanWriteTest(ctx, input.classId);
    if (!input.title?.trim()) {
      throw new ValidationFailedError([
        { field: "title", code: "required", message: "Test title is required" },
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

    const base: Record<string, unknown> = {
      class_id: input.classId,
      title: input.title.trim(),
      subject: input.subject ?? "",
      created_by: ctx.userId,
      school_id: ctx.schoolId,
      difficulty: input.difficulty ?? "medium",
      duration_sec: input.duration_sec ?? 1800,
      instructions: `${input.instructions ?? ""}${paperNote}`.trim() || null,
      chapter: input.chapters?.[0] ?? null,
      topic: input.topics?.[0] ?? null,
      total_marks: input.maxMarks ?? 0,
      is_published: published,
      question_count: 0,
    };

    const extended: Record<string, unknown> = {
      ...base,
      school_id: ctx.schoolId,
      subject_id: input.subjectId ?? null,
      test_kind: input.testKind ?? "class_test",
      max_marks: input.maxMarks ?? null,
      passing_marks: input.passingMarks ?? null,
      chapters: input.chapters ?? [],
      topics: input.topics ?? [],
      status,
      scheduled_publish_at: input.scheduledPublishAt ?? null,
      published_at: published ? new Date().toISOString() : null,
    };

    const repo = toRepoContext(ctx);
    let data: unknown = null;
    let error: { message: string } | null = null;

    ({ data, error } = await getClient(repo)
      .from("tests")
      .insert(extended as never)
      .select("*")
      .single());

    if (error) {
      ({ data, error } = await getClient(repo)
        .from("tests")
        .insert(base as never)
        .select("*")
        .single());
    }
    throwIfError(error, "Failed to create test");

    const row = data as { id: string };
    if (published || status === "scheduled") {
      await emitEvent(repo, {
        eventType: published ? "test.published" : "test.scheduled",
        entityType: "test",
        entityId: row.id,
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
    const test = (await this.get(ctx, testId)) as { class_id: string };
    await assertTeacherCanWriteTest(ctx, String(test.class_id));

    await getClient(repo).from("test_questions").delete().eq("test_id", testId);

    if (questions.length === 0) {
      await getClient(repo)
        .from("tests")
        .update({
          question_count: 0,
          total_marks: 0,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", testId);
      return [];
    }

    const rows = questions.map((q, i) => ({
      test_id: testId,
      order_index: i,
      kind: mapKindToDb(q.kind),
      question: q.question.trim(),
      options: toOptions(q.kind, q.options),
      correct: toCorrect(q.kind, q.correct, q.options),
      marks: q.marks ?? 1,
      explanation: q.explanation ?? null,
      school_id: ctx.schoolId,
    }));

    const { data, error } = await getClient(repo)
      .from("test_questions")
      .insert(rows as never)
      .select("*");
    throwIfError(error, "Failed to save questions");

    const total = rows.reduce((s, r) => s + Number(r.marks), 0);
    await getClient(repo)
      .from("tests")
      .update({
        question_count: rows.length,
        total_marks: total,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", testId);

    afterTestWrite(ctx, {
      classId: String(test.class_id),
      source: "TestService.setQuestions",
    });
    return data ?? [];
  },

  async update(ctx: ServiceContext, testId: string, patch: UpdateTestInput) {
    assertCanOwn(ctx, "test");
    const repo = toRepoContext(ctx);
    const existing = (await this.get(ctx, testId)) as { class_id: string };
    await assertTeacherCanWriteTest(ctx, String(existing.class_id));

    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (patch.title !== undefined) row.title = patch.title;
    if (patch.subject !== undefined) row.subject = patch.subject;
    if (patch.difficulty !== undefined) row.difficulty = patch.difficulty;
    if (patch.duration_sec !== undefined) row.duration_sec = patch.duration_sec;
    if (patch.instructions !== undefined) row.instructions = patch.instructions;
    if (patch.chapters?.[0] !== undefined) row.chapter = patch.chapters[0];
    if (patch.topics?.[0] !== undefined) row.topic = patch.topics[0];
    if (patch.maxMarks !== undefined) {
      row.total_marks = patch.maxMarks;
      row.max_marks = patch.maxMarks;
    }
    if (patch.passingMarks !== undefined) row.passing_marks = patch.passingMarks;
    if (patch.testKind !== undefined) row.test_kind = patch.testKind;
    if (patch.chapters !== undefined) row.chapters = patch.chapters;
    if (patch.topics !== undefined) row.topics = patch.topics;
    if (patch.status !== undefined) {
      row.status = patch.status;
      row.is_published = patch.status === "published";
    }
    if (patch.scheduledPublishAt !== undefined) {
      row.scheduled_publish_at = patch.scheduledPublishAt;
    }

    const { data, error } = await getClient(repo)
      .from("tests")
      .update(row as never)
      .eq("id", testId)
      .select("*")
      .single();
    throwIfError(error, "Failed to update test");
    afterTestWrite(ctx, {
      classId: String(existing.class_id),
      source: "TestService.update",
    });
    return data;
  },

  async publish(ctx: ServiceContext, testId: string) {
    assertCanOwn(ctx, "test");
    const repo = toRepoContext(ctx);
    const existing = (await this.get(ctx, testId)) as {
      class_id: string;
      title: string;
      subject?: string;
      test_kind?: string;
    };
    await assertTeacherCanWriteTest(ctx, String(existing.class_id));

    const now = new Date().toISOString();
    const { data, error } = await getClient(repo)
      .from("tests")
      .update({
        status: "published",
        is_published: true,
        published_at: now,
        updated_at: now,
      } as never)
      .eq("id", testId)
      .select("*")
      .single();
    throwIfError(error, "Failed to publish test");
    await emitEvent(repo, {
      eventType: "test.published",
      entityType: "test",
      entityId: testId,
      classId: String(existing.class_id),
      payload: {
        title: existing.title,
        subject: existing.subject,
        testKind: existing.test_kind ?? "class_test",
      },
    }).catch(() => undefined);
    afterTestWrite(ctx, {
      classId: String(existing.class_id),
      source: "TestService.publish",
    });
    return data;
  },

  async archive(ctx: ServiceContext, testId: string) {
    assertCanOwn(ctx, "test");
    const existing = (await this.get(ctx, testId)) as { class_id: string };
    await assertTeacherCanWriteTest(ctx, String(existing.class_id));
    const now = new Date().toISOString();
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("tests")
      .update({
        status: "archived",
        is_published: false,
        archived_at: now,
        updated_at: now,
      } as never)
      .eq("id", testId)
      .select("*")
      .single();
    throwIfError(error, "Failed to archive test");
    afterTestWrite(ctx, {
      classId: String(existing.class_id),
      source: "TestService.archive",
    });
    return data;
  },

  async schedule(ctx: ServiceContext, testId: string, at: string) {
    assertCanOwn(ctx, "test");
    const existing = (await this.get(ctx, testId)) as {
      class_id: string;
      title: string;
      subject?: string;
      test_kind?: string;
    };
    await assertTeacherCanWriteTest(ctx, String(existing.class_id));
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("tests")
      .update({
        status: "scheduled",
        is_published: false,
        scheduled_publish_at: at,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", testId)
      .select("*")
      .single();
    throwIfError(error, "Failed to schedule test");
    await emitEvent(toRepoContext(ctx), {
      eventType: "test.scheduled",
      entityType: "test",
      entityId: testId,
      classId: String(existing.class_id),
      payload: {
        title: existing.title,
        subject: existing.subject,
        testKind: existing.test_kind ?? "class_test",
        scheduledPublishAt: at,
      },
    }).catch(() => undefined);
    afterTestWrite(ctx, {
      classId: String(existing.class_id),
      source: "TestService.schedule",
    });
    return data;
  },

  async remove(ctx: ServiceContext, testId: string) {
    assertCanOwn(ctx, "test");
    const repo = toRepoContext(ctx);
    let classId: string | null = null;
    try {
      const existing = (await this.get(ctx, testId)) as { class_id: string };
      classId = String(existing.class_id);
      await assertTeacherCanWriteTest(ctx, classId);
    } catch {
      /* still attempt delete */
    }
    await getClient(repo).from("test_questions").delete().eq("test_id", testId);
    const { error } = await getClient(repo).from("tests").delete().eq("id", testId);
    throwIfError(error, "Failed to delete test");
    afterTestWrite(ctx, {
      classId,
      source: "TestService.remove",
    });
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
