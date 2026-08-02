/**
 * Post-OCR gated tutoring — student.image_doubt.solve
 * Requires reconstructed_question + extraction_confidence; refuses low OCR confidence.
 * Order: confidence gate → cache → KMS retrieve → bounded model explain + Validator/Confidence.
 * Never invents problem text from images.
 */

import { validateModelResponse } from "./responseValidator";
import { scoreConfidence, applyConfidencePolicy } from "./confidenceEngine";
import { getBuiltinPrompt, renderPromptTemplate } from "./promptLibrary";

export const IMAGE_DOUBT_CONFIDENCE_THRESHOLD = 0.55;

export type ImageDoubtSolveStepResult = {
  step_id: string;
  ok: boolean;
  detail: string;
};

export type ImageDoubtSolveInput = {
  reconstructed_question: string | null | undefined;
  extraction_confidence: number | null | undefined;
  /** Optional L3/solution-cache hit text (permission-safe). */
  cached_explanation?: string | null;
  /** KMS retrieval snippets (approved only). */
  retrieval_snippets?: string[] | null;
  /** Model draft when generative path ran. */
  model_text?: string | null;
  may_call_model?: boolean;
  model_error?: string | null;
};

export type ImageDoubtSolveResult = {
  capability_id: "student.image_doubt.solve";
  workflow_id: "student.image_doubt.solve.v1";
  status: "clarify" | "cache_hit" | "retrieval" | "model" | "facts_only" | "rejected";
  stop_reason: string;
  message: string;
  invented_problem_text: false;
  reconstructed_question: string | null;
  extraction_confidence: number;
  explanation: string | null;
  used_model: boolean;
  cache_hit: boolean;
  retrieval_hit: boolean;
  validation_ok: boolean | null;
  validation_codes: string[];
  confidence: number | null;
  confidence_action: string | null;
  checkpoints: ImageDoubtSolveStepResult[];
  notes: string[];
};

function normalizeQuestion(q: string | null | undefined): string | null {
  const t = (q ?? "").trim();
  return t.length ? t.slice(0, 4000) : null;
}

export function gateImageDoubtSolveConfidence(input: {
  reconstructed_question: string | null | undefined;
  extraction_confidence: number | null | undefined;
}): { ok: true; question: string; confidence: number } | { ok: false; reason: string; message: string } {
  const question = normalizeQuestion(input.reconstructed_question);
  const conf =
    typeof input.extraction_confidence === "number" && Number.isFinite(input.extraction_confidence)
      ? Math.max(0, Math.min(1, input.extraction_confidence))
      : null;

  if (!question) {
    return {
      ok: false,
      reason: "reconstructed_question_required",
      message:
        "Please provide the reconstructed question text (from OCR or typed confirmation) before tutoring.",
    };
  }
  if (conf == null) {
    return {
      ok: false,
      reason: "extraction_confidence_required",
      message: "Extraction confidence is required. Retake a clearer photo or type the question.",
    };
  }
  if (conf < IMAGE_DOUBT_CONFIDENCE_THRESHOLD) {
    return {
      ok: false,
      reason: "low_extraction_confidence",
      message:
        "I could not read that image reliably enough to tutor. Retake a clearer photo or type the question.",
    };
  }
  return { ok: true, question, confidence: conf };
}

/** Render Prompt Library templates for image-doubt solve (offline-safe). */
export function renderImageDoubtSolvePrompt(input: {
  question: string;
  retrieval_snippets?: string[] | null;
}): { system: string; user: string; facts_json: string } {
  const prompt = getBuiltinPrompt("student.image_doubt.solve");
  const facts = JSON.stringify({
    reconstructed_question: input.question,
    retrieval_snippets: (input.retrieval_snippets ?? []).slice(0, 5),
    note: "Explain the question step-by-step. Do not invent mastery or marks percentages.",
  });
  const system = prompt
    ? renderPromptTemplate(prompt.system_template, { facts })
    : "You tutor from the reconstructed question text and approved retrieval snippets only. Never invent mastery, attendance, or marks percentages. Prefer stepwise guidance. Keep under 180 words.";
  const user = prompt
    ? renderPromptTemplate(prompt.user_template, {
        facts,
        question: input.question,
      })
    : `Question:\n${input.question}\n\nApproved snippets:\n${facts}\n\nExplain briefly.`;
  return { system, user, facts_json: facts };
}

/**
 * Gated post-OCR tutoring path (deterministic control-plane).
 * Pass cache / retrieval / model results from the Router; this module never invents text.
 */
