/**
 * Teacher question-paper outline (step 1) — plan + bounded Qwen outline.
 * No full marking scheme; kill-switch respectful (facts/plan-only when generative off).
 */

import { planQuestionPaper, type PaperPlanInput, type QuestionPaperPlan } from "./questionPaperPlan.ts";
import { buildContextPack, packForModel } from "./contextBuilder.ts";
import { getBuiltinPrompt, renderPromptTemplate } from "./promptLibrary.ts";
import { validateModelResponse } from "./responseValidator.ts";

export type OutlineGenerationMode = "plan_only" | "outline_with_model";

export type PaperOutlineInput = PaperPlanInput & {
  /** When false / kill-switch, return plan without model outline. */
  may_call_model?: boolean;
  teacher_notes?: string | null;
};

export type PaperOutlineSection = {
  chapter: string;
  marks: number;
  suggested_question_stems: string[];
  difficulty_hint: string;
};

export type QuestionPaperOutline = {
  capability_id: "teacher.question_paper.generate_outline";
  dry_run: false;
  generates_full_paper: false;
  generates_marking_scheme: false;
  mode: OutlineGenerationMode;
  plan: QuestionPaperPlan;
  outline_text: string | null;
  sections: PaperOutlineSection[];
  validation_ok: boolean | null;
  validation_codes: string[];
  degraded_reason: string | null;
  plan_hash: string;
  notes: string[];
};

/** Deterministic skeleton sections from the dry-run plan (no invented stems). */
export function buildOutlineSectionsFromPlan(plan: QuestionPaperPlan): PaperOutlineSection[] {
  return plan.chapters.map((c) => {
    const slots = c.question_slots;
    const hintParts: string[] = [];
    if (slots.easy) hintParts.push(`${slots.easy} easy`);
    if (slots.medium) hintParts.push(`${slots.medium} medium`);
    if (slots.hard) hintParts.push(`${slots.hard} hard`);
    return {
      chapter: c.chapter,
      marks: c.marks,
      suggested_question_stems: [],
      difficulty_hint: hintParts.length ? hintParts.join(", ") : "unallocated",
    };
  });
}

export function buildOutlineContextPack(input: PaperOutlineInput, plan: QuestionPaperPlan) {
  return buildContextPack({
    capability: "teacher.question_paper.generate_outline",
    request_text: input.teacher_notes ?? `Outline for ${plan.subject}`,
    ae: {
      subject: plan.subject,
      grade: plan.grade,
      board: plan.board,
      total_marks: plan.total_marks,
      duration_minutes: plan.duration_minutes,
      chapters: plan.chapters.map((c) => ({
        chapter: c.chapter,
        marks: c.marks,
        weight: c.weight,
        slots: c.question_slots,
      })),
      data_version: plan.plan_hash,
      completeness: plan.chapters.length ? 0.85 : 0.2,
      source_as_of: new Date().toISOString(),
    },
    eie: null,
    tier_signals: {
      facts_complete: plan.chapters.length > 0,
      budget_pressure: false,
      capability_default: "medium",
    },
  });
}

/** Render Prompt Library templates for outline (offline-safe). */
export function renderOutlinePrompt(plan: QuestionPaperPlan, teacherNotes?: string | null): {
  system: string;
  user: string;
  facts_json: string;
} {
  const prompt = getBuiltinPrompt("teacher.question_paper.generate_outline");
  const pack = buildOutlineContextPack(
    {
      subject: plan.subject,
      grade: plan.grade,
      board: plan.board,
      total_marks: plan.total_marks,
      chapters: plan.chapters.map((c) => ({ name: c.chapter, weight_hint: c.weight })),
      teacher_notes: teacherNotes,
    },
    plan,
  );
  const facts = packForModel(pack);
  const system = prompt
    ? renderPromptTemplate(prompt.system_template, { facts })
    : "You draft a short question-paper outline from the provided curriculum weight plan only. Do not invent marks totals or chapter lists. No full marking scheme. Keep under 200 words.";
  const user = prompt
    ? renderPromptTemplate(prompt.user_template, {
        facts,
        question: teacherNotes?.trim() || "Generate a section outline only.",
      })
    : `Plan JSON:\n${facts}\n\nWrite a brief outline of section stems aligned to chapter marks. No marking scheme.`;
  return { system, user, facts_json: facts };
}

/**
 * Build outline artifact. Pass model_text when Qwen succeeded; otherwise plan-only.
 */
export function buildQuestionPaperOutline(input: {
  planInput: PaperOutlineInput;
  model_text?: string | null;
  may_call_model?: boolean;
  model_error?: string | null;
}): QuestionPaperOutline {
  const plan = planQuestionPaper(input.planInput);
  const sections = buildOutlineSectionsFromPlan(plan);
  const mayCall = input.may_call_model !== false && input.planInput.may_call_model !== false;
  const notes = [
    "Step 1 outline only — full paper + marking scheme remain deferred.",
    "Curriculum weights come from deterministic plan (not the model).",
  ];

  if (!mayCall) {
    return {
      capability_id: "teacher.question_paper.generate_outline",
      dry_run: false,
      generates_full_paper: false,
      generates_marking_scheme: false,
      mode: "plan_only",
      plan,
      outline_text: null,
      sections,
      validation_ok: null,
      validation_codes: [],
      degraded_reason: "generative_kill_switch_or_disabled",
      plan_hash: plan.plan_hash,
      notes: [...notes, "Generative path disabled — returning plan skeleton only."],
    };
  }

  const text = input.model_text?.trim() || null;
  if (!text) {
    return {
      capability_id: "teacher.question_paper.generate_outline",
      dry_run: false,
      generates_full_paper: false,
      generates_marking_scheme: false,
      mode: "plan_only",
      plan,
      outline_text: null,
      sections,
      validation_ok: null,
      validation_codes: [],
      degraded_reason: input.model_error ?? "model_unavailable",
      plan_hash: plan.plan_hash,
      notes: [...notes, "Model unavailable — plan skeleton only."],
    };
  }

  const allowed = plan.chapters.flatMap((c) => [c.marks, c.weight * 100]).filter(Number.isFinite);
  const validation = validateModelResponse(
    text,
    {
      allowed_pcts: allowed,
      avg_mastery: null,
      attendance_pct: null,
      average_marks_pct: null,
    },
    { max_chars: 4000, system_template: getBuiltinPrompt("teacher.question_paper.generate_outline")?.system_template },
  );

  if (validation.material_failure) {
    return {
      capability_id: "teacher.question_paper.generate_outline",
      dry_run: false,
      generates_full_paper: false,
      generates_marking_scheme: false,
      mode: "plan_only",
      plan,
      outline_text: null,
      sections,
      validation_ok: false,
      validation_codes: validation.codes,
      degraded_reason: "validation_failed",
      plan_hash: plan.plan_hash,
      notes: [...notes, "Model outline failed validation — plan skeleton only."],
    };
  }

  return {
    capability_id: "teacher.question_paper.generate_outline",
    dry_run: false,
    generates_full_paper: false,
    generates_marking_scheme: false,
    mode: "outline_with_model",
    plan,
    outline_text: text,
    sections,
    validation_ok: validation.ok,
    validation_codes: validation.codes,
    degraded_reason: null,
    plan_hash: plan.plan_hash,
    notes,
  };
}
