/**
 * Custom Practice — the student's own upload.
 * Binding: docs/custom-practice-upload-spec.md
 */
import type { ServiceContext } from "./context";
import { assertStudentContext } from "./assertStudentContext";
import { getClient, throwIfError } from "../repository/base";
import { uploadStudentUploadFile } from "../storage/studentUploadFile";

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

export type StudentUploadQuestionRow = {
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

/** Spec §8 — modes offered are a function of the verdict, never a fixed list. */
export type UploadPracticeMode =
  | "practise_all"
  | "practise_by_chapter"
  | "practise_hard"
  | "read_notes"
  | "practise_from_notes";

export function modesForVerdict(verdict: UploadVerdict | null | undefined): UploadPracticeMode[] {
  if (verdict === "questions") return ["practise_all", "practise_by_chapter", "practise_hard"];
  if (verdict === "notes") return ["read_notes", "practise_from_notes"];
  if (verdict === "mixed") {
    return ["practise_all", "practise_by_chapter", "practise_hard", "read_notes", "practise_from_notes"];
  }
  // unusable / null / unknown — §4.3 / §8: none
  return [];
}

export const UPLOAD_MODE_LABELS: Record<UploadPracticeMode, string> = {
  practise_all: "Practise all",
  practise_by_chapter: "Practise by chapter",
  practise_hard: "Practise hard only",
  read_notes: "Read the notes",
  practise_from_notes: "Practise from notes",
};

/** Spec §6.1 — result of disputing an AI-answered upload question. */
export type DisputeAiAnswerResult = {
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
    const list = (Array.isArray(files) ? files : [files]).filter(Boolean);
    if (list.length === 0) throw new Error("Choose at least one PDF or image.");

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
        "id, upload_id, sequence, question_text, options, correct_index, correct_answer, answer_source, explanation, difficulty, chapter_id, topic_id",
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
  ): Promise<
    Array<{
      id: string;
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
        "id, question_text, options, correct_index, explanation, difficulty, chapter_id, answer_source, chapters(name)",
      )
      .eq("upload_id", uploadId)
      .eq("owner_id", ctx.userId)
      .order("sequence", { ascending: true })
      .limit(Math.min(90, Math.max(1, limit)));

    if (mode === "practise_hard") {
      query = query.ilike("difficulty", "hard");
    } else if (mode === "practise_by_chapter") {
      query = query.not("chapter_id", "is", null);
    }

    const { data, error } = await query;
    throwIfError(error, "StudentUploadService.listForPractice");

    return (data ?? []).map((row) => {
      const ch = row.chapters as { name?: string } | null;
      return {
        id: row.id as string,
        question: row.question_text as string,
        options: row.options,
        correct_index: row.correct_index as number | null,
        explanation: (row.explanation as string | null) ?? null,
        difficulty: (row.difficulty as string | null) ?? "medium",
        subject: null,
        chapter: ch?.name ?? null,
        chapter_id: (row.chapter_id as string | null) ?? null,
        from_upload: true as const,
        ai_answered: row.answer_source === "ai",
      };
    });
  },

  /** Ask the edge function to classify + extract. Never invents questions client-side. */
  async requestClassify(
    ctx: ServiceContext,
    uploadId: string,
  ): Promise<{ ok: boolean; error?: string }> {
    assertStudentContext(ctx);
    const db = getClient(ctx);
    const { data, error } = await db.functions.invoke("custom-practice-upload", {
      body: { upload_id: uploadId },
    });
    if (error) {
      return { ok: false, error: error.message || "Classifier could not be reached" };
    }
    if (data && typeof data === "object" && "error" in data && data.error) {
      return { ok: false, error: String((data as { error: unknown }).error) };
    }
    return { ok: true };
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
