/**
 * Files a student's own questions (uploads, screen captures) under the
 * chapters of their stream's syllabus — the one tagger both features use.
 *
 * 1. The bank first: a question that closely matches one of the exam's bank
 *    questions takes that question's chapter, topic and difficulty — when the
 *    chapter is in the student's syllabus.
 * 2. The rest are filed by the model, which must answer with a syllabus code,
 *    or OUTSIDE when the subject is not one the stream studies (syllabusTag.ts
 *    validates every answer). Unanswered questions are asked once more.
 * 3. A question still unfiled after that is a failure the caller reports and
 *    can retry — never a question saved without a chapter (ruled 2026-09-25).
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { embedQueryText } from "./embeddingProvider.ts";
import { generateStructuredWithFallback } from "./structuredCompletion.ts";
import {
  readTagReply,
  TAG_REPLY_SHAPE,
  taggingSystemPrompt,
  taggingUserPrompt,
  withCodes,
  type SyllabusChapter,
  type Tag,
  type TagItem,
} from "./syllabusTag.ts";

// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, "public", any>;

/** Confident bank match only (same default as match_question_bank_for_exam). */
const BANK_MATCH_THRESHOLD = 0.82;
/** Questions per tagging call — a paper of 60 is filed in three. */
const TAG_BATCH = 25;

export type StudentSyllabus = {
  examId: string;
  stream: string;
  /** "CUET Commerce" — how the student's syllabus is named to them. */
  label: string;
  chapters: SyllabusChapter[];
};

export type FiledTag = Tag & {
  matched_bank_question_id: string | null;
  /** The matched bank question's difficulty, when it had one. */
  bank_difficulty: string | null;
};

const STREAM_NAMES: Record<string, string> = {
  commerce: "Commerce",
  science: "Science",
  humanities: "Humanities",
};

/** The stream syllabus of the exam account behind a school (individual) id. */
export async function loadStudentSyllabus(admin: Admin, schoolId: string): Promise<StudentSyllabus | null> {
  const { data: ea, error: eaErr } = await admin
    .from("exam_accounts")
    .select("exam_id, stream, competitive_exams(name)")
    .eq("school_id", schoolId)
    .maybeSingle();
  if (eaErr) throw new Error(`exam account: ${eaErr.message}`);
  if (!ea?.exam_id) return null;
  const examId = ea.exam_id as string;
  const stream = ea.stream as string;

  const { data, error } = await admin
    .from("exam_syllabus_chapters")
    .select("sequence, chapters(id, name, curriculum_subjects(name), topics(id, name))")
    .eq("exam_id", examId)
    .eq("stream", stream)
    .order("sequence");
  if (error) throw new Error(`syllabus: ${error.message}`);

  type Row = {
    chapters: {
      id: string;
      name: string;
      curriculum_subjects: { name: string } | null;
      topics: Array<{ id: string; name: string }> | null;
    } | null;
  };
  const chapters = withCodes(
    ((data ?? []) as unknown as Row[])
      .filter((r) => r.chapters?.curriculum_subjects?.name)
      .map((r) => ({
        chapter_id: r.chapters!.id,
        chapter: r.chapters!.name,
        subject: r.chapters!.curriculum_subjects!.name,
        topics: r.chapters!.topics ?? [],
      })),
  );
  const exam = (ea as { competitive_exams?: { name?: string } | null }).competitive_exams;
  const examName = exam?.name ?? "Exam";
  return {
    examId,
    stream,
    label: `${examName} ${STREAM_NAMES[stream] ?? stream}`,
    chapters,
  };
}

async function fromBank(admin: Admin, syllabus: StudentSyllabus, item: TagItem): Promise<FiledTag | null> {
  const emb = await embedQueryText(item.question, { env: Deno.env.toObject() });
  if (!emb.ok) return null;
  const { data, error } = await admin.rpc("match_question_bank_for_exam", {
    p_query_embedding: JSON.stringify(emb.embedding),
    p_exam_id: syllabus.examId,
    p_subjects: null,
    p_match_threshold: BANK_MATCH_THRESHOLD,
    p_match_count: 1,
  });
  if (error || !Array.isArray(data) || !data[0]) return null;
  const top = data[0] as { id?: string; chapter_id?: string | null; topic_id?: string | null; difficulty?: string | null };
  const chapter = syllabus.chapters.find((c) => c.chapter_id === top.chapter_id);
  if (!top.id || !chapter) return null;
  const difficulty = typeof top.difficulty === "string" && /^(easy|medium|hard)$/i.test(top.difficulty.trim())
    ? top.difficulty.trim().toLowerCase()
    : null;
  return {
    kind: "tagged",
    chapter_id: chapter.chapter_id,
    topic_id: chapter.topics.some((t) => t.id === top.topic_id) ? top.topic_id ?? null : null,
    subject: chapter.subject,
    chapter: chapter.chapter,
    matched_bank_question_id: top.id,
    bank_difficulty: difficulty,
  };
}

async function byModel(
  syllabus: StudentSyllabus,
  items: TagItem[],
): Promise<{ tags: Map<number, Tag>; unanswered: number[]; error: string | null }> {
  const tags = new Map<number, Tag>();
  let unanswered: number[] = [];
  let lastError: string | null = null;
  const system = taggingSystemPrompt(syllabus.label, syllabus.chapters);
  for (let i = 0; i < items.length; i += TAG_BATCH) {
    let batch = items.slice(i, i + TAG_BATCH);
    // Asked once, then once more for whatever came back without a valid code.
    for (let attempt = 0; attempt < 2 && batch.length > 0; attempt++) {
      const res = await generateStructuredWithFallback<unknown>(
        { system, user: taggingUserPrompt(batch), schema: TAG_REPLY_SHAPE as unknown as Record<string, unknown> },
        { temperature: 0, max_tokens: 60 * batch.length + 200 },
      );
      if (!res.ok) { lastError = res.error; continue; }
      const read = readTagReply(res.data, syllabus.chapters, batch.map((b) => b.index));
      for (const [k, v] of read.tags) tags.set(k, v);
      batch = batch.filter((b) => read.unanswered.includes(b.index));
    }
    unanswered = unanswered.concat(batch.map((b) => b.index));
  }
  return { tags, unanswered, error: lastError };
}

/** Every item filed, or a failure naming how many could not be. */
export async function fileUnderSyllabus(
  admin: Admin,
  syllabus: StudentSyllabus,
  items: TagItem[],
): Promise<{ ok: true; tags: Map<number, FiledTag> } | { ok: false; error: string }> {
  if (syllabus.chapters.length === 0) return { ok: false, error: "This account has no syllabus to file questions under." };
  const tags = new Map<number, FiledTag>();
  const rest: TagItem[] = [];
  for (const item of items) {
    const hit = await fromBank(admin, syllabus, item);
    if (hit) tags.set(item.index, hit); else rest.push(item);
  }
  if (rest.length) {
    const model = await byModel(syllabus, rest);
    for (const [k, v] of model.tags) tags.set(k, { ...v, matched_bank_question_id: null, bank_difficulty: null });
    if (model.unanswered.length) {
      return {
        ok: false,
        error: `Could not file ${model.unanswered.length} question(s) under your syllabus${model.error ? ` (${model.error})` : ""}. Nothing was saved — try again.`,
      };
    }
  }
  return { ok: true, tags };
}
