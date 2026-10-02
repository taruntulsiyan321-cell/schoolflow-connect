/**
 * A student_mistakes row as the Mistake Book shows it: labels humanised, an
 * unplaceable question filed as "Untagged", answers read as indexes.
 */
import { answerToIndex } from "@/academic/services/answerText";
import { academicMatchKey, displayChapter, displayTopic, isPlaceholderAcademicLabel } from "@/lib/academicDisplay";

export interface Mistake {
  id: string; question: string; options: string[]; correct: number | null; chosen: number | null;
  subject: string; chapter: string; topic: string; difficulty: "easy"|"medium"|"hard"|null;
  /** Raw DB chapter/concept for recovery assign (not display-humanized). */
  chapterRaw: string | null;
  conceptRaw: string | null;
  source: string; sourceLabel: string; date: string; frequency: number;
  aiExplanation: string; correctReason: string; studentReason: string;
  bookmarked: boolean; resolved: boolean; qType: string; sortDate: string;
  questionId: string | null;
  /** Spec §6.1 — student_upload_questions.id when source=upload + AI key. */
  uploadQuestionId: string | null;
  /** Spec §11 — student_capture_questions.id when source=screen_capture. */
  captureQuestionId: string | null;
  aiAnswered: boolean;
  /**
   * Can this question still be put in front of the student?
   *
   * False when the thing it was asked from is gone: a bank question that has
   * been deactivated or replaced, an upload question deleted with its file, a
   * capture the student removed. Such a mistake stays in the book — they really
   * did get it wrong — but Retry would open a session that serves nothing, so
   * the card says so instead of offering it (KNOWN_ISSUES 91).
   */
  askable: boolean;
}

export type MistakeRow = {
  id: string;
  question_text: string;
  options: unknown;
  correct_answer: { correct_index?: number; indexes?: number[] } | null;
  student_answer: { selected_index?: number; indexes?: number[] } | null;
  subject: string;
  chapter: string | null;
  concept: string | null;
  topic: string | null;
  source: string;
  assessment_type: string | null;
  last_wrong_at: string;
  times_wrong: number;
  explanation: string | null;
  status: "open" | "cleared";
  question_id?: string | null;
  difficulty?: string | null;
  /** Migration 700 column; text-join may fill legacy rows that still lack it. */
  upload_question_id?: string | null;
  capture_question_id?: string | null;
  /** Spec §5.1 — real chapters.id when tagged; null when untagged. */
  chapter_id?: string | null;
  ai_answered?: boolean;
  /** Filled by the reader from what still exists; absent means askable. */
  askable?: boolean;
};

/**
 * Whether a mistake's question can still be asked — ONE rule, so the book and
 * the session runner cannot disagree about it.
 *
 * A bank question must still be live: present in the student's own view (which
 * withholds unapproved and out-of-scope rows) AND active. A question the student
 * brought must still have its row. Anything with nothing linked at all is left
 * askable: the mistake row itself carries the text and the options, which is
 * what the runner serves for a legacy row.
 */
export function mistakeIsAskable(
  row: Pick<MistakeRow, "question_id" | "upload_question_id" | "capture_question_id">,
  live: { bankActive: Set<string>; uploadAlive: Set<string>; captureAlive: Set<string> },
): boolean {
  if (row.question_id) return live.bankActive.has(row.question_id);
  if (row.upload_question_id) return live.uploadAlive.has(row.upload_question_id);
  if (row.capture_question_id) return live.captureAlive.has(row.capture_question_id);
  return true;
}

function parseOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  return [];
}

function formatMistakeDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

/**
 * Where an individual student's mistakes come from, and how each is shown —
 * the one home for both the label and the tag colour. Measured on live
 * 2026-10-01: practice, upload and screen_capture are the only sources an
 * individual account's rows carry; `test` and `battleground` come from the
 * school's test and battle functions (on the `organisation` branch). An
 * unknown source still renders, title-cased, in the muted tone.
 */
export const MISTAKE_SOURCES: Record<string, { label: string; color: string; bg: string }> = {
  practice: { label: "Practice", color: "hsl(var(--primary))", bg: "rgba(59,130,246,0.12)" },
  upload: { label: "Upload", color: "hsl(var(--info))", bg: "rgba(34,211,238,0.12)" },
  screen_capture: { label: "Captured", color: "hsl(var(--warning))", bg: "rgba(245,158,11,0.12)" },
};

function sourceLabel(source: string): string {
  return MISTAKE_SOURCES[source]?.label ?? source.charAt(0).toUpperCase() + source.slice(1);
}

function parseDifficulty(raw: string | null | undefined): "easy" | "medium" | "hard" | null {
  const d = (raw ?? "").toLowerCase();
  if (d === "easy" || d === "hard" || d === "medium") return d;
  return null;
}

/** A mistake with no subject or chapter is filed as "Untagged", whatever its
 *  source, so it never shows as a blank row, chip or label. Uploads and
 *  captures always carry a chapter (20261096000000); older rows of other
 *  sources may not. */
const UNTAGGED = "Untagged";

export function mapRowToMistake(row: MistakeRow, bookmarked: boolean): Mistake {
  const options = parseOptions(row.options);
  const chapterRaw = row.chapter?.trim() || null;
  const conceptRaw = (row.concept ?? row.topic)?.trim() || null;
  const chapter = displayChapter(row.chapter) || UNTAGGED;
  // A question with no finer concept is recorded at chapter grain (the writer
  // stores the chapter as its concept), so a topic equal to its chapter says
  // nothing new and is not shown twice.
  const topic = academicMatchKey(conceptRaw) === academicMatchKey(chapterRaw) ? "" : displayTopic(conceptRaw);
  return {
    id: row.id,
    question: row.question_text,
    options,
    // answerToIndex, not a local reader. The local one looked for
    // `correct_index`; practice writes `index`, so every correct answer in this
    // book read as "unknown" and the retry marked all 12 of a chapter's
    // questions wrong however the student answered.
    correct: answerToIndex(row.correct_answer, options),
    chosen: answerToIndex(row.student_answer, options),
    subject: isPlaceholderAcademicLabel(row.subject) ? UNTAGGED : row.subject,
    chapter,
    topic,
    chapterRaw,
    conceptRaw,
    difficulty: parseDifficulty(row.difficulty),
    source: row.source,
    sourceLabel: sourceLabel(row.source),
    date: formatMistakeDate(row.last_wrong_at),
    frequency: row.times_wrong ?? 1,
    aiExplanation: row.explanation ?? "",
    correctReason: "",
    studentReason: "",
    bookmarked,
    resolved: row.status === "cleared",
    qType: row.assessment_type ?? "MCQ",
    sortDate: row.last_wrong_at,
    questionId: row.question_id ?? null,
    uploadQuestionId: row.upload_question_id ?? null,
    captureQuestionId: row.capture_question_id ?? null,
    askable: row.askable !== false,
    aiAnswered: Boolean(row.ai_answered && row.upload_question_id),
  };
}
