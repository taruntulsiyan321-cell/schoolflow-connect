/**
 * OCR / Multimodal Pipeline v0 — validate media metadata; clarify when OCR unset.
 * Live vendor extraction deferred.
 */

export type ImageMediaMetadata = {
  mime: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  sha256?: string | null;
  media_ref?: string | null;
};

export type MultimodalExtractionV1 = {
  media_ref: string | null;
  media_type: string;
  sha256: string | null;
  ocr_text: string | null;
  normalised_question_text: string | null;
  diagram_description: Record<string, unknown> | null;
  detected_language: string | null;
  subject_hints: string[];
  grade_hints: string[];
  extraction_confidence: number;
  safety_flags: string[];
  pii_flags: string[];
  provider_capability_id: string | null;
  model_config_id: string | null;
  processed_at: string;
};

export type OcrPipelineResult =
  | {
      ok: true;
      extraction: MultimodalExtractionV1;
      action: "continue";
    }
  | {
      ok: false;
      action: "clarify" | "reject";
      reason: string;
      message: string;
      extraction?: MultimodalExtractionV1;
    };

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
]);

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const MIN_BYTES = 64;
const MIN_DIM = 32;
const MAX_DIM = 8000;
const CONFIDENCE_CLARIFY_THRESHOLD = 0.55;

export function isOcrProviderConfigured(
  env: Record<string, string | undefined> = {},
): boolean {
  const key =
    env.OCR_PROVIDER_API_KEY ??
    env.GURUKUL_OCR_API_KEY ??
    (typeof process !== "undefined"
      ? process.env?.OCR_PROVIDER_API_KEY ?? process.env?.GURUKUL_OCR_API_KEY
      : undefined);
  return Boolean(key && String(key).trim());
}

export function validateImageMetadata(meta: ImageMediaMetadata): {
  ok: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const mime = (meta.mime || "").toLowerCase().trim();
  if (!ALLOWED_MIME.has(mime)) {
    errors.push(`unsupported_mime:${mime || "missing"}`);
  }
  if (!Number.isFinite(meta.bytes) || meta.bytes < MIN_BYTES) {
    errors.push("image_too_small");
  }
  if (meta.bytes > MAX_BYTES) {
    errors.push("image_too_large");
  }
  if (meta.width != null && (meta.width < MIN_DIM || meta.width > MAX_DIM)) {
    errors.push("invalid_width");
  }
  if (meta.height != null && (meta.height < MIN_DIM || meta.height > MAX_DIM)) {
    errors.push("invalid_height");
  }
  return { ok: errors.length === 0, errors };
}

function emptyExtraction(
  meta: ImageMediaMetadata,
  extras: Partial<MultimodalExtractionV1> = {},
): MultimodalExtractionV1 {
  return {
    media_ref: meta.media_ref ?? null,
    media_type: meta.mime,
    sha256: meta.sha256 ?? null,
    ocr_text: null,
    normalised_question_text: null,
    diagram_description: null,
    detected_language: null,
    subject_hints: [],
    grade_hints: [],
    extraction_confidence: 0,
    safety_flags: [],
    pii_flags: [],
    provider_capability_id: null,
    model_config_id: null,
    processed_at: new Date().toISOString(),
    ...extras,
  };
}

/**
 * v0 stub: validates metadata; if OCR provider missing → clarify (never invent text).
 */
export function runOcrPipelineStub(
  meta: ImageMediaMetadata,
  opts?: { providerConfigured?: boolean; env?: Record<string, string | undefined> },
): OcrPipelineResult {
  const validation = validateImageMetadata(meta);
  if (!validation.ok) {
    return {
      ok: false,
      action: "reject",
      reason: validation.errors.join(","),
      message:
        "That image could not be used. Please upload a clear JPEG/PNG/WebP under 8 MB.",
      extraction: emptyExtraction(meta, { safety_flags: validation.errors }),
    };
  }

  const configured =
    opts?.providerConfigured ?? isOcrProviderConfigured(opts?.env ?? {});

  if (!configured) {
    const extraction = emptyExtraction(meta, {
      provider_capability_id: "vision.ocr.extract",
      extraction_confidence: 0,
      safety_flags: ["ocr_not_configured"],
    });
    return {
      ok: false,
      action: "clarify",
      reason: "ocr_not_configured",
      message:
        "Image reading is not configured yet. Please type your question, or try again later.",
      extraction,
    };
  }

  // Provider present but live call not wired in this slice — still clarify safely.
  const extraction = emptyExtraction(meta, {
    provider_capability_id: "vision.ocr.extract",
    extraction_confidence: 0.2,
    safety_flags: ["ocr_live_deferred"],
  });
  if (extraction.extraction_confidence < CONFIDENCE_CLARIFY_THRESHOLD) {
    return {
      ok: false,
      action: "clarify",
      reason: "low_extraction_confidence",
      message:
        "I could not read that image reliably. Retake a clearer photo or type the question.",
      extraction,
    };
  }

  return { ok: true, extraction, action: "continue" };
}
