/**
 * Custom Practice — the student's own upload.
 * Binding: docs/custom-practice-upload-spec.md
 */
import type { ServiceContext } from "./context";
import { assertStudentContext } from "./assertStudentContext";
import { getClient, throwIfError } from "../repository/base";
import { uploadStudentUploadFile } from "../storage/studentUploadFile";
import { edgeFunctionErrorMessage } from "@/lib/edgeFunctionError";
import { planLimitFromInvokeError, type PlanLimit } from "@/lib/premium";

export type UploadVerdict = "questions" | "notes" | "mixed" | "unusable";
export type UploadStatus = "pending" | "processing" | "ready" | "unusable" | "failed";

export type StudentUploadRow = {
  id: string;
  owner_id: string;
  school_id: string;
  storage_path: string;
  original_filename: string;
  byte_size: number;
  mime_type: string;
  page_count: number | null;
  verdict: UploadVerdict | null;
  confidence: number | null;
  refusal_reason: string | null;
  status: UploadStatus;
  created_at: string;
  updated_at: string;
};

type StudentUploadQuestionRow = {
  id: string;
  upload_id: string;
  sequence: number;
  question_text: string;
  options: string[] | null;
  correct_index: number | null;
  correct_answer: string | null;
  answer_source: "file" | "ai";
  explanation: string | null;
  difficulty: string | null;
  chapter_id: string | null;
  topic_id: string | null;
  /** §7.1 — set when the question was written from a note; null = file-extracted. */
  derived_from_note_id: string | null;
};

export type StudentUploadNoteRow = {
  id: string;
  upload_id: string;
  sequence: number;
  title: string;
  body: string;
  chapter_id: string | null;
  topic_id: string | null;
};

/** Spec §8 — the ways an upload can be practised or read. */
export type UploadPracticeMode =
  | "practise_all"
  | "practise_by_chapter"
  | "practise_hard"
  | "read_notes"
  | "practise_from_notes";

/**
 * A question Practice can put to the student: two or more options and an
 * option index to grade on. Practice drops any other private question, so
 * nothing else can fill a mode. Server twin: `_brought_question_askable`;
 * upload function twin: `isAskable` in refusalGates.ts (Deno cannot import
 * from src/).
 */
export function isPractisableQuestion(q: { options: unknown; correct_index: number | null }): boolean {
  return Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.correct_index);
}

/** What one upload holds that can be practised or read (§8). */
export type UploadContent = {
  /** Questions that can be practised. */
  practisable: number;
  hard: number;
  /** Practisable questions written from the upload's notes (§7.1). */
  fromNotes: number;
  notes: number;
  /** Chapters with practisable questions, most questions first. */
  chapters: Array<{ id: string; name: string; count: number }>;
};

export const EMPTY_UPLOAD_CONTENT: UploadContent = { practisable: 0, hard: 0, fromNotes: 0, notes: 0, chapters: [] };

/**
 * Spec §8 — "A mode is never shown for material the upload does not contain."
 *
 * Read off what the upload holds, not off its verdict. The verdict offered
 * "practise hard only" to a file with no hard question and "practise from
 * notes" to one with nothing written from them — each opened an empty
 * session — and "practise by chapter" beside a file of one chapter, where it
 * is "practise all" under another name. By chapter is offered when there are
 * two or more chapters to choose between; the screen lists them.
 */
export function modesForUpload(row: Pick<StudentUploadRow, "status">, content: UploadContent): UploadPracticeMode[] {
  if (row.status !== "ready") return [];
  const modes: UploadPracticeMode[] = [];
  if (content.practisable > 0) modes.push("practise_all");
  if (content.chapters.length >= 2) modes.push("practise_by_chapter");
  if (content.hard > 0) modes.push("practise_hard");
  if (content.notes > 0) modes.push("read_notes");
  if (content.fromNotes > 0) modes.push("practise_from_notes");
  return modes;
}

