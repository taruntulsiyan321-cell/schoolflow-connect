/**
 * What one practice session says, read every way a student can use (owner,
 * 2026-10-03: "analysis is our differentiator"). Pure: the result screen fetches
 * the session's attempts and rpc_session_analysis_context (20261143000000) and
 * passes them in; every figure here is driven from fixtures in
 * sessionAnalysis.test.ts.
 *
 * §10.8 — weaknesses only. Nothing here labels or selects what a student is
 * good at: a breakdown is ordered weakest first and carries numbers, the time
 * reading names three ways an answer went wrong or slow and has no bucket for
 * "fine", and a comparison reports movement, never praise.
 *
 * Accuracy is over ANSWERED questions — not skipped, not timed out, not left
 * out by a won dispute or a corrected question — the rule the session's own
 * totals use. A percentage is shown only when enough answers stand behind it
 * (mayBeJudged); below that a row shows its counts and no verdict.
 */
import { formOf, type QuestionForm } from "../../../supabase/functions/_shared/questionForms.ts";
import { TREND_DELTA_POINTS } from "../recovery/constants";
import { CARELESS_SHARE, mayBeJudged, SLOW_SHARE } from "./thresholds";

export type SessionAttempt = {
  /** Position in the session, from 0. */
  order: number;
  topic: string | null;
  chapter: string | null;
  difficulty: string | null;
  form: QuestionForm;
  timeMs: number | null;
  skipped: boolean;
  timedOut: boolean;
  isCorrect: boolean | null;
  /** Left out of accuracy: a won dispute, or a question corrected after a report. */
  excluded: boolean;
  bankQuestionId: string | null;
};

/** The CUET paper, as _mock_paper() states it. */
export type PaperShape = { questions: number; minutes: number; marks_correct: number; marks_wrong: number };

export const answered = (a: SessionAttempt) => !a.skipped && !a.timedOut && !a.excluded;
const seconds = (a: SessionAttempt) => (a.timeMs != null && a.timeMs > 0 ? a.timeMs / 1000 : null);
const pctOf = (n: number, d: number) => Math.round((n / d) * 100);

// ── 1. Breakdowns ───────────────────────────────────────────────────────────

export type BreakdownRow = {
  key: string;
  asked: number;
  answered: number;
  correct: number;
  wrong: number;
  skipped: number;
  /** Null until enough answers stand behind it. */
  accuracy: number | null;
  /** Seconds per answer, over timed answers. */
  avgSec: number | null;
};

function rowOf(key: string, list: SessionAttempt[]): BreakdownRow {
  const ans = list.filter(answered);
  const correct = ans.filter((a) => a.isCorrect === true).length;
  const timed = ans.map(seconds).filter((s): s is number => s != null);
  return {
    key,
    asked: list.length,
    answered: ans.length,
    correct,
    wrong: ans.length - correct,
    skipped: list.filter((a) => a.skipped || a.timedOut).length,
    accuracy: mayBeJudged(ans.length) ? pctOf(correct, ans.length) : null,
    avgSec: timed.length ? Math.round(timed.reduce((s, x) => s + x, 0) / timed.length) : null,
  };
}

function groupBy(attempts: ReadonlyArray<SessionAttempt>, keyOf: (a: SessionAttempt) => string): BreakdownRow[] {
  const groups = new Map<string, SessionAttempt[]>();
  for (const a of attempts) {
    const k = keyOf(a);
    groups.set(k, [...(groups.get(k) ?? []), a]);
  }
  return [...groups].map(([k, list]) => rowOf(k, list));
}

/** Weakest first: most wrong, then lowest share right, then most asked. */
const weakestFirst = (x: BreakdownRow, y: BreakdownRow) =>
  y.wrong - x.wrong
  || (x.answered ? x.correct / x.answered : 1) - (y.answered ? y.correct / y.answered : 1)
  || y.asked - x.asked
  || x.key.localeCompare(y.key);

