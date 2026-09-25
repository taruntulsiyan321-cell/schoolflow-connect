/**
 * Persist helpers for custom-practice-upload.
 * Kept out of index.ts so the serve handler stays under 500 lines.
 */
import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { ExtractedNote, ExtractedQuestion } from "./types.ts";

export type UserClient = ReturnType<typeof createClient>;

/** Always filed under a syllabus chapter (_shared/syllabusTagger.ts). */
export type TaggedQuestion = ExtractedQuestion & {
  chapter_id: string;
  topic_id: string | null;
  matched_bank_question_id: string | null;
  derived_from_note_id: string | null;
};

export type TaggedNote = ExtractedNote & {
  chapter_id: string;
  topic_id: string | null;
};

export type NoteTagLookup = Map<
  string,
  { chapter_id: string; topic_id: string | null; note_id: string }
>;

export async function persistQuestions(
  userClient: UserClient,
  uploadId: string,
  ownerId: string,
  schoolId: string,
  questions: TaggedQuestion[],
): Promise<{ error: string | null; written: number }> {
  if (questions.length === 0) return { error: null, written: 0 };
  await userClient
    .from("student_upload_questions")
    .delete()
    .eq("upload_id", uploadId)
    .eq("owner_id", ownerId);

  const rows = questions.map((q, i) => ({
    upload_id: uploadId,
    owner_id: ownerId,
    school_id: schoolId,
    sequence: i + 1,
    question_text: q.question_text,
    options: q.options,
    correct_index: q.correct_index,
    correct_answer: q.correct_answer,
    answer_source: q.answer_source,
    explanation: q.explanation,
    difficulty: q.difficulty,
    chapter_id: q.chapter_id,
    topic_id: q.topic_id,
    matched_bank_question_id: q.matched_bank_question_id,
    derived_from_note_id: q.derived_from_note_id,
  }));

  const { error } = await userClient.from("student_upload_questions").insert(rows);
  if (error) return { error: error.message, written: 0 };
  return { error: null, written: rows.length };
}

export async function persistNotes(
  userClient: UserClient,
  uploadId: string,
  ownerId: string,
  schoolId: string,
  notes: TaggedNote[],
): Promise<{
  error: string | null;
  written: number;
  rows: Array<{ id: string; title: string; chapter_id: string; topic_id: string | null }>;
}> {
  if (notes.length === 0) return { error: null, written: 0, rows: [] };
  await userClient
    .from("student_upload_notes")
    .delete()
    .eq("upload_id", uploadId)
    .eq("owner_id", ownerId);

  const payload = notes.map((n, i) => ({
    upload_id: uploadId,
    owner_id: ownerId,
    school_id: schoolId,
    sequence: i + 1,
    title: n.title,
    body: n.body,
    chapter_id: n.chapter_id,
    topic_id: n.topic_id,
  }));

  const { data, error } = await userClient
    .from("student_upload_notes")
    .insert(payload)
    .select("id, title, chapter_id, topic_id");
  if (error) return { error: error.message, written: 0, rows: [] };
  const rows = (data ?? []).map((r) => ({
    id: r.id as string,
    title: r.title as string,
    chapter_id: r.chapter_id as string,
    topic_id: (r.topic_id as string | null) ?? null,
  }));
  return { error: null, written: rows.length, rows };
}

export function noteTagsByTitleFromRows(
  rows: Array<{ id: string; title: string; chapter_id: string; topic_id: string | null }>,
): NoteTagLookup {
  const map: NoteTagLookup = new Map();
  for (const row of rows) {
    map.set(row.title.trim().toLowerCase(), {
      chapter_id: row.chapter_id,
      topic_id: row.topic_id,
      note_id: row.id,
    });
  }
  return map;
}
