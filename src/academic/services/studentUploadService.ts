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

export const StudentUploadService = {
  async createFromFile(ctx: ServiceContext, file: File): Promise<StudentUploadRow> {
    assertStudentContext(ctx);
    const stored = await uploadStudentUploadFile(file);
    const db = getClient(ctx);
    const { data, error } = await db
      .from("student_uploads")
      .insert({
        owner_id: ctx.userId,
        school_id: ctx.schoolId,
        storage_path: stored.storagePath,
        original_filename: stored.originalFilename,
        byte_size: stored.byteSize,
        mime_type: stored.mimeType,
        status: "pending",
      })
      .select("*")
      .single();
    throwIfError(error, "StudentUploadService.createFromFile");
    return data as StudentUploadRow;
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