/**
 * A chapter holds a topic once whatever its case (topics_chapter_lower_name_key,
 * 20261126000000), but an attempt keeps the spelling it was written with, and
 * older ones were filed under the chapter's name ("Ratio Analysis" beside
 * "Ratio analysis", KNOWN_ISSUES 106). They are read as the database reads them:
 * one topic, named by its most used spelling. The earliest list holding a topic
 * decides its spelling, so last time's rows take this session's name.
 */
function topicNames(...lists: ReadonlyArray<ReadonlyArray<SessionAttempt>>): (a: SessionAttempt) => string {
  const written = (a: SessionAttempt) => a.topic?.trim() || a.chapter?.trim() || "Other";
  const identity = (name: string) => name.toLowerCase();
  const chosen = new Map<string, string>();
  for (const list of lists) {
    const spellings = new Map<string, Map<string, number>>();
    for (const a of list) {
      const name = written(a);
      const id = identity(name);
      if (chosen.has(id)) continue;
      const counts = spellings.get(id) ?? new Map<string, number>();
      counts.set(name, (counts.get(name) ?? 0) + 1);
      spellings.set(id, counts);
    }
    // Most used; on a tie, the one met first.
    for (const [id, counts] of spellings) chosen.set(id, [...counts].reduce((best, x) => (x[1] > best[1] ? x : best))[0]);
  }
  return (a) => chosen.get(identity(written(a))) ?? written(a);
}

export function topicBreakdown(attempts: ReadonlyArray<SessionAttempt>): BreakdownRow[] {
  return groupBy(attempts, topicNames(attempts)).sort(weakestFirst);
}

const DIFFICULTY_ORDER = ["easy", "medium", "hard"];
const difficultyRank = (k: string) => {
  const i = DIFFICULTY_ORDER.indexOf(k);
  return i < 0 ? DIFFICULTY_ORDER.length : i;
};

/** Easy, medium, hard — in that order, the ones the session had; anything unrated last. */
export function difficultyBreakdown(attempts: ReadonlyArray<SessionAttempt>): BreakdownRow[] {
  return groupBy(attempts, (a) => (a.difficulty ?? "").toLowerCase() || "unrated")
    .sort((x, y) => difficultyRank(x.key) - difficultyRank(y.key));
}

/** By question form — only worth showing when the session held more than direct questions. */
export function formBreakdown(attempts: ReadonlyArray<SessionAttempt>): BreakdownRow[] | null {
  const rows = groupBy(attempts, (a) => a.form).sort(weakestFirst);
  return rows.some((r) => r.key !== "mcq") ? rows : null;
}

// ── 2. Time: why an answer went wrong, read from how long it took ───────────

