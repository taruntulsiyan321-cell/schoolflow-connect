

export type MistakeRecord = {
  id: string;
  question_text: string;
  options: string[];
  student_answer: { selected_index?: number; text?: string } | null;
  correct_answer: { correct_index?: number; text?: string } | null;
  explanation: string | null;
  subject: string;
  chapter: string | null;
  concept: string | null;
  topic: string | null;
  times_wrong: number;
  last_wrong_at?: string | null;
};













