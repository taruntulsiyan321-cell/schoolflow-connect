/**
 * Persist + catalog helpers for custom-practice-upload.
 * Kept out of index.ts so the serve handler stays under 500 lines.
 */
import type { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  readAllPages,
  resolveCurriculumLabels,
  type CurriculumChapter,
} from "./curriculumResolve.ts";
import type { ExtractedNote, ExtractedQuestion } from "./types.ts";

export type AdminClient = ReturnType<typeof createClient>;
export type UserClient = ReturnType<typeof createClient>;

export type TaggedQuestion = ExtractedQuestion & {
  chapter_id: string | null;
  topic_id: string | null;
  matched_bank_question_id: string | null;
  derived_from_note_id: string | null;
};

export type TaggedNote = ExtractedNote & {
  chapter_id: string | null;
  topic_id: string | null;
};

export type NoteTagLookup = Map<
  string,
  { chapter_id: string | null; topic_id: string | null; note_id: string | null }
>;

/** Load distinct chapters (and their topics) that the exam bank already uses. */
export async function loadExamCatalog(
  admin: AdminClient,
  examId: string | null,
): Promise<CurriculumChapter[]> {
  if (!examId) return [];

  let chapterIds: string[];
  try {
    const rows = await readAllPages<{ chapter_id: string | null }>((from, to) =>
      admin
        .from("question_bank")
        .select("chapter_id")
        .eq("exam_id", examId)
        .eq("is_approved", true)
        .not("chapter_id", "is", null)
        .order("id")
        .range(from, to)
    );
    chapterIds = [...new Set(rows.map((r) => r.chapter_id).filter((id): id is string => typeof id === "string"))];
  } catch (bankErr) {
    console.error("loadExamCatalog bank:", JSON.stringify(bankErr));
    return [];
  }
  if (!chapterIds.length) return [];

  const { data: chapters, error: chErr } = await admin
    .from("chapters")
    .select("id, name, curriculum_subjects(name)")
    .in("id", chapterIds);
  if (chErr || !chapters?.length) {
    if (chErr) console.error("loadExamCatalog chapters:", JSON.stringify(chErr));
    return [];
  }

  let topics: Array<{ id: string; name: string; chapter_id: string }> = [];
  try {
    topics = await readAllPages<{ id: string; name: string; chapter_id: string }>((from, to) =>
      admin.from("topics").select("id, name, chapter_id").in("chapter_id", chapterIds).order("id").range(from, to)
    );
  } catch (tErr) {
    console.error("loadExamCatalog topics:", JSON.stringify(tErr));
  }

  const topicsByChapter = new Map<string, Array<{ topic_id: string; topic_name: string }>>();
  for (const t of topics) {
    const list = topicsByChapter.get(t.chapter_id) ?? [];
    list.push({ topic_id: t.id, topic_name: t.name });
    topicsByChapter.set(t.chapter_id, list);
  }

  const out: CurriculumChapter[] = [];
  for (const ch of chapters) {
    const subj = ch.curriculum_subjects as { name?: string } | null;
    out.push({
      chapter_id: ch.id as string,
      chapter_name: ch.name as string,
      subject_name: typeof subj?.name === "string" ? subj.name : "General",
      topics: topicsByChapter.get(ch.id as string) ?? [],
    });
  }
  return out.sort((a, b) =>
    `${a.subject_name}:${a.chapter_name}`.localeCompare(`${b.subject_name}:${b.chapter_name}`),
  );
}

export function tagNotesFromCatalog(
  notes: ExtractedNote[],
  catalog: CurriculumChapter[],
): TaggedNote[] {
  return notes.map((n) => {
    const resolved = resolveCurriculumLabels(catalog, n.chapter, n.topic, n.subject);
    return { ...n, chapter_id: resolved.chapter_id, topic_id: resolved.topic_id };
  });
}

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
  rows: Array<{ id: string; title: string; chapter_id: string | null; topic_id: string | null }>;
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
    chapter_id: (r.chapter_id as string | null) ?? null,
    topic_id: (r.topic_id as string | null) ?? null,
  }));
  return { error: null, written: rows.length, rows };
}

export function noteTagsByTitleFromRows(
  rows: Array<{ id: string; title: string; chapter_id: string | null; topic_id: string | null }>,
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
