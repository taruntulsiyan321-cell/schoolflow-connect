/**
 * The session result screen's reading of a session: its rows mapped into
 * src/academic/metrics/sessionAnalysis.ts, and what that found, in the words
 * the screen uses. One home for those words — the Summary, Time and Questions
 * tabs all name an answer the same way.
 */
import {
  type BreakdownRow,
  type Comparison,
  compareWithLast,
  difficultyBreakdown,
  type ExamMarks,
  examMarks,
  type GuessReading,
  guessReading,
  formBreakdown,
  type Halves,
  halves,
  type MetBefore,
  metBefore,
  oneFix,
  type PaceReading,
  paceReading,
  type SessionAttempt,
  type SideReading,
  topicBreakdown,
  toSessionAttempt,
} from "@/academic/metrics/sessionAnalysis";
import type { PaperShape } from "@/academic/metrics/examPaper";
import type { SessionAnalysisContext } from "@/lib/sessionAnalysisContext";
import type { AttemptRow } from "./types";

/** What the analysis can say about one answer, as a chip and as a filter. */
export const ANSWER_NOTES = {
  careless: { label: "Rushed", help: "Wrong, in under half your usual time on a question" },
  stuck: { label: "Stuck", help: "Wrong, after half as long again as your usual time" },
  slowRight: { label: "Slow", help: "Right, but slower than both your usual time and the paper allows" },
  fixed: { label: "Fixed since last time", help: "Wrong or skipped when you last met it — right now" },
  stillWrong: { label: "Wrong again", help: "Wrong when you last met it — and wrong again" },
  slipped: { label: "Slipped", help: "Right when you last met it — wrong now" },
  lucky: { label: "Lucky guess", help: "Marked as a guess, and right — the mark was luck, not knowing" },
  missed: { label: "Guessed wrong", help: "Marked as a guess, and wrong" },
  unmarkedWrong: { label: "Wrong, not a guess", help: "Answered without marking a guess, and wrong — the idea itself needs checking" },
} as const;
export type NoteKey = keyof typeof ANSWER_NOTES;

/** "2/5 · 40%" — the counts always, the percentage only when enough answers stand behind it. */
export const sideText = (s: SideReading) => `${s.correct}/${s.answered}${s.accuracy != null ? ` · ${s.accuracy}%` : ""}`;

export type QuestionFilter = { key: "all" | "wrong" | "skipped" | NoteKey; label: string; orders: number[] };

export type SessionAnalysis = {
  attempts: SessionAttempt[];
  topics: BreakdownRow[];
  difficulty: BreakdownRow[];
  forms: BreakdownRow[] | null;
  pace: PaceReading | null;
  halves: Halves | null;
  paper: PaperShape | null;
  marks: ExamMarks | null;
  comparison: Comparison | null;
  metBefore: MetBefore | null;
  /** The "I'm guessing" tap's reading; null for a session that did not offer it. */
  guesses: GuessReading | null;
  fix: BreakdownRow | null;
  /** The chips each question carries, by its order in the session. */
  notes: Map<number, string[]>;
  /** The Questions tab's filters — only the ones with something in them, besides All. */
  filters: QuestionFilter[];
};

export function analyseSession(rows: ReadonlyArray<AttemptRow>, context: SessionAnalysisContext | null): SessionAnalysis {
  const attempts = rows.map((r, i) => {
    const gq = r.generated_question ?? {};
    return toSessionAttempt(i, {
      question: gq.question ?? "",
      options: Array.isArray(gq.options) ? gq.options : [],
      topic: gq.topic ?? null,
      chapter: gq.chapter ?? r.chapter ?? null,
      difficulty: r.difficulty ?? null,
      timeMs: r.time_taken_ms ?? null,
      skipped: r.skipped ?? false,
      timedOut: r.timed_out ?? false,
      isCorrect: r.is_correct,
      excluded: r.excluded_from_accuracy ?? false,
      bankQuestionId: r.bank_question_id ?? gq.bank_question_id ?? null,
      confidence: r.confidence ?? null,
    });
  });
  const paper = context?.paper ?? null;
  const pace = paper ? paceReading(attempts, paper) : null;
  const before = context ? metBefore(attempts, context.earlier) : null;
  const guesses = guessReading(attempts, paper);

  const groups: Partial<Record<NoteKey, number[]>> = {
    careless: pace?.careless, stuck: pace?.stuck, slowRight: pace?.slowRight,
    fixed: before?.fixed, stillWrong: before?.stillWrong, slipped: before?.slipped,
    lucky: guesses?.lucky, missed: guesses?.missed, unmarkedWrong: guesses?.unmarkedWrong,
  };
  const notes = new Map<number, string[]>();
  for (const [key, orders] of Object.entries(groups) as Array<[NoteKey, number[] | undefined]>) {
    for (const o of orders ?? []) notes.set(o, [...(notes.get(o) ?? []), ANSWER_NOTES[key].label]);
  }

  const wrong = attempts.filter((a) => !a.skipped && !a.timedOut && !a.excluded && a.isCorrect === false).map((a) => a.order);
  const skipped = attempts.filter((a) => a.skipped || a.timedOut).map((a) => a.order);
  const filters: QuestionFilter[] = ([
    { key: "all", label: "All", orders: attempts.map((a) => a.order) },
    { key: "wrong", label: "Wrong", orders: wrong },
    { key: "skipped", label: "Skipped", orders: skipped },
    ...(Object.keys(ANSWER_NOTES) as NoteKey[]).map((k): QuestionFilter => ({ key: k, label: ANSWER_NOTES[k].label, orders: groups[k] ?? [] })),
  ] as QuestionFilter[]).filter((f) => f.key === "all" || f.orders.length > 0);

  return {
    attempts,
    topics: topicBreakdown(attempts),
    difficulty: difficultyBreakdown(attempts),
    forms: formBreakdown(attempts),
    pace,
    halves: halves(attempts),
    paper,
    marks: paper ? examMarks(attempts, paper) : null,
    comparison: compareWithLast(attempts, context?.previous ?? null),
    metBefore: before,
    guesses,
    fix: oneFix(attempts),
    notes,
    filters,
  };
}
