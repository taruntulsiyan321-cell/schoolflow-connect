/**
 * CUET mock tests, as the app sees them.
 *
 * The server owns every rule (20261115000000, 20261150000000): how many
 * questions a paper holds, how long it runs, what a right and a wrong answer
 * are worth, how a paper spreads across chapters and forms (the blueprint),
 * which subjects and chapters can fill one, which paper a student is given, and
 * whether the plan allows another. This module reads those answers and names
 * its refusals. It holds NO copy of the paper's shape — `catalog.paper` is where
 * that comes from, and the countdown runs to the deadline the server set, not
 * to a duration counted here.
 *
 * A paper is PREPARED first (built or taken from the library, counting nothing)
 * so the student is told before the clock starts what it holds — how many of
 * its questions they have seen, which chapters came up short — and STARTED
 * second, when the plan counts it.
 *
 * Nothing here can learn a correct answer before a paper is submitted: the
 * paper RPCs do not return one.
 */
import { supabase } from "@/integrations/supabase/client";
import { PlanLimitError, planLimitFrom, type PremiumDecision } from "@/lib/premium";
import { toErrorMessage } from "@/lib/presentation";
import { pluralise } from "@/lib/plural";
import type { PaperShape } from "@/academic/metrics/examPaper";
import { ANSWERED_UNMARKED, MARKED_AS_GUESS } from "@/academic/metrics/answerConfidence";
import type { AttemptRow } from "@/components/student/sessionResult/types";

/** The ruled shape of a paper, from public._mock_paper(). */
export type MockPaperShape = PaperShape & { max_score: number };

/** A choice a subject's paper asks for once: Accountancy's Unit V, Mathematics' Section B. */
export type MockOption = {
  group: string;
  /** What the choice is called: "Unit V", "Section B". */
  label: string;
  /** The option the student chose, or null until they choose. */
  chosen: string | null;
  choices: Array<{ option: string; label: string }>;
};

export type MockChapter = { chapter_id: string; chapter: string; questions: number; ready: boolean };

/** What one subject can offer: the questions a mock may draw on, its choices, and its chapters. */
export type MockSubject = {
  subject: string;
  questions: number;
  /** A whole-subject paper can be built under the choices made. */
  ready: boolean;
  options: MockOption[];
  chapters: MockChapter[];
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
  /** The "I'm guessing" tap: true a guess, false answered without it, null not said. */
  guessed: boolean | null;
};

export type MockPaper = {
  id: string;
  paper_id: string;
  subject: string;
  chapter_id: string | null;
  chapter: string | null;
  started_at: string;
  deadline: string;
  submitted_at: string | null;
  total: number;
  seen_before: number;
  marks_correct: number;
  marks_wrong: number;
  max_score: number;
  questions: MockQuestion[];
};

/** A chapter that could not give its share of a subject paper; the rest made it up. */
export type MockShortChapter = { chapter_id: string; chapter: string; wanted: number; got: number };

/** A paper before it starts, for this student (rpc_mock_prepare). */
export type MockPreview = {
  paper_id: string;
  subject: string;
  chapter_id: string | null;
  chapter: string | null;
  options: Array<{ group: string; option: string; label: string }>;
  total: number;
  minutes: number;
  marks_correct: number;
  marks_wrong: number;
  /** Questions on it the student has met before. */
  seen_before: number;
  /** Of those, the ones that went badly: wrong, left or guessed. */
  troubled: number;
  /** Its questions by form, and the blueprint's for the same paper. */
  forms: Record<string, number>;
  blueprint_forms: Record<string, number>;
  short: MockShortChapter[];
};

export type MockCatalog =
  | { individual: false; paper: MockPaperShape }
  | {
      individual: true;
      paper: MockPaperShape;
      subjects: MockSubject[];
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
  format: string;
  chapter: string | null;
  topic: string | null;
  difficulty: string | null;
  explanation: string | null;
  /** Only ever present after the paper is submitted. */
  correct: { index: number; text: string } | null;
  choice: number | null;
  is_correct: boolean | null;
  guessed: boolean | null;
  marks: number;
  time_ms: number | null;
};

