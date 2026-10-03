/**
 * Full CUET mock tests, as the app sees them.
 *
 * The server owns every rule (20261115000000): how many questions a paper
 * holds, how long it runs, what a right and a wrong answer are worth, which
 * subjects can fill a paper, and whether the plan allows another one. This
 * module reads those answers and names its refusals. It holds NO copy of the
 * paper's shape — `catalog.paper` is where that comes from, and the countdown
 * runs to the deadline the server set, not to a duration counted here.
 *
 * Nothing here can learn a correct answer before a paper is submitted: the
 * paper RPCs do not return one.
 */
import { supabase } from "@/integrations/supabase/client";
import { PlanLimitError, planLimitFrom, type PremiumDecision } from "@/lib/premium";
import { toErrorMessage } from "@/lib/presentation";
import type { PaperShape } from "@/academic/metrics/examPaper";

/** The ruled shape of a paper, from public._mock_paper(): the four facts every reader shares, and the spread rule. */
export type MockPaperShape = PaperShape & {
  min_chapters: number;
  max_per_chapter: number;
  max_score: number;
};

/** What one subject can supply, counted under the per-chapter cap. */
export type MockSubjectSupply = {
  subject: string;
  questions: number;
  chapters: number;
  ready: boolean;
};

export type MockQuestion = {
  order: number;
  id: string;
  /** False when the question has left the bank since the paper was built. */
  available: boolean;
  question: string | null;
  options: unknown;
  format: string;
  chapter: string | null;
  /** The student's own saved choice, as an option index. */
  choice: number | null;
  marked: boolean;
};

export type MockPaper = {
  id: string;
  subject: string;
  started_at: string;
  deadline: string;
  submitted_at: string | null;
  total: number;
  marks_correct: number;
  marks_wrong: number;
  max_score: number;
  questions: MockQuestion[];
};

export type MockCatalog =
  | { individual: false; paper: MockPaperShape }
  | {
      individual: true;
      paper: MockPaperShape;
      subjects: MockSubjectSupply[];
      taken: number;
      plan: PremiumDecision;
      open: MockPaper | null;
    };

export type MockReviewQuestion = {
  order: number;
  id: string;
  available: boolean;
  question: string | null;
  options: unknown;
  chapter: string | null;
  topic: string | null;
  explanation: string | null;
  /** Only ever present after the paper is submitted. */
  correct: { index: number; text: string } | null;
  choice: number | null;
  is_correct: boolean | null;
  marks: number;
  time_ms: number | null;
};

export type MockResult = {
  id: string;
  subject: string;
  started_at: string;
  submitted_at: string;
  auto_submitted: boolean;
  seconds_taken: number;
  total: number;
  correct: number;
  wrong: number;
  unanswered: number;
  /** Questions that left the bank between planning and marking. */
  voided: number;
  score: number;
  max_score: number;
  marks_correct: number;
  marks_wrong: number;
  questions: MockReviewQuestion[];
};

export type MockHistoryRow = {
  id: string;
  subject: string;
  started_at: string;
  submitted_at: string;
  auto_submitted: boolean;
  correct: number;
  wrong: number;
  unanswered: number;
  voided: number;
  score: number;
  total: number;
  max_score: number;
  seconds_taken: number | null;
};

/**
 * Every way the server refuses a mock, by the message it refuses with. The
 * sentence shown to the student is the server's own DETAIL wherever it sent
 * one — so the wording has one home, in the SQL — and these only cover the
 * refusals that carry none.
 */
const REFUSALS = {
  mock_time_is_up: "The hour is over.",
  mock_already_submitted: "This paper is already marked.",
  mock_not_submitted: "This paper has not been submitted yet.",
  mock_attempt_already_open: "You already have a paper open.",
  mock_not_enough_questions: "There are not enough questions for a full paper yet.",
  mock_subject_unknown: "That subject has no questions for this account.",
  mock_attempt_not_found: "That paper could not be found.",
  mock_question_not_in_paper: "That question is not on this paper.",
  mock_choice_out_of_range: "That is not one of the options.",
  mock_tests_are_for_exam_accounts: "Mock tests are for exam accounts.",
} as const;

export type MockRefusal = keyof typeof REFUSALS;

/** A refusal the mock RPCs state, so a screen can act on which one it is. */
export class MockError extends Error {
  constructor(
    readonly refusal: MockRefusal,
    message: string,
    readonly detail: string | null = null,
  ) {
    super(message);
    this.name = "MockError";
  }
}

function isRefusal(value: unknown): value is MockRefusal {
  return typeof value === "string" && value in REFUSALS;
}

/**
 * Turn whatever an RPC failed with into the error a screen should handle: a
 * plan refusal, a named mock refusal, or an ordinary failure.
 */
function throwFor(error: unknown, fallback: string): never {
  const limit = planLimitFrom(error);
  if (limit) throw new PlanLimitError(limit);
  const e = (error ?? {}) as { message?: unknown; details?: unknown };
  const message = typeof e.message === "string" ? e.message : "";
  if (isRefusal(message)) {
    const detail = typeof e.details === "string" && e.details.trim() ? e.details.trim() : null;
    throw new MockError(message, detail ?? REFUSALS[message], detail);
  }
  throw new Error(toErrorMessage(error, fallback));
}

