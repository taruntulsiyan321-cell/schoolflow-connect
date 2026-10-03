/**
 * A student's report on a question — §10.21, and the owner's ruling
 * 2026-10-03: the AI settles it, and a fix goes live with no human step.
 *
 * One report per student per bank question (20261139000000). It is filed
 * through rpc_report_question, which checks the student can be served the
 * question, keeps what they saw, and counts the report against the plan
 * (question.report). The question-reports function checks it within minutes:
 * the answer stands, the key is corrected, the question is rewritten or
 * withdrawn, or the report is flagged for a closer look — and the student is
 * notified. Uploaded and captured questions are the student's own and are
 * disputed, not reported.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { PlanLimitError, planLimitFrom } from "@/lib/premium";
import { countChars } from "@/lib/questionMarks";

/** question_reports.note's CHECK; questionReports.test.ts reads the migration. */
export const REPORT_NOTE_MAX_CHARS = 500;

export type ReportReason = "wrong_answer" | "question_error" | "explanation_error" | "other";

export type ReportReasonOption = {
  key: ReportReason;
  label: string;
  /** Only once the answer and its explanation have been shown. */
  afterAnswer: boolean;
  /** "Something else" says what. */
  needsNote: boolean;
};

export const REPORT_REASONS: ReadonlyArray<ReportReasonOption> = [
  { key: "wrong_answer", label: "The marked answer is wrong", afterAnswer: true, needsNote: false },
  { key: "question_error", label: "The question or its options have a mistake", afterAnswer: false, needsNote: false },
  { key: "explanation_error", label: "The explanation is wrong or unclear", afterAnswer: true, needsNote: false },
  { key: "other", label: "Something else", afterAnswer: false, needsNote: true },
];

/** The reasons a student can give at this point: before answering, there is no answer to dispute. */
export function reasonsFor(answered: boolean): ReadonlyArray<ReportReasonOption> {
  return answered ? REPORT_REASONS : REPORT_REASONS.filter((r) => !r.afterAnswer);
}

export type ReportStatus =
  | "open" | "checking"
  | "answer_stands" | "no_problem" | "explanation_rewritten"
  | "fixed" | "withdrawn" | "unresolved";

/** How a report is named on a card and in the list. Tone picks the chip's colour. */
export const REPORT_STATUS: Record<ReportStatus, { label: string; tone: "waiting" | "settled" | "fixed" | "flagged" }> = {
  open: { label: "Reported — waiting to be checked", tone: "waiting" },
  checking: { label: "Being checked", tone: "waiting" },
  answer_stands: { label: "Checked — the answer is right", tone: "settled" },
  no_problem: { label: "Checked — nothing wrong found", tone: "settled" },
  explanation_rewritten: { label: "Explanation rewritten", tone: "fixed" },
  fixed: { label: "Fixed", tone: "fixed" },
  withdrawn: { label: "Question withdrawn", tone: "fixed" },
  unresolved: { label: "Flagged for a closer look", tone: "flagged" },
};

export const isSettled = (s: ReportStatus) => s !== "open" && s !== "checking";

export type QuestionReport = {
  id: string;
  questionId: string;
  reason: ReportReason;
  claimedIndex: number | null;
  note: string | null;
  questionText: string;
  options: string[];
  subject: string | null;
  chapter: string | null;
  status: ReportStatus;
  outcome: string | null;
  outcomeExplanation: string | null;
  replacementQuestionId: string | null;
  createdAt: string;
  resolvedAt: string | null;
};

type ReportRow = Database["public"]["Tables"]["question_reports"]["Row"];

const REPORT_COLUMNS =
  "id, question_id, reason, claimed_index, note, question_text, options, subject, chapter, status, outcome, outcome_explanation, replacement_question_id, created_at, resolved_at";

export function toReport(row: Pick<ReportRow, "id" | "question_id" | "reason" | "claimed_index" | "note" | "question_text"
  | "options" | "subject" | "chapter" | "status" | "outcome" | "outcome_explanation" | "replacement_question_id"
  | "created_at" | "resolved_at">): QuestionReport {
  return {
    id: row.id,
    questionId: row.question_id,
    reason: row.reason as ReportReason,
    claimedIndex: row.claimed_index,
    note: row.note,
    questionText: row.question_text,
    options: Array.isArray(row.options) ? row.options.map((o) => String(o ?? "")) : [],
    subject: row.subject,
    chapter: row.chapter,
    status: row.status as ReportStatus,
    outcome: row.outcome,
    outcomeExplanation: row.outcome_explanation,
    replacementQuestionId: row.replacement_question_id,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

/** The note as it may be typed: cut at the limit, by code point (Postgres counts code points). */
export function clampReportNote(text: string): string {
  const chars = Array.from(text);
  return chars.length > REPORT_NOTE_MAX_CHARS ? chars.slice(0, REPORT_NOTE_MAX_CHARS).join("") : text;
}

export function reportNoteLength(text: string): number {
  return countChars(text);
}

export type ReportDraft = {
  questionId: string;
  reason: ReportReason;
  /** The option the student says is right; only with "the marked answer is wrong". */
  claimedIndex: number | null;
  note: string;
  sessionId: string | null;
};

/**
 * File the report — or change it, while it waits. A plan refusal throws
 * PlanLimitError; anything else the database refuses is a sentence for the
 * student, thrown as it is.
 */
export async function reportQuestion(draft: ReportDraft): Promise<{ report: QuestionReport; created: boolean }> {
  const note = draft.note.trim();
  const { data, error } = await supabase.rpc("rpc_report_question", {
    _question_id: draft.questionId,
    _reason: draft.reason,
    // DEFAULT NULL parameters: left out, never sent as undefined-cast nulls.
    ...(draft.reason === "wrong_answer" && draft.claimedIndex != null ? { _claimed_index: draft.claimedIndex } : {}),
    ...(note ? { _note: note } : {}),
    ...(draft.sessionId ? { _session_id: draft.sessionId } : {}),
  });
  if (error) {
    const limit = planLimitFrom(error);
    if (limit) throw new PlanLimitError(limit);
    throw new Error(error.message);
  }
  const reply = data as unknown as { created: boolean; report: ReportRow };
  return { created: reply.created, report: toReport(reply.report) };
}

/**
 * The student's reports on these questions, by question id. Filtered by the
 * student as well as fenced by RLS: a super admin's fence lets them read every
 * report, and their own screens must still show only their own.
 */
export async function loadMyReports(userId: string, questionIds: ReadonlyArray<string>): Promise<Map<string, QuestionReport>> {
  const ids = [...new Set(questionIds)].filter(Boolean);
  const out = new Map<string, QuestionReport>();
  if (ids.length === 0) return out;
  const { data, error } = await supabase.from("question_reports").select(REPORT_COLUMNS).eq("user_id", userId).in("question_id", ids);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    const r = toReport(row as ReportRow);
    out.set(r.questionId, r);
  }
  return out;
}

/** Every report the student has filed, the newest first. */
export async function listMyReports(userId: string): Promise<QuestionReport[]> {
  const { data, error } = await supabase
    .from("question_reports")
    .select(REPORT_COLUMNS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => toReport(row as ReportRow));
}
