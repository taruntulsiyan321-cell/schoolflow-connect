/**
 * Submit one captured frame to the Stage 1 edge function.
 * Binding: docs/screen-capture-mistakes-spec.md §7 / §9 / §11
 * Cites upload privacy: docs/custom-practice-upload-spec.md §2
 */
import { supabase } from "@/integrations/supabase/client";
import { broadcastAcademicWrite } from "../live";
import { getClient, throwIfError } from "../repository/base";
import type { ServiceContext } from "./context";
import { assertStudentContext } from "./assertStudentContext";

export type ScreenCaptureSubmitInput = {
  image_base64: string;
  mime_type?: string;
  package_name: string;
  allowed_packages?: string[];
  exam_id?: string | null;
  is_lecture_suspect?: boolean;
  /** When set, bumps Mistake Book / Recovery live listeners after a persist. */
  school_id?: string | null;
};

export type ScreenCaptureSubmitResult = {
  ok: boolean;
  captured?: boolean;
  read?: boolean;
  reason?: string;
  message?: string;
  pipeline_stage?: string;
  capture_question_id?: string;
  mistake_id?: string;
  times_wrong?: number;
  chapter_id?: string | null;
  inherited_from_bank?: boolean;
  matched_bank_question_id?: string | null;
  question_text?: string;
  bank_count_before?: number | null;
  bank_count_after?: number | null;
  promoted_to_question_bank?: boolean;
  error?: string;
};

export type CapturePracticeRow = {
  id: string;
  question: string;
  options: unknown;
  correct_index: number | null;
  explanation: string | null;
  difficulty: string | null;
  subject: string | null;
  chapter: string | null;
  chapter_id: string | null;
  from_capture: true;
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

export async function submitScreenCaptureMistake(
  input: ScreenCaptureSubmitInput,
): Promise<ScreenCaptureSubmitResult> {
  const { data, error } = await supabase.functions.invoke("screen-capture-mistake", {
    body: {
      image_base64: input.image_base64,
      mime_type: input.mime_type ?? "image/png",
      package_name: input.package_name,
      // Allowlist is server-side only (student_capture_allowed_apps).
      exam_id: input.exam_id ?? undefined,
      is_lecture_suspect: input.is_lecture_suspect === true,
    },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  const result = (data ?? { ok: false, error: "empty_response" }) as ScreenCaptureSubmitResult;
  // Spec §12.11 — Mistake Book / Recovery / Revision listen on profile.
  if (result.ok && result.captured && input.school_id) {
    broadcastAcademicWrite(input.school_id, ["profile"], {
      source: "submitScreenCaptureMistake",
    });
  }
  return result;
}

/**
 * Load private capture questions by id — recovery tier-0 from_capture / Incorrect mode.
 * Ids are student_capture_questions.id; never treat as bank ids.
 */
export async function listCaptureQuestionsByIds(
  ctx: ServiceContext,
  ids: string[],
): Promise<CapturePracticeRow[]> {
  assertStudentContext(ctx);
  const unique = Array.from(new Set(ids.filter(Boolean)));
  if (unique.length === 0) return [];
  // Migration 770 table — may lag generated Supabase types.
  type CaptureRow = {
    id: string;
    question_text: string;
    options: unknown;
    correct_index: number | null;
    difficulty: string | null;
    chapter_id: string | null;
    chapters: unknown;
  };
  const db = getClient(ctx) as unknown as {
    from: (t: string) => {
      select: (c: string) => {
        eq: (a: string, b: string) => {
          in: (
            col: string,
            vals: string[],
          ) => Promise<{ data: CaptureRow[] | null; error: { message: string } | null }>;
        };
      };
    };
  };
  const { data, error } = await db
    .from("student_capture_questions")
    .select(
      "id, question_text, options, correct_index, difficulty, chapter_id, chapters(name, curriculum_subjects(name))",
    )
    .eq("owner_id", ctx.userId)
    .in("id", unique);
  throwIfError(error, "listCaptureQuestionsByIds");
  const out: CapturePracticeRow[] = [];
  for (const row of data ?? []) {
    const ch = chapterEmbed(row.chapters);
    const options = row.options;
    const correct =
      typeof row.correct_index === "number" && Number.isInteger(row.correct_index)
        ? row.correct_index
        : null;
    if (!row.id || !row.question_text || correct == null) continue;
    if (!Array.isArray(options) || options.length < 2) continue;
    out.push({
      id: row.id,
      question: row.question_text,
      options,
      correct_index: correct,
      explanation: null,
      difficulty: row.difficulty ?? "medium",
      subject: ch?.curriculum_subjects?.name?.trim() || null,
      chapter: ch?.name ?? null,
      chapter_id: row.chapter_id ?? null,
      from_capture: true,
    });
  }
  return out;
}

/** §11 — student may delete any captured question (RLS owner-only).
 * Also removes open mistake rows keyed on that capture (FK is SET NULL, which
 * would otherwise orphan a mistake book entry with no original).
 */
export async function deleteScreenCaptureQuestion(
  captureQuestionId: string,
): Promise<boolean> {
  const id = captureQuestionId.trim();
  if (!id) return false;
  // Tables/columns from migration 770 may lag generated types.
  const db = supabase as unknown as {
    from: (t: string) => {
      delete: () => {
        eq: (
          col: string,
          val: string,
        ) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
  // Mistakes first — capture delete must not leave SET-NULL orphans in the book.
  const mist = await db.from("student_mistakes").delete().eq("capture_question_id", id);
  if (mist.error) {
    console.warn("[screen-capture] mistake delete failed", mist.error.message);
  }
  const { error } = await db.from("student_capture_questions").delete().eq("id", id);
  if (error) {
    console.warn("[screen-capture] delete failed", error.message);
    return false;
  }
  return true;
}
