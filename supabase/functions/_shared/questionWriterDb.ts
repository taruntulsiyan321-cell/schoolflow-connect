/**
 * The database half of questionWriter.ts — what a function passes in as
 * WriterDeps.db, with its service-role client. Kept apart so the pipeline
 * itself imports no database client and questionWriter.test.ts can run it.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { StyleExample } from "./aiPractice.ts";
import { SAME_QUESTION_SIMILARITY } from "./aiPractice.ts";
import type { WriterDb } from "./questionWriter.ts";
import type { ChapterScope } from "./questionRubric.ts";

/** A chapter's official syllabus in an exam (20261149000000), or null — for every writer that gates. */
export async function loadChapterScope(admin: SupabaseClient, examId: string | null, chapterId: string | null): Promise<ChapterScope | null> {
  if (!examId || !chapterId) return null;
  const { data } = await admin.from("exam_syllabus_chapters")
    .select("syllabus_text, paper_asks")
    .eq("exam_id", examId).eq("chapter_id", chapterId).maybeSingle();
  const row = data as { syllabus_text: string | null; paper_asks: string | null } | null;
  return row?.syllabus_text ? { syllabus: row.syllabus_text, asks: row.paper_asks } : null;
}

export function writerDb(admin: SupabaseClient, log: string): WriterDb {
  return {
    async examples(examId, chapterId, form) {
      let q = admin.from("question_bank")
        .select("question, options, correct_index")
        .eq("exam_id", examId).eq("chapter_id", chapterId)
        .eq("is_active", true).eq("is_approved", true).not("correct_index", "is", null);
      if (form) q = q.eq("question_format", form);
      const { data } = await q.limit(3);
      return ((data ?? []) as StyleExample[]).filter((e) => Array.isArray(e.options));
    },

    async twinOf(embedding, examId, subject) {
      const { data } = await admin.rpc("match_question_bank_for_exam", {
        p_query_embedding: JSON.stringify(embedding),
        p_exam_id: examId,
        p_subjects: [subject],
        p_match_threshold: SAME_QUESTION_SIMILARITY,
        p_match_count: 1,
      });
      return Array.isArray(data) ? ((data[0] as { id?: string } | undefined)?.id ?? null) : null;
    },

    async store(items) {
      const { data, error } = await admin.rpc("store_generated_questions", { _questions: items });
      if (error) {
        console.error(`${log}: store failed:`, error.message);
        return { ok: false, error: error.message };
      }
      const s = data as { inserted?: Array<{ index: number; id: string }>; skipped?: Array<{ index: number; reason: string; existing_id?: string }> };
      return { ok: true, inserted: s.inserted ?? [], skipped: s.skipped ?? [] };
    },

    async record(rows) {
      const { error } = await admin.from("question_gate_outcomes").insert(rows);
      if (error) console.error(`${log}: gate record failed:`, error.message);
    },

    scopeOf(examId, chapterId) {
      return loadChapterScope(admin, examId, chapterId);
    },

    async topicsOf(chapterId) {
      const { data } = await admin.from("topics").select("id, name").eq("chapter_id", chapterId).order("created_at");
      return (data ?? []) as Array<{ id: string; name: string }>;
    },

    async addTopic(chapterId, name) {
      const { error } = await admin.from("topics").insert({ chapter_id: chapterId, name, origin: "ai_drafted" });
      if (error && error.code !== "23505") console.warn(`${log}: topic insert failed:`, error.message);
    },
  };
}