export type PaceReading = {
  /** The student's usual time per answer in this session (median), seconds. */
  medianSec: number;
  /** What the real paper allows per question, seconds. */
  budgetSec: number;
  /** Answers that took longer than the paper allows. */
  overBudget: number;
  timed: number;
  /** Wrong, and fast: the answer was rushed. Orders, in session order. */
  careless: number[];
  /** Wrong, and slow: the idea was not there. */
  stuck: number[];
  /** Right, but slower than both their usual and the paper's time. */
  slowRight: number[];
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Null when too few answers were timed to know what "usual" is. */
export function paceReading(attempts: ReadonlyArray<SessionAttempt>, paper: PaperShape): PaceReading | null {
  const timed = attempts.filter(answered).filter((a) => seconds(a) != null);
  if (!mayBeJudged(timed.length)) return null;
  const med = median(timed.map((a) => seconds(a)!));
  const budget = (paper.minutes * 60) / paper.questions;
  const pick = (test: (a: SessionAttempt, s: number) => boolean) =>
    timed.filter((a) => test(a, seconds(a)!)).map((a) => a.order).sort((x, y) => x - y);
  return {
    medianSec: Math.round(med),
    budgetSec: Math.round(budget),
    overBudget: timed.filter((a) => seconds(a)! > budget).length,
    timed: timed.length,
    careless: pick((a, s) => a.isCorrect === false && s < CARELESS_SHARE * med),
    stuck: pick((a, s) => a.isCorrect === false && s > SLOW_SHARE * med),
    slowRight: pick((a, s) => a.isCorrect === true && s > SLOW_SHARE * med && s > budget),
  };
}

// ── 3. The two halves: did accuracy or pace give way? ───────────────────────

export type HalfReading = { answered: number; correct: number; accuracy: number; avgSec: number | null };
export type Halves = {
  first: HalfReading;
  second: HalfReading;
  /** Points of accuracy lost from the first half to the second (negative: gained). */
  accuracyDrop: number;
  /** True when the drop is a movement, not noise (TREND_DELTA_POINTS). */
  gaveWay: boolean;
};

function halfOf(list: SessionAttempt[]): HalfReading | null {
  const ans = list.filter(answered);
  if (!mayBeJudged(ans.length)) return null;
  const correct = ans.filter((a) => a.isCorrect === true).length;
  const timed = ans.map(seconds).filter((s): s is number => s != null);
  return {
    answered: ans.length,
    correct,
    accuracy: pctOf(correct, ans.length),
    avgSec: timed.length ? Math.round(timed.reduce((s, x) => s + x, 0) / timed.length) : null,
  };
}

/** Null unless both halves have enough answers to compare. */
export function halves(attempts: ReadonlyArray<SessionAttempt>): Halves | null {
  const inOrder = [...attempts].sort((x, y) => x.order - y.order);
  const mid = Math.ceil(inOrder.length / 2);
  const first = halfOf(inOrder.slice(0, mid));
  const second = halfOf(inOrder.slice(mid));
  if (!first || !second) return null;
  const accuracyDrop = first.accuracy - second.accuracy;
  return { first, second, accuracyDrop, gaveWay: accuracyDrop >= TREND_DELTA_POINTS };
}

// ── 4. On the real paper ────────────────────────────────────────────────────

export type ExamMarks = { score: number; max: number; correct: number; wrong: number; left: number };

/** What the session would have scored marked as CUET marks: right, wrong and left alone. */
export function examMarks(attempts: ReadonlyArray<SessionAttempt>, paper: PaperShape): ExamMarks {
  const ans = attempts.filter(answered);
  const correct = ans.filter((a) => a.isCorrect === true).length;
  const wrong = ans.length - correct;
  return {
    score: correct * paper.marks_correct + wrong * paper.marks_wrong,
    max: attempts.length * paper.marks_correct,
    correct,
    wrong,
    left: attempts.length - ans.length,
  };
}

// ── 5. Against the last session on this chapter ─────────────────────────────

export type PreviousSession = {
  finishedAt: string;
  attempts: Array<{ topic: string | null; isCorrect: boolean | null; skipped: boolean; timedOut: boolean; timeMs: number | null; excluded: boolean }>;
};

export type SideReading = { answered: number; correct: number; accuracy: number | null; avgSec: number | null };
export type TopicMovement = { topic: string; then: SideReading; now: SideReading };
export type Comparison = {
  finishedAt: string;
  then: SideReading;
  now: SideReading;
  /** Points: now minus then. Null unless both sides have enough answers. */
  accuracyChange: number | null;
  /** Seconds per answer: now minus then. */
  paceChange: number | null;
  /** Topics both sessions asked, weakest now first. */
  topics: TopicMovement[];
};

const side = (list: SessionAttempt[]): SideReading => {
  const r = rowOf("", list);
  return { answered: r.answered, correct: r.correct, accuracy: r.accuracy, avgSec: r.avgSec };
};

const asAttempts = (prev: PreviousSession): SessionAttempt[] =>
  prev.attempts.map((a, i) => ({
    order: i, topic: a.topic, chapter: null, difficulty: null, form: "mcq", timeMs: a.timeMs,
    skipped: a.skipped, timedOut: a.timedOut, isCorrect: a.isCorrect, excluded: a.excluded, bankQuestionId: null,
  }));

export function compareWithLast(attempts: ReadonlyArray<SessionAttempt>, previous: PreviousSession | null): Comparison | null {
  if (!previous || previous.attempts.length === 0) return null;
  const before = asAttempts(previous);
  const then = side(before), now = side([...attempts]);
  const topicOf = topicNames(attempts, before);
  const nowTopics = groupBy(attempts, topicOf);
  const thenTopics = new Map(groupBy(before, topicOf).map((r) => [r.key, r]));
  const topics = nowTopics
    .filter((r) => thenTopics.has(r.key))
    .sort(weakestFirst)
    .map((r) => {
      const t = thenTopics.get(r.key)!;
      return {
        topic: r.key,
        then: { answered: t.answered, correct: t.correct, accuracy: t.accuracy, avgSec: t.avgSec },
        now: { answered: r.answered, correct: r.correct, accuracy: r.accuracy, avgSec: r.avgSec },
      };
    });
  return {
    finishedAt: previous.finishedAt,
    then,
    now,
    accuracyChange: then.accuracy != null && now.accuracy != null ? now.accuracy - then.accuracy : null,
    paceChange: then.avgSec != null && now.avgSec != null ? now.avgSec - then.avgSec : null,
    topics,
  };
}

// ── 6. Questions met before ─────────────────────────────────────────────────

export type EarlierAnswer = { bankQuestionId: string; isCorrect: boolean | null; skipped: boolean };
export type MetBefore = {
  /** Wrong (or skipped) last time, right now. */
  fixed: number[];
  /** Wrong last time, wrong again. */
  stillWrong: number[];
  /** Right last time, wrong now: it slipped. */
  slipped: number[];
};

export function metBefore(attempts: ReadonlyArray<SessionAttempt>, earlier: ReadonlyArray<EarlierAnswer>): MetBefore | null {
  const last = new Map(earlier.map((e) => [e.bankQuestionId, e]));
  const out: MetBefore = { fixed: [], stillWrong: [], slipped: [] };
  let seen = 0;
  for (const a of [...attempts].sort((x, y) => x.order - y.order)) {
    const e = a.bankQuestionId ? last.get(a.bankQuestionId) : undefined;
    if (!e || !answered(a)) continue;
    seen++;
    const wasRight = e.isCorrect === true && !e.skipped;
    if (!wasRight && a.isCorrect === true) out.fixed.push(a.order);
    else if (!wasRight && a.isCorrect === false && !e.skipped) out.stillWrong.push(a.order);
    else if (wasRight && a.isCorrect === false) out.slipped.push(a.order);
  }
  return seen ? out : null;
}

// ── 7. The one thing to do next ─────────────────────────────────────────────

/** The topic that cost the most: the most wrong answers, weakest first. Null when nothing went wrong. */
export function oneFix(attempts: ReadonlyArray<SessionAttempt>): BreakdownRow | null {
  const worst = topicBreakdown(attempts)[0];
  return worst && worst.wrong > 0 ? worst : null;
}

/** An attempt as the result screen holds it, read into the shape above. */
export function toSessionAttempt(
  order: number,
  a: {
    question: string;
    options: ReadonlyArray<string>;
    topic?: string | null;
    chapter?: string | null;
    difficulty?: string | null;
    timeMs?: number | null;
    skipped?: boolean | null;
    timedOut?: boolean | null;
    isCorrect: boolean | null;
    excluded?: boolean | null;
    bankQuestionId?: string | null;
  },
): SessionAttempt {
  return {
    order,
    topic: a.topic ?? null,
    chapter: a.chapter ?? null,
    difficulty: a.difficulty ?? null,
    form: formOf(a.question, a.options),
    timeMs: a.timeMs ?? null,
    skipped: Boolean(a.skipped),
    timedOut: Boolean(a.timedOut),
    isCorrect: a.isCorrect,
    excluded: Boolean(a.excluded),
    bankQuestionId: a.bankQuestionId ?? null,
  };
}
