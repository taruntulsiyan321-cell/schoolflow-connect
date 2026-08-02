/**
 * Teacher question-paper planner — dry-run only.
 * Returns deterministic curriculum weight plan; does not generate questions via Qwen.
 */

export type PaperChapterSpec = {
  name: string;
  /** Optional relative weight hint; defaults to equal share. */
  weight_hint?: number;
};

export type DifficultyMix = {
  easy: number;
  medium: number;
  hard: number;
};

export type PaperPlanInput = {
  subject: string;
  grade?: string | null;
  board?: string | null;
  total_marks: number;
  chapters: PaperChapterSpec[];
  difficulty_mix?: Partial<DifficultyMix>;
  duration_minutes?: number | null;
};

export type ChapterAllocation = {
  chapter: string;
  weight: number;
  marks: number;
  question_slots: { easy: number; medium: number; hard: number };
};

export type QuestionPaperPlan = {
  capability_id: "teacher.question_paper.plan";
  dry_run: true;
  generates_questions: false;
  subject: string;
  grade: string | null;
  board: string | null;
  total_marks: number;
  duration_minutes: number | null;
  difficulty_mix: DifficultyMix;
  chapters: ChapterAllocation[];
  steps: Array<{ step_id: string; status: "planned"; description: string }>;
  notes: string[];
  plan_hash: string;
};

const DEFAULT_MIX: DifficultyMix = { easy: 0.3, medium: 0.5, hard: 0.2 };

function normalizeMix(mix?: Partial<DifficultyMix>): DifficultyMix {
  const easy = Math.max(0, mix?.easy ?? DEFAULT_MIX.easy);
  const medium = Math.max(0, mix?.medium ?? DEFAULT_MIX.medium);
  const hard = Math.max(0, mix?.hard ?? DEFAULT_MIX.hard);
  const sum = easy + medium + hard || 1;
  return {
    easy: Math.round((easy / sum) * 1000) / 1000,
    medium: Math.round((medium / sum) * 1000) / 1000,
    hard: Math.round((hard / sum) * 1000) / 1000,
  };
}

function simpleHash(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return `plan_${h.toString(16)}`;
}

function distributeMarks(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const sum = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (w / sum) * total);
  const floors = raw.map((x) => Math.floor(x));
  let rem = total - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  const out = [...floors];
  for (let k = 0; k < order.length && rem > 0; k++) {
    out[order[k]!.i]! += 1;
    rem -= 1;
  }
  return out;
}

function slotsForMarks(marks: number, mix: DifficultyMix): DifficultyMix {
  // Approximate 1 mark ≈ 1 easy slot unit; keep integers.
  const easy = Math.max(0, Math.round(marks * mix.easy));
  const hard = Math.max(0, Math.round(marks * mix.hard));
  let medium = Math.max(0, marks - easy - hard);
  if (easy + medium + hard !== marks) {
    medium = Math.max(0, marks - easy - hard);
  }
  return { easy, medium, hard };
}

/**
 * Deterministic curriculum-weight paper plan (no LLM, no question text).
 */
export function planQuestionPaper(input: PaperPlanInput): QuestionPaperPlan {
  const total = Math.max(0, Math.floor(Number(input.total_marks) || 0));
  const chapters = (input.chapters ?? [])
    .map((c) => ({ name: String(c.name ?? "").trim(), weight_hint: c.weight_hint }))
    .filter((c) => c.name.length > 0);
  const mix = normalizeMix(input.difficulty_mix);

  const weights =
    chapters.length === 0
      ? []
      : chapters.map((c) =>
          typeof c.weight_hint === "number" && c.weight_hint > 0 ? c.weight_hint : 1,
        );
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;
  const marks = distributeMarks(total, weights);

  const allocations: ChapterAllocation[] = chapters.map((c, i) => {
    const w = Math.round((weights[i]! / weightSum) * 1000) / 1000;
    const m = marks[i] ?? 0;
    return {
      chapter: c.name,
      weight: w,
      marks: m,
      question_slots: slotsForMarks(m, mix),
    };
  });

  const payload = JSON.stringify({
    subject: input.subject,
    grade: input.grade ?? null,
    board: input.board ?? null,
    total,
    mix,
    chapters: allocations.map((a) => ({ c: a.chapter, m: a.marks, w: a.weight })),
  });

  return {
    capability_id: "teacher.question_paper.plan",
    dry_run: true,
    generates_questions: false,
    subject: String(input.subject ?? "").trim() || "unspecified",
    grade: input.grade ?? null,
    board: input.board ?? null,
    total_marks: total,
    duration_minutes: input.duration_minutes ?? null,
    difficulty_mix: mix,
    chapters: allocations,
    steps: [
      {
        step_id: "permission_purpose",
        status: "planned",
        description: "Verify teacher assignment + purpose for paper planning",
      },
      {
        step_id: "assemble_spec",
        status: "planned",
        description: "Assemble ContentGenerationSpecification from curriculum inputs",
      },
      {
        step_id: "compute_weights",
        status: "planned",
        description: "Deterministic chapter marks + difficulty slot allocation",
      },
      {
        step_id: "emit_plan",
        status: "planned",
        description: "Return dry-run plan (no full paper generation)",
      },
      {
        step_id: "session_checkpoint",
        status: "planned",
        description: "Store plan_hash in paper_gen session memory",
      },
    ],
    notes: [
      "Dry-run only — full question generation remains deferred.",
      chapters.length === 0 ? "No chapters provided — empty allocation." : "Curriculum weights applied.",
    ],
    plan_hash: simpleHash(payload),
  };
}

/** Execute dry-run workflow steps in-memory (no provider calls). */
export function runPaperPlanDryRun(input: PaperPlanInput): {
  run_status: "completed";
  plan: QuestionPaperPlan;
  checkpoints: { step_id: string; at: string; ok: boolean }[];
} {
  const plan = planQuestionPaper(input);
  const at = new Date().toISOString();
  return {
    run_status: "completed",
    plan,
    checkpoints: plan.steps.map((s) => ({ step_id: s.step_id, at, ok: true })),
  };
}
