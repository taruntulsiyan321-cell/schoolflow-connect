/**
 * The quality gate every AI-written question passes before it reaches the bank
 * (TODO A2). One gate, used by every writer: AI Practice, recovery and upload
 * variants (ai-recovery-variants) and the report check's rewrites
 * (question-reports).
 *
 *   1. The rubric's RULES, with no model (questionRubric.ruleRefusal).
 *   2. At the same time, each on its own call that reasons first:
 *        - the ANSWER check: the question solved without its key, once per
 *          temperature asked for, by answerCheck.solveOnce — every solve must
 *          reach the key;
 *        - the REVIEW: graded against every criterion of the rubric, shown the
 *          key, with its difficulty judged.
 *   3. Kept only when every solve reached the key and every criterion passed —
 *      and, when a difficulty was asked for, the review judged it that.
 *
 * Why both: the answer check proves the key is consistent with the question;
 * it does not prove the question is good. Measured before this gate existed:
 * case passages carrying data the question never uses and match pairings that
 * were loose (KNOWN_ISSUES 114 item 2). And the answer check is not optional:
 * of forty recovery variants read by hand on 2026-09-17, four had no right
 * answer at all — numbers invented and never solved (an AP keyed as 6 terms
 * whose count works out to 6.75), or two right options — and a student was
 * marked correct on one of them. The solver is never told the key, and
 * answers "none" when no option or more than one is right. A failed or unreadable call keeps nothing:
 * a check that disappears when it errors is no check.
 *
 * What is kept carries its ReviewRecord, which store_generated_questions and
 * apply_question_report_verdict require (20261148000000) and keep on the row.
 *
 * Model calls are injected (`think` is completeThinking), so questionGate.test.ts
 * runs every branch with no network.
 */
import { describeSolves, solveOnce, type Solved, type Think } from "./answerCheck.ts";
import { letterOf } from "./explanationFormat.ts";
import type { QuestionForm } from "./questionForms.ts";
import {
  type ChapterScope,
  type CriterionId,
  failedCriteria,
  type JudgedDifficulty,
  readRubricReview,
  reviewRecord,
  type ReviewRecord,
  reviewSystemPrompt,
  reviewUserPrompt,
  ruleRefusal,
  type RubricReview,
} from "./questionRubric.ts";
import { readModelJson } from "./aiPractice.ts";

export type GateDraft = {
  subject: string | null;
  chapter: string | null;
  topic: string | null;
  form: QuestionForm;
  question: string;
  options: ReadonlyArray<string>;
  correctIndex: number;
  /** The chapter's official syllabus, which the reviewer judges "syllabus" by (20261149000000). */
  scope?: ChapterScope | null;
};

export type GateOutcome =
  | { kept: true; review: ReviewRecord }
  | {
      kept: false;
      stage: "rule" | "answer" | "review";
      reason: string;
      /** The criteria the review failed — counted over a batch. */
      failed: CriterionId[];
      /** The review, when one was read — kept for the record even on a refusal. */
      review: ReviewRecord | null;
    };

/** Room for the reviewer's reasoning, and for its marks after it. */
export const REVIEW_TOKENS = 9000;
export const REVIEW_THINKING = 5000;

async function reviewOnce(think: Think, label: string, d: GateDraft): Promise<RubricReview | null> {
  const r = await think({
    system: reviewSystemPrompt(label),
    user: reviewUserPrompt(d),
    temperature: 0,
    max_tokens: REVIEW_TOKENS,
    reasoning_tokens: REVIEW_THINKING,
  });
  if (!r.ok) return null;
  try {
    return readRubricReview(readModelJson(r.text));
  } catch {
    return null;
  }
}

export async function gateQuestion(
  deps: { think: Think; model: string; now?: () => Date },
  label: string,
  d: GateDraft,
  opts: { solveTemperatures?: ReadonlyArray<number>; difficulty?: JudgedDifficulty | null } = {},
): Promise<GateOutcome> {
  const rule = ruleRefusal(d);
  if (rule) return { kept: false, stage: "rule", reason: rule, failed: [], review: null };

  const temperatures = opts.solveTemperatures?.length ? opts.solveTemperatures : [0];
  const [solves, review] = await Promise.all([
    Promise.all(temperatures.map((t) => solveOnce(deps.think, label, { question: d.question, options: [...d.options] }, t))),
    reviewOnce(deps.think, label, d),
  ]);
  const record = review ? reviewRecord(review, solves.map((s: Solved) => s.index), deps.model, (deps.now ?? (() => new Date()))()) : null;
  const failed = review ? review.marks.filter((m) => !m.pass).map((m) => m.criterion) : [];

  if (!solves.every((s) => s.index === d.correctIndex)) {
    return {
      kept: false,
      stage: "answer",
      reason: `solved without the key as ${describeSolves(solves)}; the key is (${letterOf(d.correctIndex)})`,
      failed,
      review: record,
    };
  }
  if (!review || !record) {
    return { kept: false, stage: "review", reason: "the quality review gave no readable marks", failed: [], review: null };
  }
  if (!review.passed) {
    return {
      kept: false,
      stage: "review",
      reason: `failed the rubric: ${failedCriteria(review)}`,
      failed,
      review: record,
    };
  }
  if (opts.difficulty && review.difficulty !== opts.difficulty) {
    return {
      kept: false,
      stage: "review",
      reason: `${opts.difficulty} was asked for; the review judged it ${review.difficulty}`,
      failed: [],
      review: record,
    };
  }
  return { kept: true, review: record };
}

/** What became of a batch of drafts at the gate — the measure A2 is done by. */
export type GateTally = {
  gated: number;
  kept: number;
  rule: Record<string, number>;
  answer: number;
  review: number;
  criteria: Partial<Record<CriterionId, number>>;
};

export function tallyGate(outcomes: ReadonlyArray<GateOutcome>): GateTally {
  const t: GateTally = { gated: outcomes.length, kept: 0, rule: {}, answer: 0, review: 0, criteria: {} };
  for (const o of outcomes) {
    if (o.kept) { t.kept++; continue; }
    if (o.stage === "rule") t.rule[o.reason] = (t.rule[o.reason] ?? 0) + 1;
    else if (o.stage === "answer") t.answer++;
    else t.review++;
    for (const c of o.failed) t.criteria[c] = (t.criteria[c] ?? 0) + 1;
  }
  return t;
}
