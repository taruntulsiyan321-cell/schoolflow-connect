/**
 * Teacher question-paper marking scheme (step after outline).
 * Requires outline artifact in session memory; Qwen + Validator; kill-switch → safe degrade.
 */

import { validateModelResponse } from "./responseValidator.ts";
import { getBuiltinPrompt, renderPromptTemplate } from "./promptLibrary.ts";
import type { QuestionPaperPlan } from "./questionPaperPlan.ts";

export type MarkingSchemeMode = "outline_required" | "scheme_with_model" | "plan_only";

export type MarkingSchemeInput = {
  /** Must be true — outline already stored in paper_gen session. */
  outline_in_session: boolean;
  plan_hash?: string | null;
  outline_text?: string | null;
  plan?: QuestionPaperPlan | null;
  subject?: string | null;
  total_marks?: number | null;
  may_call_model?: boolean;
  model_text?: string | null;
  model_error?: string | null;
  teacher_notes?: string | null;
};

export type QuestionPaperMarkingScheme = {
  capability_id: "teacher.question_paper.marking_scheme";
  dry_run: false;
  generates_full_paper: false;
  generates_marking_scheme: true;
  mode: MarkingSchemeMode;
  plan_hash: string | null;
  outline_text: string | null;
  marking_scheme_text: string | null;
  validation_ok: boolean | null;
  validation_codes: string[];
  degraded_reason: string | null;
  notes: string[];
};

export function renderMarkingSchemePrompt(input: {
  outline_text: string;
  plan_hash?: string | null;
  subject?: string | null;
  total_marks?: number | null;
  teacher_notes?: string | null;
}): { system: string; user: string; facts_json: string } {
  const prompt = getBuiltinPrompt("teacher.question_paper.marking_scheme");
  const facts = JSON.stringify({
    plan_hash: input.plan_hash ?? null,
    subject: input.subject ?? null,
    total_marks: input.total_marks ?? null,
    outline_text: input.outline_text.slice(0, 3000),
    note: "Draft a brief marking scheme aligned to the outline only. Do not invent chapters or change totals.",
  });
  const system = prompt
    ? renderPromptTemplate(prompt.system_template, { facts })
    : "You draft a short marking scheme from the provided paper outline only. Never invent chapter lists or change total marks. Keep under 220 words. No full paper body.";
  const user = prompt
    ? renderPromptTemplate(prompt.user_template, {
        facts,
        question: input.teacher_notes?.trim() || "Draft marking scheme for this outline.",
      })
    : `Outline:\n${input.outline_text}\n\nFacts:\n${facts}\n\nWrite a brief marking scheme.`;
  return { system, user, facts_json: facts };
}

/**
 * Build marking scheme only when session memory already holds an outline.
 */
export function buildQuestionPaperMarkingScheme(
  input: MarkingSchemeInput,
): QuestionPaperMarkingScheme {
  const notes = [
    "Marking scheme step requires prior outline in paper_gen session memory.",
    "Kill-switch / validation failures degrade safely without inventing schemes.",
  ];
  const plan_hash = input.plan_hash?.trim() || input.plan?.plan_hash || null;
  const outline_text = input.outline_text?.trim() || null;

  if (!input.outline_in_session || !outline_text) {
    return {
      capability_id: "teacher.question_paper.marking_scheme",
      dry_run: false,
      generates_full_paper: false,
      generates_marking_scheme: true,
      mode: "outline_required",
      plan_hash,
      outline_text,
      marking_scheme_text: null,
      validation_ok: null,
      validation_codes: [],
      degraded_reason: "outline_required_in_session",
      notes: [
        ...notes,
        "No outline in session — run teacher.question_paper.generate_outline first.",
      ],
    };
  }

  const mayCall = input.may_call_model !== false;
  if (!mayCall) {
    return {
      capability_id: "teacher.question_paper.marking_scheme",
      dry_run: false,
      generates_full_paper: false,
      generates_marking_scheme: true,
      mode: "plan_only",
      plan_hash,
      outline_text,
      marking_scheme_text: null,
      validation_ok: null,
      validation_codes: [],
      degraded_reason: "generative_kill_switch_or_disabled",
      notes: [...notes, "Generative path disabled — outline retained, no scheme text."],
    };
  }

  const text = input.model_text?.trim() || null;
  if (!text) {
    return {
      capability_id: "teacher.question_paper.marking_scheme",
      dry_run: false,
      generates_full_paper: false,
      generates_marking_scheme: true,
      mode: "plan_only",
      plan_hash,
      outline_text,
      marking_scheme_text: null,
      validation_ok: null,
      validation_codes: [],
      degraded_reason: input.model_error ?? "model_unavailable",
      notes: [...notes, "Model unavailable — outline retained, no scheme text."],
    };
  }

  const allowed: number[] = [];
  if (typeof input.total_marks === "number" && Number.isFinite(input.total_marks)) {
    allowed.push(input.total_marks);
  }
  if (input.plan?.chapters) {
    for (const c of input.plan.chapters) {
      if (Number.isFinite(c.marks)) allowed.push(c.marks);
    }
  }

  const validation = validateModelResponse(
    text,
    {
      allowed_pcts: allowed,
      avg_mastery: null,
      attendance_pct: null,
      average_marks_pct: null,
    },
    { max_chars: 4500, system_template: getBuiltinPrompt("teacher.question_paper.marking_scheme")?.system_template },
  );

  if (validation.material_failure) {
    return {
      capability_id: "teacher.question_paper.marking_scheme",
      dry_run: false,
      generates_full_paper: false,
      generates_marking_scheme: true,
      mode: "plan_only",
      plan_hash,
      outline_text,
      marking_scheme_text: null,
      validation_ok: false,
      validation_codes: validation.codes,
      degraded_reason: "validation_failed",
      notes: [...notes, "Model marking scheme failed validation — dropped."],
    };
  }

  return {
    capability_id: "teacher.question_paper.marking_scheme",
    dry_run: false,
    generates_full_paper: false,
    generates_marking_scheme: true,
    mode: "scheme_with_model",
    plan_hash,
    outline_text,
    marking_scheme_text: text,
    validation_ok: validation.ok,
    validation_codes: validation.codes,
    degraded_reason: null,
    notes,
  };
}