export function runImageDoubtSolve(input: ImageDoubtSolveInput): ImageDoubtSolveResult {
  const checkpoints: ImageDoubtSolveStepResult[] = [];
  const notes = [
    "Post-OCR tutoring gated on reconstructed_question + extraction_confidence.",
    "Order: confidence gate → cache → KMS retrieve → model (Validator/Confidence).",
  ];

  const gate = gateImageDoubtSolveConfidence(input);
  checkpoints.push({
    step_id: "confidence_gate",
    ok: gate.ok,
    detail: gate.ok ? `confidence_${gate.confidence}` : gate.reason,
  });
  if (!gate.ok) {
    return {
      capability_id: "student.image_doubt.solve",
      workflow_id: "student.image_doubt.solve.v1",
      status: "clarify",
      stop_reason: gate.reason,
      message: gate.message,
      invented_problem_text: false,
      reconstructed_question: normalizeQuestion(input.reconstructed_question),
      extraction_confidence:
        typeof input.extraction_confidence === "number" ? input.extraction_confidence : 0,
      explanation: null,
      used_model: false,
      cache_hit: false,
      retrieval_hit: false,
      validation_ok: null,
      validation_codes: [],
      confidence: null,
      confidence_action: null,
      checkpoints,
      notes,
    };
  }

  const question = gate.question;
  const extraction_confidence = gate.confidence;

  // cache_lookup
  const cached = input.cached_explanation?.trim() || null;
  checkpoints.push({
    step_id: "cache_lookup",
    ok: true,
    detail: cached ? "cache_hit" : "cache_miss",
  });
  if (cached) {
    return {
      capability_id: "student.image_doubt.solve",
      workflow_id: "student.image_doubt.solve.v1",
      status: "cache_hit",
      stop_reason: "solution_cache_hit",
      message: "Answered from permission-safe solution cache.",
      invented_problem_text: false,
      reconstructed_question: question,
      extraction_confidence,
      explanation: cached,
      used_model: false,
      cache_hit: true,
      retrieval_hit: false,
      validation_ok: null,
      validation_codes: [],
      confidence: 0.9,
      confidence_action: "none",
      checkpoints: [
        ...checkpoints,
        { step_id: "retrieve_kms", ok: true, detail: "skipped_cache_hit" },
        { step_id: "model_explain", ok: true, detail: "skipped_cache_hit" },
        { step_id: "validate_answer", ok: true, detail: "cache_trusted" },
      ],
      notes: [...notes, "Cache hit — no model call."],
    };
  }

  // retrieve_kms
  const snippets = (input.retrieval_snippets ?? [])
    .map((s) => String(s).trim())
    .filter(Boolean)
    .slice(0, 8);
  const retrieval_hit = snippets.length > 0;
  checkpoints.push({
    step_id: "retrieve_kms",
    ok: true,
    detail: retrieval_hit ? `hits_${snippets.length}` : "no_kms_hits",
  });

  const mayCall = input.may_call_model !== false;
  const modelText = input.model_text?.trim() || null;

  if (!mayCall || !modelText) {
    const retrievalOnly = retrieval_hit
      ? `Based on approved school knowledge:\n${snippets.slice(0, 3).join("\n")}`
      : null;
    checkpoints.push({
      step_id: "model_explain",
      ok: false,
      detail: !mayCall
        ? input.model_error ?? "generative_disabled"
        : input.model_error ?? "model_unavailable",
    });
    checkpoints.push({
      step_id: "validate_answer",
      ok: true,
      detail: retrievalOnly ? "retrieval_facts_only" : "no_model_no_retrieval",
    });
    return {
      capability_id: "student.image_doubt.solve",
      workflow_id: "student.image_doubt.solve.v1",
      status: retrievalOnly ? "retrieval" : "facts_only",
      stop_reason: !mayCall
        ? input.model_error ?? "generative_kill_switch"
        : input.model_error ?? "model_unavailable",
      message: retrievalOnly
        ? "Showing approved knowledge snippets while generative tutoring is unavailable."
        : "I could not generate a tutoring explanation right now. Try typing a clearer question.",
      invented_problem_text: false,
      reconstructed_question: question,
      extraction_confidence,
      explanation: retrievalOnly,
      used_model: false,
      cache_hit: false,
      retrieval_hit,
      validation_ok: null,
      validation_codes: [],
      confidence: retrievalOnly ? 0.7 : 0.4,
      confidence_action: retrievalOnly ? "safer_narrower_answer" : "clarification",
      checkpoints,
      notes: [...notes, "Model path skipped — retrieval/facts only."],
    };
  }

  // model_explain + validate
  checkpoints.push({
    step_id: "model_explain",
    ok: true,
    detail: "model_draft",
  });

  const validation = validateModelResponse(
    modelText,
    { allowed_pcts: [], avg_mastery: null, attendance_pct: null, average_marks_pct: null },
    { max_chars: 3500 },
  );
  const conf = scoreConfidence({
    used_model: true,
    completeness: retrieval_hit ? 0.75 : 0.55,
    validation,
    route_class: "multimodal",
    budget_tier: "medium",
  });
  const applied = applyConfidencePolicy(
    { explanation: modelText, facts: { reconstructed_question: question, snippets } },
    conf,
  );

  checkpoints.push({
    step_id: "validate_answer",
    ok: !validation.material_failure && conf.action !== "facts_only",
    detail: validation.material_failure
      ? validation.codes.join(",")
      : `confidence_${conf.confidence}`,
  });

  if (validation.material_failure || conf.action === "facts_only") {
    const fallback = retrieval_hit
      ? `Based on approved school knowledge:\n${snippets.slice(0, 3).join("\n")}`
      : null;
    return {
      capability_id: "student.image_doubt.solve",
      workflow_id: "student.image_doubt.solve.v1",
      status: fallback ? "retrieval" : "facts_only",
      stop_reason: "validation_or_low_confidence",
      message:
        "The generated explanation did not pass quality checks. Showing safer grounded content only.",
      invented_problem_text: false,
      reconstructed_question: question,
      extraction_confidence,
      explanation: fallback,
      used_model: false,
      cache_hit: false,
      retrieval_hit,
      validation_ok: false,
      validation_codes: validation.codes,
      confidence: conf.confidence,
      confidence_action: conf.action,
      checkpoints,
      notes: [...notes, "Validator/Confidence blocked generative answer."],
    };
  }

  return {
    capability_id: "student.image_doubt.solve",
    workflow_id: "student.image_doubt.solve.v1",
    status: "model",
    stop_reason: "answered_model",
    message: "Tutoring explanation ready.",
    invented_problem_text: false,
    reconstructed_question: question,
    extraction_confidence,
    explanation: applied.explanation ?? modelText,
    used_model: true,
    cache_hit: false,
    retrieval_hit,
    validation_ok: validation.ok,
    validation_codes: validation.codes,
    confidence: applied.confidence,
    confidence_action: applied.confidence_action,
    checkpoints,
    notes,
  };
}
