/**
 * Submit one captured frame to the Stage 1 edge function.
 * Binding: docs/screen-capture-mistakes-spec.md §7 / §9 / §11
 * Cites upload privacy: docs/custom-practice-upload-spec.md §2
 */
import { supabase } from "@/integrations/supabase/client";

export type ScreenCaptureSubmitInput = {
  image_base64: string;
  mime_type?: string;
  package_name: string;
  allowed_packages?: string[];
  exam_id?: string | null;
  is_lecture_suspect?: boolean;
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

export async function submitScreenCaptureMistake(
  input: ScreenCaptureSubmitInput,
): Promise<ScreenCaptureSubmitResult> {
  const { data, error } = await supabase.functions.invoke("screen-capture-mistake", {
    body: {
      image_base64: input.image_base64,
      mime_type: input.mime_type ?? "image/png",
      package_name: input.package_name,
      allowed_packages: input.allowed_packages,
      exam_id: input.exam_id ?? undefined,
      is_lecture_suspect: input.is_lecture_suspect === true,
    },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  return (data ?? { ok: false, error: "empty_response" }) as ScreenCaptureSubmitResult;
}

/** §11 — student may delete any captured question (RLS owner-only). */
export async function deleteScreenCaptureQuestion(
  captureQuestionId: string,
): Promise<boolean> {
  const id = captureQuestionId.trim();
  if (!id) return false;
  const client = supabase as unknown as {
    from: (t: string) => {
      delete: () => {
        eq: (col: string, val: string) => Promise<{ error: { message: string } | null }>;
      };
    };
  };
  const { error } = await client
    .from("student_capture_questions")
    .delete()
    .eq("id", id);
  if (error) {
    console.warn("[screen-capture] delete failed", error.message);
    return false;
  }
  return true;
}