export type MockResult = {
  id: string;
  paper_id: string;
  subject: string;
  chapter_id: string | null;
  chapter: string | null;
  started_at: string;
  submitted_at: string;
  auto_submitted: boolean;
  seconds_taken: number;
  total: number;
  seen_before: number;
  correct: number;
  wrong: number;
  unanswered: number;
  /** Questions that left the bank between building and marking. */
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
  /** The chapter of a chapter paper; null for a whole-subject paper. */
  chapter: string | null;
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
  mock_option_not_chosen: "Make the choice this subject's paper asks for first.",
  mock_option_unknown: "That is not one of this subject's choices.",
  mock_paper_not_found: "That paper could not be found.",
  mock_paper_already_sat: "You have sat this paper. Prepare another.",
  mock_paper_exhausted: "Every paper these questions can make is one you have already sat.",
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

type RpcName =
  | "rpc_mock_catalog" | "rpc_set_exam_option" | "rpc_mock_prepare" | "rpc_mock_start" | "rpc_mock_paper"
  | "rpc_mock_save_answer" | "rpc_mock_submit" | "rpc_mock_result" | "rpc_my_mock_history" | "rpc_mock_analysis_context";

async function call<T>(name: RpcName, args: Record<string, unknown> | undefined, fallback: string): Promise<T> {
  const { data, error } = args
    ? await supabase.rpc(name, args as never)
    : await supabase.rpc(name as "rpc_mock_catalog");
  if (error) throwFor(error, fallback);
  return data as unknown as T;
}

export function fetchMockCatalog(): Promise<MockCatalog> {
  return call<MockCatalog>("rpc_mock_catalog", undefined, "Could not load mock tests");
}

/** Make a subject's once-only choice (Unit V, Section B). */
export function setExamOption(subject: string, group: string, option: string): Promise<{ label: string }> {
  return call("rpc_set_exam_option", { _subject: subject, _group: group, _option: option }, "Could not save your choice");
}

/**
 * The paper this student would sit — a whole subject, or one chapter — before
 * the clock starts. Counts nothing against the plan. A whole-subject paper
 * leaves `_chapter` out: its SQL default is NULL, and a generated
 * `DEFAULT NULL` parameter types as optional-non-null.
 */
export function prepareMock(subject: string, chapterId: string | null = null): Promise<MockPreview> {
  return call<MockPreview>(
    "rpc_mock_prepare",
    { _subject: subject, ...(chapterId ? { _chapter: chapterId } : {}) },
    "Could not prepare the paper",
  );
}

/** Start a prepared paper. Throws PlanLimitError when the plan refuses another one. */
export function startMock(paperId: string): Promise<MockPaper> {
  return call<MockPaper>("rpc_mock_start", { _paper: paperId }, "Could not start the paper");
}

export function fetchMockPaper(attempt: string): Promise<MockPaper> {
  return call<MockPaper>("rpc_mock_paper", { _attempt: attempt }, "Could not open the paper");
}

/**
 * Save one answer. A null `choice` clears it, and clears it by OMITTING
 * `_choice` — the same rule as every DEFAULT NULL parameter here.
 */
export function saveMockAnswer(input: {
  attempt: string;
  question: string;
  choice: number | null;
  marked?: boolean;
  timeMs?: number | null;
  guessed?: boolean | null;
}): Promise<{ saved: boolean; deadline: string }> {
  return call("rpc_mock_save_answer", {
    _attempt: input.attempt,
    _question: input.question,
    ...(input.choice == null ? {} : { _choice: input.choice }),
    ...(input.marked === undefined ? {} : { _marked: input.marked }),
    ...(input.timeMs == null ? {} : { _time_ms: Math.round(input.timeMs) }),
    ...(input.guessed == null ? {} : { _guessed: input.guessed }),
  }, "Could not save your answer");
}

export function submitMock(attempt: string): Promise<MockResult> {
  return call<MockResult>("rpc_mock_submit", { _attempt: attempt }, "Could not submit the paper");
}

export function fetchMockResult(attempt: string): Promise<MockResult> {
  return call<MockResult>("rpc_mock_result", { _attempt: attempt }, "Could not load the result");
}

/** What a marked paper's analysis needs beyond its answers — the same shape a practice session's has. */
export function fetchMockAnalysisContext(attempt: string): Promise<unknown> {
  return call<unknown>("rpc_mock_analysis_context", { _attempt: attempt }, "Could not load the analysis");
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
 * What a subject's or chapter's card says when it cannot fill a paper yet — the
 * counts, not a shrug: "22 of 50 questions ready."
 */
export function notEnoughYet(questions: number, paper: Pick<MockPaperShape, "questions">): string {
  return `${questions} of ${paper.questions} questions ready.`;
}

/** "+5 for a right answer, −1 for a wrong one, 0 if you leave it." */
export function marksSentence(paper: Pick<MockPaperShape, "marks_correct" | "marks_wrong">): string {
  const penalty = Math.abs(paper.marks_wrong);
  return `+${paper.marks_correct} for a right answer, −${penalty} for a wrong one, 0 if you leave it.`;
}

/**
 * B4.3: the paper says before it starts how many of its questions the student
 * has seen, and which come first. Null when it repeats nothing.
 */
export function seenBeforeSentence(p: Pick<MockPreview, "seen_before" | "troubled">): string | null {
  if (p.seen_before <= 0) return null;
  const seen = `${pluralise(p.seen_before, "question")} you've seen before`;
  if (p.troubled >= p.seen_before) return `This paper includes ${seen} — ones you got wrong, left or guessed.`;
  if (p.troubled <= 0) return `This paper includes ${seen} — ones you got right longest ago.`;
  return `This paper includes ${seen} — first the ${p.troubled} you got wrong, left or guessed, then ones you got right longest ago.`;
}

/** The chapters that could not give their share, said once: "Computerised Accounting System gave 9 of its 13." */
export function shortSentence(short: ReadonlyArray<MockShortChapter>): string | null {
  if (short.length === 0) return null;
  const parts = short.map((s) => `${s.chapter} gave ${s.got} of its ${s.wanted}`);
  return `${parts.join("; ")}. The rest come from the other chapters.`;
}

/** Questions in forms besides direct ones, on this paper and in the blueprint. */
function otherForms(forms: Record<string, number>): number {
  return Object.entries(forms).reduce((n, [form, count]) => (form === "mcq" ? n : n + count), 0);
}

/**
 * Said when the paper has fewer statement, match, sequence and passage
 * questions than the real paper sets — the bank is still being filled with
 * them. Null when it has its share.
 */
export function formsSentence(p: Pick<MockPreview, "forms" | "blueprint_forms">): string | null {
  const want = otherForms(p.blueprint_forms);
  const have = otherForms(p.forms);
  if (have >= want) return null;
  return `The real paper sets ${want} statement, match, sequence and passage questions; this one has ${have} — the bank does not hold more of them yet.`;
}

/**
 * A marked paper's questions as the rows the practice result's analysis reads
 * (components/student/sessionResult), so a mock is read with the same four
 * tabs a practice session is (B5). A withdrawn question carries no marks and is
 * left out of accuracy, as the marking left it out.
 */
export function mockResultToAttemptRows(result: MockResult): AttemptRow[] {
  return result.questions.map((q) => {
    const options = Array.isArray(q.options) ? (q.options as unknown[]).map((o) => String(o ?? "")) : [];
    return {
      id: `${result.id}:${q.id}`,
      generated_question: {
        question: q.question ?? "",
        options,
        explanation: q.explanation ?? undefined,
        bank_question_id: q.id,
        subject: result.subject,
        chapter: q.chapter,
        topic: q.topic,
      },
      bank_question_id: q.id,
      subject: result.subject,
      chapter: q.chapter,
      difficulty: q.difficulty,
      correct_answer: q.correct ? { index: q.correct.index, text: q.correct.text } : {},
      selected_answer: q.choice == null ? null : { index: q.choice, text: options[q.choice] },
      is_correct: q.is_correct,
      created_at: result.submitted_at,
      skipped: q.choice == null,
      timed_out: false,
      excluded_from_accuracy: q.choice != null && q.is_correct == null,
      time_taken_ms: q.time_ms,
      confidence: q.guessed == null ? null : q.guessed ? MARKED_AS_GUESS : ANSWERED_UNMARKED,
    };
  });
}