async function call<T>(
  name: "rpc_mock_catalog" | "rpc_mock_start" | "rpc_mock_paper" | "rpc_mock_save_answer"
    | "rpc_mock_submit" | "rpc_mock_result" | "rpc_my_mock_history",
  args: Record<string, unknown> | undefined,
  fallback: string,
): Promise<T> {
  const { data, error } = args
    ? await supabase.rpc(name, args as never)
    : await supabase.rpc(name as "rpc_mock_catalog");
  if (error) throwFor(error, fallback);
  return data as unknown as T;
}

export function fetchMockCatalog(): Promise<MockCatalog> {
  return call<MockCatalog>("rpc_mock_catalog", undefined, "Could not load mock tests");
}

/** Start a paper. Throws PlanLimitError when the plan refuses another one. */
export function startMock(subject: string): Promise<MockPaper> {
  return call<MockPaper>("rpc_mock_start", { _subject: subject }, "Could not start the paper");
}

export function fetchMockPaper(attempt: string): Promise<MockPaper> {
  return call<MockPaper>("rpc_mock_paper", { _attempt: attempt }, "Could not open the paper");
}

/**
 * Save one answer. A null `choice` clears it, and clears it by OMITTING
 * `_choice`: the parameter's SQL default is NULL, and a generated
 * `DEFAULT NULL` parameter types as optional-non-null, so sending an explicit
 * null would stop compiling the moment the types are regenerated.
 */
export function saveMockAnswer(input: {
  attempt: string;
  question: string;
  choice: number | null;
  marked?: boolean;
  timeMs?: number | null;
}): Promise<{ saved: boolean; deadline: string }> {
  return call("rpc_mock_save_answer", {
    _attempt: input.attempt,
    _question: input.question,
    ...(input.choice == null ? {} : { _choice: input.choice }),
    ...(input.marked === undefined ? {} : { _marked: input.marked }),
    ...(input.timeMs == null ? {} : { _time_ms: Math.round(input.timeMs) }),
  }, "Could not save your answer");
}

export function submitMock(attempt: string): Promise<MockResult> {
  return call<MockResult>("rpc_mock_submit", { _attempt: attempt }, "Could not submit the paper");
}

export function fetchMockResult(attempt: string): Promise<MockResult> {
  return call<MockResult>("rpc_mock_result", { _attempt: attempt }, "Could not load the result");
}

export async function fetchMockHistory(): Promise<MockHistoryRow[]> {
  const rows = await call<MockHistoryRow[]>("rpc_my_mock_history", undefined, "Could not load your papers");
  return Array.isArray(rows) ? rows : [];
}

// ── Presentation ────────────────────────────────────────────────────────────

/** Milliseconds left on a paper, never negative. */
export function remainingMs(deadline: string, now: number = Date.now()): number {
  const ends = Date.parse(deadline);
  if (Number.isNaN(ends)) return 0;
  return Math.max(0, ends - now);
}

/**
 * A countdown, always MM:SS (or H:MM:SS past an hour) and always two digits,
 * because a clock that changes width jumps on screen every ten seconds.
 * formatSessionDuration is the other duration in the panel and is deliberately
 * not this: "12m" is right for a session that has ended and useless for a
 * clock that is running out.
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** How a question shows in the palette. */
export type PaletteState = "answered" | "marked" | "answered_marked" | "unanswered" | "unavailable";

/** How each palette state is said out loud, for a screen reader. */
export const PALETTE_WORDS: Record<PaletteState, string> = {
  answered: "answered",
  marked: "marked for review",
  answered_marked: "answered and marked for review",
  unanswered: "not answered",
  unavailable: "withdrawn",
};

export function paletteState(q: Pick<MockQuestion, "choice" | "marked" | "available">): PaletteState {
  if (!q.available) return "unavailable";
  const answered = q.choice != null;
  if (answered && q.marked) return "answered_marked";
  if (answered) return "answered";
  return q.marked ? "marked" : "unanswered";
}

/**
 * What a subject's card says when it cannot fill a paper yet — the counts, not
 * a shrug. `questions` is the supply UNDER the per-chapter cap, which is what
 * a paper can actually draw on.
 */
export function notEnoughYet(s: MockSubjectSupply, paper: MockPaperShape): string {
  return `${s.questions} of ${paper.questions} questions ready, from ${s.chapters === 1 ? "1 chapter" : `${s.chapters} chapters`}.`;
}

/** "+5 for a right answer, −1 for a wrong one, 0 if you leave it." */
export function marksSentence(paper: Pick<MockPaperShape, "marks_correct" | "marks_wrong">): string {
  const penalty = Math.abs(paper.marks_wrong);
  return `+${paper.marks_correct} for a right answer, −${penalty} for a wrong one, 0 if you leave it.`;
}
