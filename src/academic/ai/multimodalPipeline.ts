/**
 * OCR / Multimodal Pipeline — validate media metadata; clarify when OCR unset.
 * Live vendor extraction deferred. Never invents problem text.
 */

export type ImageMediaMetadata = {
  mime: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  sha256?: string | null;
  media_ref?: string | null;
  /** Client-supplied malware-scan stub flag (vendor deferred). */
  malware_scan_status?: "stub_pass" | "stub_flagged" | "unchecked" | null;
  filename?: string | null;
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
  malware_scan_status: "stub_pass" | "stub_flagged" | "unchecked" | "rejected";
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

export type ImageDoubtSubmitStepResult = {
  step_id: string;
  ok: boolean;
  detail: string;
};

export type ImageDoubtSubmitResult = {
  capability_id: "student.image_doubt.submit";
  workflow_id: "student.image_doubt.submit.v1";
  status: "clarify" | "rejected" | "ocr_ready";
  stop_reason: string;
  message: string;
  invented_problem_text: false;
  ocr_text: string | null;
  normalised_question_text: string | null;
  extraction: MultimodalExtractionV1 | null;
  checkpoints: ImageDoubtSubmitStepResult[];
};

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const BLOCKED_MIME = new Set([
  "application/octet-stream",
  "application/x-msdownload",
  "application/x-executable",
  "text/html",
  "application/javascript",
  "image/svg+xml",
]);

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB
const MIN_BYTES = 64;
const MIN_DIM = 32;
const MAX_DIM = 8000;
const CONFIDENCE_CLARIFY_THRESHOLD = 0.55;
const DANGEROUS_EXT = /\.(exe|bat|cmd|scr|dll|js|vbs|ps1|msi|apk)$/i;

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
  malware_stub: "stub_pass" | "stub_flagged" | "unchecked" | "rejected";
} {
  const errors: string[] = [];
  const mime = (meta.mime || "").toLowerCase().trim();

  if (!mime) {
    errors.push("unsupported_mime:missing");
  } else if (BLOCKED_MIME.has(mime)) {
    errors.push(`blocked_mime:${mime}`);
  } else if (!ALLOWED_MIME.has(mime)) {
    errors.push(`unsupported_mime:${mime}`);
  }

  if (!Number.isFinite(meta.bytes) || meta.bytes < MIN_BYTES) {
    errors.push("image_too_small");
  }
  if (Number.isFinite(meta.bytes) && meta.bytes > MAX_BYTES) {
    errors.push("image_too_large");
  }
  if (meta.width != null && (meta.width < MIN_DIM || meta.width > MAX_DIM)) {
    errors.push("invalid_width");
  }
  if (meta.height != null && (meta.height < MIN_DIM || meta.height > MAX_DIM)) {
    errors.push("invalid_height");
  }
  if (meta.width != null && meta.height != null) {
    const pixels = meta.width * meta.height;
    if (pixels > 40_000_000) errors.push("pixel_budget_exceeded");
  }

  const filename = (meta.filename ?? "").trim();
  if (filename && DANGEROUS_EXT.test(filename)) {
    errors.push("dangerous_filename_extension");
  }

  let malware_stub: "stub_pass" | "stub_flagged" | "unchecked" | "rejected" =
    meta.malware_scan_status === "stub_flagged"
      ? "stub_flagged"
      : meta.malware_scan_status === "stub_pass"
        ? "stub_pass"
        : "unchecked";

  if (meta.malware_scan_status === "stub_flagged") {
    errors.push("malware_stub_flagged");
    malware_stub = "rejected";
  }

  return { ok: errors.length === 0, errors, malware_stub };
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
    malware_scan_status: "unchecked",
    provider_capability_id: null,
    model_config_id: null,
    processed_at: new Date().toISOString(),
    ...extras,
  };
}

/**
 * Validates metadata; if OCR provider missing → clarify (never invent text).
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
        validation.malware_stub === "rejected"
          ? "That upload was blocked by the safety screen. Please use a clear photo of your question."
          : "That image could not be used. Please upload a clear JPEG/PNG/WebP under 8 MB.",
      extraction: emptyExtraction(meta, {
        safety_flags: validation.errors,
        malware_scan_status: validation.malware_stub,
      }),
    };
  }

  const configured =
    opts?.providerConfigured ?? isOcrProviderConfigured(opts?.env ?? {});

  if (!configured) {
    const extraction = emptyExtraction(meta, {
      provider_capability_id: "vision.ocr.extract",
      extraction_confidence: 0,
      safety_flags: ["ocr_not_configured"],
      malware_scan_status: validation.malware_stub,
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
    malware_scan_status: validation.malware_stub,
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

/**
 * Capability student.image_doubt.submit — run orchestrator steps until
 * clarify / OCR-missing / reject. Never invents problem text.
 */
export function runImageDoubtSubmit(
  meta: ImageMediaMetadata,
  opts?: { providerConfigured?: boolean; env?: Record<string, string | undefined> },
): ImageDoubtSubmitResult {
  const checkpoints: ImageDoubtSubmitStepResult[] = [];

  // Step 1: validate_media
  const validation = validateImageMetadata(meta);
  checkpoints.push({
    step_id: "validate_media",
    ok: validation.ok,
    detail: validation.ok ? "media_ok" : validation.errors.join(","),
  });
  if (!validation.ok) {
    const ocr = runOcrPipelineStub(meta, opts);
    return {
      capability_id: "student.image_doubt.submit",
      workflow_id: "student.image_doubt.submit.v1",
      status: "rejected",
      stop_reason: validation.errors.join(","),
      message:
        ocr.ok === false
          ? ocr.message
          : "That image could not be used.",
      invented_problem_text: false,
      ocr_text: null,
      normalised_question_text: null,
      extraction: ocr.extraction ?? null,
      checkpoints,
    };
  }

  // Step 2: safety_screen (stub — malware flag already applied in validate)
  checkpoints.push({
    step_id: "safety_screen",
    ok: true,
    detail: `malware_${validation.malware_stub}`,
  });

  // Step 3: ocr_extract
  const ocr = runOcrPipelineStub(meta, opts);
  const ocrFail = ocr as Extract<typeof ocr, { ok: false }>;
  checkpoints.push({
    step_id: "ocr_extract",
    ok: ocr.ok,
    detail: ocr.ok ? "continue" : ocrFail.reason,
  });

  if (!ocr.ok) {
    const status = ocr.action === "reject" ? "rejected" : "clarify";
    checkpoints.push({
      step_id: "confidence_gate",
      ok: false,
      detail: ocrFail.reason,
    });
    return {
      capability_id: "student.image_doubt.submit",
      workflow_id: "student.image_doubt.submit.v1",
      status,
      stop_reason: ocrFail.reason,
      message: ocrFail.message,
      invented_problem_text: false,
      ocr_text: null,
      normalised_question_text: null,
      extraction: ocr.extraction ?? null,
      checkpoints,
    };
  }

  // OCR ready path — still no invented text; only pass through extraction
  checkpoints.push({
    step_id: "confidence_gate",
    ok: true,
    detail: "extraction_confidence_ok",
  });

  return {
    capability_id: "student.image_doubt.submit",
    workflow_id: "student.image_doubt.submit.v1",
    status: "ocr_ready",
    stop_reason: "ocr_ready_awaiting_tutoring_route",
    message:
      "Image text extracted. Continue with typed confirmation if anything looks wrong.",
    invented_problem_text: false,
    ocr_text: ocr.extraction.ocr_text,
    normalised_question_text: ocr.extraction.normalised_question_text,
    extraction: ocr.extraction,
    checkpoints,
  };
}
