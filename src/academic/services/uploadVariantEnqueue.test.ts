/**
 * §10 enqueue / promotion provenance helpers.
 * Binding: docs/custom-practice-upload-spec.md §10.3
 */
import { describe, expect, it } from "vitest";
import {
  promotedUploadVariantFields,
  uploadPromotionSource,
} from "./uploadVariantEnqueue";

describe("uploadPromotionSource — §10.3", () => {
  it("sets source_upload_question_id and leaves source_question_id null", () => {
    expect(uploadPromotionSource("uq-123")).toEqual({
      source_upload_question_id: "uq-123",
      source_question_id: null,
    });
  });

  it("refuses a blank id", () => {
    expect(() => uploadPromotionSource("  ")).toThrow(/required/i);
  });
});

describe("promotedUploadVariantFields", () => {
  it("carries tier and upload provenance without a bank source", () => {
    expect(promotedUploadVariantFields("uq-9", 2)).toEqual({
      source_upload_question_id: "uq-9",
      source_question_id: null,
      variant_tier: 2,
      source: "ai_upload_variant",
    });
  });
});
