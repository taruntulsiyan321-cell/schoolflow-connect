/**
 * The student's whole syllabus, practised or not (rpc_student_syllabus_map,
 * 20261145000000). What the counts mean is src/academic/metrics/syllabusMap.ts.
 */
import { supabase } from "@/integrations/supabase/client";
import type { MapChapter, MapTopic, SyllabusMap } from "@/academic/metrics/syllabusMap";
import { RECENT_WINDOW_DAYS } from "@/academic/metrics/thresholds";

type RawCounts = { answered?: unknown; correct?: unknown; recent_answered?: unknown; recent_correct?: unknown; last_at?: unknown };
const count = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);
const counts = (r: RawCounts) => ({
  answered: count(r.answered),
  correct: count(r.correct),
  recentAnswered: count(r.recent_answered),
  recentCorrect: count(r.recent_correct),
  lastAt: typeof r.last_at === "string" ? r.last_at : null,
});

/** The server's reply, or null when it is not one. */
export function readSyllabusMap(raw: unknown): SyllabusMap | null {
  const r = (raw && typeof raw === "object" ? raw : null) as Record<string, unknown> | null;
  if (!r || !Array.isArray(r.chapters) || !Array.isArray(r.topics)) return null;
  const chapters: MapChapter[] = (r.chapters as Array<RawCounts & Record<string, unknown>>)
    .filter((c) => typeof c.chapter_id === "string")
    .map((c) => ({
      chapterId: c.chapter_id as string,
      chapter: typeof c.chapter === "string" ? c.chapter : "",
      subject: typeof c.subject === "string" ? c.subject : "",
      sequence: typeof c.sequence === "number" ? c.sequence : 0,
      ...counts(c),
    }));
  const topics: MapTopic[] = (r.topics as Array<RawCounts & Record<string, unknown>>)
    .filter((t) => typeof t.topic_id === "string" && typeof t.chapter_id === "string")
    .map((t) => ({
      topicId: t.topic_id as string,
      topic: typeof t.topic === "string" ? t.topic : "",
      chapterId: t.chapter_id as string,
      ...counts(t),
    }));
  return {
    examFound: r.exam_found === true,
    recentDays: typeof r.recent_days === "number" ? r.recent_days : RECENT_WINDOW_DAYS,
    chapters,
    topics,
    topicsLocked: r.topic_analysis_locked === true,
  };
}

export async function fetchSyllabusMap(windowDays: number = RECENT_WINDOW_DAYS): Promise<SyllabusMap | null> {
  const { data, error } = await supabase.rpc("rpc_student_syllabus_map", { _recent_days: windowDays });
  if (error) throw new Error(error.message);
  return readSyllabusMap(data);
}
