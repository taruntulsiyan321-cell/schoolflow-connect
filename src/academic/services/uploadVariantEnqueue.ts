/**
 * Custom Practice — §10 enqueue + promotion provenance.
 * Binding: docs/custom-practice-upload-spec.md §10.3 / §10.4
 *
 * Enqueue is owner-driven (rpc_enqueue_upload_variant_generation), not
 * Practice session load. Promotion into the shared bank sets
 * source_upload_question_id and leaves source_question_id null.
 */
import type { ServiceContext } from "./context";
import { assertStudentContext } from "./assertStudentContext";
import { getClient, throwIfError } from "../repository/base";

/** Shape written on variant_generation_queue / question_bank for upload promotion. */
export type UploadPromotionSource = {
  source_upload_question_id: string;
  source_question_id: null;
};

/**
 * §10.3 / §10.4 provenance for a promoted (or queued) upload-sourced variant.
 * Always nulls the bank FK — never point both sources at once.
 */
export function uploadPromotionSource(uploadQuestionId: string): UploadPromotionSource {
  const id = typeof uploadQuestionId === "string" ? uploadQuestionId.trim() : "";
  if (!id) {
    throw new Error("upload question id is required for §10 promotion provenance");
  }
  return {
    source_upload_question_id: id,
    source_question_id: null,
  };
}

/**
 * Payload fragment for store_generated_questions when promoting an upload variant.
 * Callers still pass question text / options / gates via canPromote.
 */
export function promotedUploadVariantFields(
  uploadQuestionId: string,
  tier: 1 | 2,
): UploadPromotionSource & { variant_tier: 1 | 2; source: "ai_upload_variant" } {
  return {
    ...uploadPromotionSource(uploadQuestionId),
    variant_tier: tier,
    source: "ai_upload_variant",
  };
}

export type EnqueueUploadVariantResult = {
  /** Queue row id when a pending job was created; null if already present or bank-filled. */
  queueId: string | null;
};

/**
 * Enqueue AI variant generation from a private upload question (§10).
 * Does not run on Practice session load — call after intake / when a
 * promote-eligible upload question is ready.
 */
export async function enqueueUploadVariantGeneration(
  ctx: ServiceContext,
  uploadQuestionId: string,
  tier: 1 | 2 = 1,
): Promise<EnqueueUploadVariantResult> {
  assertStudentContext(ctx);
  const id = typeof uploadQuestionId === "string" ? uploadQuestionId.trim() : "";
  if (!id) throw new Error("upload question id is required");

  const db = getClient(ctx);
  const { data, error } = await db.rpc("rpc_enqueue_upload_variant_generation", {
    _upload_question_id: id,
    _tier: tier,
  });
  throwIfError(error, "enqueueUploadVariantGeneration");
  return { queueId: (data as string | null) ?? null };
}
