/**
 * Types for custom-practice-upload.
 * Binding: docs/custom-practice-upload-spec.md §4, §6.
 */

export type UploadVerdict = "questions" | "notes" | "mixed" | "unusable";

export type AnswerSource = "file" | "ai";

export type ExtractedQuestion = {
  question_text: string;
  options: string[] | null;
  correct_index: number | null;
  correct_answer: string | null;
  /** §6 — file key vs AI-solved. Client maps answer_source==='ai' → ai_answered. */
  answer_source: AnswerSource;
  explanation: string | null;
  difficulty: string | null;
  /**
   * §7.1 — when set, this question was written from a note whose title matches
   * (case-insensitive). Persist sets derived_from_note_id; §7.2 forces ai.
   */
  derived_from_note_title: string | null;
};

export type ExtractedNote = {
  title: string;
  body: string;
};

export type ClassifierResult = {
  verdict: UploadVerdict;
  confidence: number;
  refusal_reason: string | null;
  questions: ExtractedQuestion[];
  notes: ExtractedNote[];
};

export type MediaPayload =
  | { kind: "text"; text: string; page_count: number | null }
  | { kind: "images"; images: string[]; page_count: number | null }
  | { kind: "pdf_bytes"; dataUri: string; page_count: number | null };
