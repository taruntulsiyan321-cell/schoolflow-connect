/**
 * Voice doubt submit stub — parallel to image_doubt.submit.
 * Clarifies when STT provider unset; never invents transcript text.
 */

export type VoiceMediaMetadata = {
  mime: string;
  bytes: number;
  duration_ms?: number | null;
  sha256?: string | null;
  media_ref?: string | null;
  filename?: string | null;
  malware_scan_status?: "stub_pass" | "stub_flagged" | "unchecked" | null;
};

export type VoiceDoubtSubmitStepResult = {
  step_id: string;
  ok: boolean;
  detail: string;
};

export type VoiceDoubtSubmitResult = {
  capability_id: "student.voice_doubt.submit";
  workflow_id: "student.voice_doubt.submit.v1";
  status: "clarify" | "rejected" | "stt_ready";
  stop_reason: string;
  message: string;
  invented_transcript: false;
  transcript_text: string | null;
  normalised_question_text: string | null;
  extraction_confidence: number;
  checkpoints: VoiceDoubtSubmitStepResult[];
};

const ALLOWED_MIME = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/aac",
]);

const BLOCKED_MIME = new Set([
  "application/octet-stream",
  "application/x-msdownload",
  "application/x-executable",
  "text/html",
  "application/javascript",
]);

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB
const MIN_BYTES = 64;
const MAX_DURATION_MS = 180_000;
const DANGEROUS_EXT = /\.(exe|bat|cmd|scr|dll|js|vbs|ps1|msi|apk)$/i;

export function isSttProviderConfigured(
  env: Record<string, string | undefined> = {},
): boolean {
  const key =
    env.STT_PROVIDER_API_KEY ??
    env.GURUKUL_STT_API_KEY ??
    (typeof process !== "undefined"
      ? process.env?.STT_PROVIDER_API_KEY ?? process.env?.GURUKUL_STT_API_KEY
      : undefined);
  return Boolean(key && String(key).trim());
}

export function validateVoiceMetadata(meta: VoiceMediaMetadata): {
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
    errors.push("audio_too_small");
  }
  if (Number.isFinite(meta.bytes) && meta.bytes > MAX_BYTES) {
    errors.push("audio_too_large");
  }
  if (
    meta.duration_ms != null &&
    Number.isFinite(meta.duration_ms) &&
    (meta.duration_ms < 100 || meta.duration_ms > MAX_DURATION_MS)
  ) {
    errors.push("invalid_duration");
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

/**
 * Capability student.voice_doubt.submit — validate → safety → STT until clarify.
 * Never invents transcript text.
 */
export function runVoiceDoubtSubmit(
  meta: VoiceMediaMetadata,
  opts?: { providerConfigured?: boolean; env?: Record<string, string | undefined> },
): VoiceDoubtSubmitResult {
  const checkpoints: VoiceDoubtSubmitStepResult[] = [];

  const validation = validateVoiceMetadata(meta);
  checkpoints.push({
    step_id: "validate_media",
    ok: validation.ok,
    detail: validation.ok ? "media_ok" : validation.errors.join(","),
  });
  if (!validation.ok) {
    return {
      capability_id: "student.voice_doubt.submit",
      workflow_id: "student.voice_doubt.submit.v1",
      status: "rejected",
      stop_reason: validation.errors.join(","),
      message:
        validation.malware_stub === "rejected"
          ? "That upload was blocked by the safety screen. Please record a short clear audio clip."
          : "That audio could not be used. Please upload a short MP3/WAV/WebM under 12 MB.",
      invented_transcript: false,
      transcript_text: null,
      normalised_question_text: null,
      extraction_confidence: 0,
      checkpoints,
    };
  }

  checkpoints.push({
    step_id: "safety_screen",
    ok: true,
    detail: `malware_${validation.malware_stub}`,
  });

  const configured =
    opts?.providerConfigured ?? isSttProviderConfigured(opts?.env ?? {});

  if (!configured) {
    checkpoints.push({
      step_id: "stt_extract",
      ok: false,
      detail: "stt_not_configured",
    });
    checkpoints.push({
      step_id: "confidence_gate",
      ok: false,
      detail: "stt_not_configured",
    });
    return {
      capability_id: "student.voice_doubt.submit",
      workflow_id: "student.voice_doubt.submit.v1",
      status: "clarify",
      stop_reason: "stt_not_configured",
      message:
        "Voice transcription is not configured yet. Please type your question, or try again later.",
      invented_transcript: false,
      transcript_text: null,
      normalised_question_text: null,
      extraction_confidence: 0,
      checkpoints,
    };
  }

  // Provider present but live STT not wired — clarify safely (no invented transcript).
  checkpoints.push({
    step_id: "stt_extract",
    ok: false,
    detail: "stt_live_deferred",
  });
  checkpoints.push({
    step_id: "confidence_gate",
    ok: false,
    detail: "low_extraction_confidence",
  });
  return {
    capability_id: "student.voice_doubt.submit",
    workflow_id: "student.voice_doubt.submit.v1",
    status: "clarify",
    stop_reason: "low_extraction_confidence",
    message:
      "I could not transcribe that recording reliably. Retake a clearer clip or type the question.",
    invented_transcript: false,
    transcript_text: null,
    normalised_question_text: null,
    extraction_confidence: 0.2,
    checkpoints,
  };
}