export const UPLOAD_MODE_LABELS: Record<UploadPracticeMode, string> = {
  practise_all: "Practise all",
  practise_by_chapter: "Practise by chapter",
  practise_hard: "Practise hard only",
  read_notes: "Read the notes",
  practise_from_notes: "Practise from notes",
};

type UploadQuestionSelectRow = {
  id: string;
  /** Spec §9.1 — student_uploads.id for attempt source_id. */
  upload_id: string;
  question_text: string;
  options: unknown;
  correct_index: number | null;
  explanation: string | null;
  difficulty: string | null;
  chapter_id: string | null;
  answer_source: string;
  // PostgREST may type the embed as an array; normalize at the call site.
  chapters?: unknown;
};

function chapterEmbed(raw: unknown): {
  name?: string;
  curriculum_subjects?: { name?: string } | null;
} | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const first = raw[0];
    return first && typeof first === "object"
      ? (first as { name?: string; curriculum_subjects?: { name?: string } | null })
      : null;
  }
  if (typeof raw === "object") {
    return raw as { name?: string; curriculum_subjects?: { name?: string } | null };
  }
  return null;
}

function mapUploadQuestionRow(row: UploadQuestionSelectRow) {
  // chapters.curriculum_subject_id → curriculum_subjects (not public.subjects).
  // Never invent Mixed/General — Mistake Book drops those placeholders.
  const ch = chapterEmbed(row.chapters);
  const subjectName = ch?.curriculum_subjects?.name?.trim() || null;
  return {
    id: row.id,
    upload_id: row.upload_id,
    question: row.question_text,
    options: row.options,
    correct_index: row.correct_index,
    explanation: row.explanation ?? null,
    difficulty: row.difficulty ?? "medium",
    subject: subjectName,
    chapter: ch?.name ?? null,
    chapter_id: row.chapter_id ?? null,
    from_upload: true as const,
    ai_answered: row.answer_source === "ai",
  };
}

/** Normalize a single file or multi-page image pick into a non-empty File[]. */
export function normalizeUploadFiles(files: File | File[]): File[] {
  const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
  if (list.length === 0) throw new Error("Choose at least one PDF or image.");
  return list;
}

/** Spec §6.1 — result of disputing an AI-answered upload question. */
type DisputeAiAnswerResult = {
  upload_question_id: string;
  cleared_mistakes: number;
  excluded_attempts: number;
};

