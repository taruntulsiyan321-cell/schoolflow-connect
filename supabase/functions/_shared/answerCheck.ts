/**
 * Checking a multiple-choice answer: solving a question WITHOUT its key, and
 * writing the explanation for a key once it is trusted. The one home of both,
 * used by question-explanations (every exam question's explanation) and
 * question-reports (a student's report on one question).
 *
 * The model calls come in as arguments — `think` is completeThinking (the
 * check reasons before it answers: with reasoning off it reached wrong answers
 * on correctly keyed Accountancy questions, 2026-10-02) and `complete` is
 * completeWithQwen — so these rules are tested with no network. Each is
 * declared here by what it must return, so this module imports neither (both
 * read Deno's environment, which the app's typecheck and vitest do not have).
 */
import { readModelJson, readSolveText, solveSystemPrompt, solveUserPrompt } from "./aiPractice.ts";
import {
  composeExplanation,
  explainSystemPrompt,
  explainUserPrompt,
  explanationShortfall,
  letterOf,
  readExplanationParts,
} from "./explanationFormat.ts";

export type Think = (input: {
  system: string;
  user: string;
  max_tokens: number;
  reasoning_tokens: number;
  temperature?: number;
}) => Promise<{ ok: true; text: string; finish_reason: string | null } | { ok: false; error: string }>;

export type Complete = (input: {
  system: string;
  user: string;
  max_tokens: number;
  temperature: number;
}) => Promise<{ ok: boolean; text?: string }>;

/** The exam a question is written for, as the model is told it. */
const EXAM_LABELS: Record<string, string> = { cuet: "CUET (UG)" };

export function examLabel(q: { exam_code?: string | null; class_level?: number | null; board?: string | null }): string {
  if (q.exam_code) return EXAM_LABELS[q.exam_code] ?? q.exam_code.toUpperCase();
  const board = q.board && q.board !== "both" ? ` ${q.board.toUpperCase()}` : "";
  return q.class_level ? `Class ${q.class_level}${board} board exams` : "school exams";
}

/** Room for the thinking, and for a short JSON answer after it. */
export const SOLVE_TOKENS = 8000;
export const SOLVE_THINKING = 5000;

export type Solved = { index: number | null; why: "answer" | "none" | "cut off" | "unreadable" | "no reply" };

export type CheckQuestion = { question: string; options: string[] };

/** One solve of one question, without its key. */
export async function solveOnce(think: Think, label: string, q: CheckQuestion, temperature: number): Promise<Solved> {
  const r = await think({
    system: solveSystemPrompt(label),
    user: solveUserPrompt([q]),
    temperature,
    max_tokens: SOLVE_TOKENS,
    reasoning_tokens: SOLVE_THINKING,
  });
  if (!r.ok) return { index: null, why: r.error === "cut off while thinking" ? "cut off" : "no reply" };
  const index = readSolveText(r.text, 1)[0];
  if (index != null) return { index, why: "answer" };
  if (r.finish_reason === "length") return { index: null, why: "cut off" };
  return /"answer"\s*:\s*"none"/i.test(r.text) ? { index: null, why: "none" } : { index: null, why: "unreadable" };
}

/** "(B), then no single answer, then no answer (cut off)" — what the solves said, for a review note. */
export function describeSolves(solves: ReadonlyArray<Solved>): string {
  return solves
    .map((x) => (x.index != null ? `(${letterOf(x.index)})` : x.why === "none" ? "no single answer" : `no answer (${x.why})`))
    .join(", then ");
}

/**
 * The explanation for a key that is trusted: the working, and why each other
 * option is wrong (explanationFormat). Asked twice at most — the second time
 * told what the first fell short of. Null when neither reply makes one.
 */
export async function writeExplanation(
  complete: Complete,
  label: string,
  q: {
    subject: string | null;
    chapter: string | null;
    topic: string | null;
    question: string;
    options: string[];
    correctIndex: number;
    previous: string | null;
  },
  context = "",
): Promise<string | null> {
  let extra = context ? `\n\n${context}` : "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await complete({
      system: explainSystemPrompt(label),
      user: explainUserPrompt(q) + extra,
      temperature: 0.2,
      max_tokens: 1800,
    });
    if (!r.ok || !r.text) return null;
    let parts: ReturnType<typeof readExplanationParts> = null;
    try { parts = readExplanationParts(readModelJson(r.text)); } catch { parts = null; }
    if (parts) {
      const composed = composeExplanation(q.options, q.correctIndex, parts);
      if (composed) return composed;
      extra += `\n\nYour last answer fell short: ${explanationShortfall(q.options, q.correctIndex, parts)}. Write it in full.`;
    } else {
      extra += "\n\nYour last answer was not the JSON asked for.";
    }
  }
  return null;
}
