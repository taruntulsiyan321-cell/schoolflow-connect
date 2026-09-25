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
};

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

function sourceLabel(source: string): string {
  const labels: Record<string, string> = {
    practice: "Practice", tests: "Test", battleground: "Battleground",
    homework: "Homework", pyq: "PYQ", qbank: "Question Bank",
    upload: "Upload",
  screen_capture: "Captured",
  };
  return labels[source] ?? source.charAt(0).toUpperCase() + source.slice(1);
}

function parseDifficulty(raw: string | null | undefined): "easy" | "medium" | "hard" | null {
  const d = (raw ?? "").toLowerCase();
  if (d === "easy" || d === "hard" || d === "medium") return d;
  return null;
}

/** A question nobody could place — a capture or an upload outside the exam's
 *  chapters — has no subject or chapter. It is filed as "Untagged", whatever
 *  its source, so it never shows as a blank row, chip or label. */
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
    aiAnswered: Boolean(row.ai_answered && row.upload_question_id),
  };
}