export const StudentUploadService = {
  /**
   * Intake only (§3.1 / §3.2): store each file and insert a pending student_uploads row.
   * Does NOT invent questions/notes — extraction + sequence on student_upload_questions
   * is the classifier's job. One row per file (multi-image pages = multiple rows in pick order).
   * page_count: 1 for a single image; left null for PDFs (page count is measured later).
   */
  async create(ctx: ServiceContext, files: File | File[]): Promise<StudentUploadRow[]> {
    assertStudentContext(ctx);
    // Spec §11 / edge: Custom Practice is individual exam accounts only.
    let kind = ctx.schoolKind ?? null;
    if (kind == null) {
      const db = getClient(ctx);
      const { data: school, error: kindErr } = await db
        .from("schools")
        .select("kind")
        .eq("id", ctx.schoolId)
        .maybeSingle();
      throwIfError(kindErr, "StudentUploadService.create.kind");
      kind = school?.kind === "individual" || school?.kind === "school" ? school.kind : null;
    }
    if (kind !== "individual") {
      throw new Error("Custom Practice uploads are only for individual exam accounts.");
    }
    const list = normalizeUploadFiles(files);

    const db = getClient(ctx);
    const rows: StudentUploadRow[] = [];

    for (const file of list) {
      const stored = await uploadStudentUploadFile(file);
      const isPdf =
        stored.mimeType === "application/pdf" ||
        stored.originalFilename.toLowerCase().endsWith(".pdf");
      const { data, error } = await db
        .from("student_uploads")
        .insert({
          owner_id: ctx.userId,
          school_id: ctx.schoolId,
          storage_path: stored.storagePath,
          original_filename: stored.originalFilename,
          byte_size: stored.byteSize,
          mime_type: stored.mimeType,
          // Honest for a single image page; PDF page_count stays null until measured.
          page_count: isPdf ? null : 1,
          status: "pending",
        })
        .select("*")
        .single();
      throwIfError(error, "StudentUploadService.create");
      rows.push(data as StudentUploadRow);
    }

    return rows;
  },

  async createFromFile(ctx: ServiceContext, file: File): Promise<StudentUploadRow> {
    const [row] = await this.create(ctx, file);
    return row;
  },

  async listMine(ctx: ServiceContext, limit = 20): Promise<StudentUploadRow[]> {
    assertStudentContext(ctx);
    const db = getClient(ctx);
    const { data, error } = await db
      .from("student_uploads")
      .select("*")
      .eq("owner_id", ctx.userId)
      .order("created_at", { ascending: false })
      .limit(limit);
    throwIfError(error, "StudentUploadService.listMine");
    return (data ?? []) as StudentUploadRow[];
  },

  async get(ctx: ServiceContext, uploadId: string): Promise<StudentUploadRow | null> {
    assertStudentContext(ctx);
    const db = getClient(ctx);
    const { data, error } = await db
      .from("student_uploads")
      .select("*")
      .eq("id", uploadId)
      .eq("owner_id", ctx.userId)
      .maybeSingle();
    throwIfError(error, "StudentUploadService.get");
    return (data as StudentUploadRow | null) ?? null;
  },

  async listQuestions(ctx: ServiceContext, uploadId: string): Promise<StudentUploadQuestionRow[]> {
    assertStudentContext(ctx);
    const db = getClient(ctx);
    const { data, error } = await db
      .from("student_upload_questions")
      .select(
        "id, upload_id, sequence, question_text, options, correct_index, correct_answer, answer_source, explanation, difficulty, chapter_id, topic_id, derived_from_note_id",
      )
      .eq("upload_id", uploadId)
      .eq("owner_id", ctx.userId)
      .order("sequence", { ascending: true });
    throwIfError(error, "StudentUploadService.listQuestions");
    return (data ?? []).map((row) => ({
      ...row,
      options: Array.isArray(row.options) ? (row.options as string[]) : null,
    })) as StudentUploadQuestionRow[];
  },

  /** §8 — what each upload holds that can be practised or read, for its modes. */
  async contentOf(ctx: ServiceContext, uploadIds: string[]): Promise<Map<string, UploadContent>> {
    assertStudentContext(ctx);
    const ids = Array.from(new Set(uploadIds.filter(Boolean)));
    const out = new Map<string, UploadContent>();
    if (ids.length === 0) return out;
    const db = getClient(ctx);
    const [qs, ns] = await Promise.all([
      db
        .from("student_upload_questions")
        .select("upload_id, options, correct_index, difficulty, chapter_id, derived_from_note_id, chapters(name)")
        .eq("owner_id", ctx.userId)
        .in("upload_id", ids),
      db.from("student_upload_notes").select("upload_id").eq("owner_id", ctx.userId).in("upload_id", ids),
    ]);
    throwIfError(qs.error, "StudentUploadService.contentOf questions");
    throwIfError(ns.error, "StudentUploadService.contentOf notes");
    const entry = (id: string) => {
      let c = out.get(id);
      if (!c) { c = { ...EMPTY_UPLOAD_CONTENT, chapters: [] }; out.set(id, c); }
      return c;
    };
    const byChapter = new Map<string, Map<string, { name: string; count: number }>>();
    for (const raw of (qs.data ?? []) as Array<{
      upload_id: string; options: unknown; correct_index: number | null; difficulty: string | null;
      chapter_id: string | null; derived_from_note_id: string | null; chapters?: unknown;
    }>) {
      if (!isPractisableQuestion(raw)) continue;
      const c = entry(raw.upload_id);
      c.practisable += 1;
      if ((raw.difficulty ?? "").toLowerCase() === "hard") c.hard += 1;
      if (raw.derived_from_note_id) c.fromNotes += 1;
      if (raw.chapter_id) {
        const name = chapterEmbed(raw.chapters)?.name?.trim() || "This chapter";
        const chapters = byChapter.get(raw.upload_id) ?? new Map();
        const ch = chapters.get(raw.chapter_id) ?? { name, count: 0 };
        ch.count += 1;
        chapters.set(raw.chapter_id, ch);
        byChapter.set(raw.upload_id, chapters);
      }
    }
    for (const raw of (ns.data ?? []) as Array<{ upload_id: string }>) entry(raw.upload_id).notes += 1;
    for (const [uploadId, chapters] of byChapter) {
      entry(uploadId).chapters = [...chapters.entries()]
        .map(([id, ch]) => ({ id, name: ch.name, count: ch.count }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    }
    return out;
  },

  async listNotes(ctx: ServiceContext, uploadId: string): Promise<StudentUploadNoteRow[]> {
    assertStudentContext(ctx);
    const db = getClient(ctx);
    const { data, error } = await db
      .from("student_upload_notes")
      .select("id, upload_id, sequence, title, body, chapter_id, topic_id")
      .eq("upload_id", uploadId)
      .eq("owner_id", ctx.userId)
      .order("sequence", { ascending: true });
    throwIfError(error, "StudentUploadService.listNotes");
    return (data ?? []) as StudentUploadNoteRow[];
  },

  /**
   * Spec §6.1 — student says "this AI answer is wrong".
   * Clears the mistake it created and removes that attempt from accuracy
   * via rpc_dispute_ai_upload_answer (owner-scoped SECURITY DEFINER).
   */
  async disputeAiAnswer(
    ctx: ServiceContext,
    uploadQuestionId: string,
  ): Promise<DisputeAiAnswerResult> {
    assertStudentContext(ctx);
    if (!uploadQuestionId) {
      throw new Error("upload question id is required");
    }
    const db = getClient(ctx);
    const { data, error } = await db.rpc("rpc_dispute_ai_upload_answer" as never, {
      _upload_question_id: uploadQuestionId,
    } as never);
    throwIfError(error, "StudentUploadService.disputeAiAnswer");

    const row =
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {};
    return {
      upload_question_id:
        typeof row.upload_question_id === "string" ? row.upload_question_id : uploadQuestionId,
      cleared_mistakes: Number(row.cleared_mistakes ?? 0) || 0,
      excluded_attempts: Number(row.excluded_attempts ?? 0) || 0,
    };
  },

  /**
   * Questions for a Custom Practice upload session (§8 modes).
   * Shape mirrors bank rows so Session can reuse its mapper; ids are
   * student_upload_questions.id and must NOT be passed as bank_question_id.
   */
  async listForPractice(
    ctx: ServiceContext,
    uploadId: string,
    mode: UploadPracticeMode,
    limit = 50,
    /** Required for practise_by_chapter: the chapter the student chose. */
    chapterId: string | null = null,
  ): Promise<
    Array<{
      id: string;
      upload_id: string;
      question: string;
      options: unknown;
      correct_index: number | null;
      explanation: string | null;
      difficulty: string | null;
      subject: string | null;
      chapter: string | null;
      chapter_id: string | null;
      from_upload: true;
      ai_answered: boolean;
    }>
  > {
    assertStudentContext(ctx);
    if (mode === "read_notes") return [];

    const db = getClient(ctx);
    let query = db
      .from("student_upload_questions")
      .select(
        "id, upload_id, question_text, options, correct_index, explanation, difficulty, chapter_id, answer_source, derived_from_note_id, chapters(name, curriculum_subjects(name))",
      )
      .eq("upload_id", uploadId)
      .eq("owner_id", ctx.userId)
      .order("sequence", { ascending: true })
      .limit(Math.min(90, Math.max(1, limit)));

    if (mode === "practise_hard") {
      query = query.ilike("difficulty", "hard");
    } else if (mode === "practise_by_chapter") {
      // One chapter, the one the student chose. This read every tagged
      // question — every question, since none is left untagged — so "by
      // chapter" was "all" under another name.
      if (!chapterId) throw new Error("Choose a chapter to practise.");
      query = query.eq("chapter_id", chapterId);
    } else if (mode === "practise_from_notes") {
      // §7.1 / §8 — notes-derived only. Never fall through to practise_all.
      // No derived rows → honest empty (Session shows the upload empty state).
      query = query.not("derived_from_note_id", "is", null);
    }

    const { data, error } = await query;
    throwIfError(error, "StudentUploadService.listForPractice");

    return (data ?? []).map((row) => mapUploadQuestionRow(row));
  },

  /**
   * Load private upload questions by id — recovery tier-0 from_upload (§9 / 720).
   * Ids are student_upload_questions.id; never treat as bank ids.
   */
  async listByIds(
    ctx: ServiceContext,
    ids: string[],
  ): Promise<
    Array<{
      id: string;
      upload_id: string;
      question: string;
      options: unknown;
      correct_index: number | null;
      explanation: string | null;
      difficulty: string | null;
      subject: string | null;
      chapter: string | null;
      chapter_id: string | null;
      from_upload: true;
      ai_answered: boolean;
    }>
  > {
    assertStudentContext(ctx);
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return [];
    const db = getClient(ctx);
    const { data, error } = await db
      .from("student_upload_questions")
      .select(
        "id, upload_id, question_text, options, correct_index, explanation, difficulty, chapter_id, answer_source, chapters(name, curriculum_subjects(name))",
      )
      .eq("owner_id", ctx.userId)
      .in("id", unique);
    throwIfError(error, "StudentUploadService.listByIds");
    return (data ?? []).map((row) => mapUploadQuestionRow(row));
  },

  /** Ask the edge function to classify + extract. Never invents questions client-side. */
  /**
   * Classify and file an upload. `outside` counts the questions and notes not
   * saved because their subject is outside the student's stream syllabus.
   */
  async requestClassify(
    ctx: ServiceContext,
    uploadId: string,
  ): Promise<{ ok: boolean; error?: string; planLimit?: PlanLimit; outside?: { count: number; subjects: string[] } }> {
    assertStudentContext(ctx);
    const db = getClient(ctx);
    const { data, error } = await db.functions.invoke("custom-practice-upload", {
      body: { upload_id: uploadId },
    });
    if (error) {
      // The plan refused it (402), or the function's own words — not the
      // client's "Edge Function returned a non-2xx status code".
      const planLimit = await planLimitFromInvokeError(error);
      if (planLimit) return { ok: false, error: planLimit.message, planLimit };
      return { ok: false, error: await edgeFunctionErrorMessage(error, "Classifier could not be reached") };
    }
    if (data && typeof data === "object" && "error" in data && data.error) {
      return { ok: false, error: String((data as { error: unknown }).error) };
    }
    const d = (data ?? {}) as { outside_stream?: unknown; outside_subjects?: unknown };
    const count = typeof d.outside_stream === "number" ? d.outside_stream : 0;
    const subjects = Array.isArray(d.outside_subjects) ? d.outside_subjects.map(String) : [];
    return count > 0 ? { ok: true, outside: { count, subjects } } : { ok: true };
  },

  async remove(ctx: ServiceContext, uploadId: string): Promise<void> {
    assertStudentContext(ctx);
    const db = getClient(ctx);
    const row = await this.get(ctx, uploadId);
    if (!row) return;
    const { error } = await db
      .from("student_uploads")
      .delete()
      .eq("id", uploadId)
      .eq("owner_id", ctx.userId);
    throwIfError(error, "StudentUploadService.remove");
    // Best-effort storage cleanup — row ownership already enforced.
    await db.storage.from("student-uploads").remove([row.storage_path]).catch(() => {});
  },
};
