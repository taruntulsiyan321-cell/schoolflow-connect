import { useCallback, useEffect, useState } from "react";
import { useAcademicLive } from "@/academic";
import { supabase } from "@/integrations/supabase/client";
import { EMPTY_LIST, LOADING_LIST, type ListState } from "@/lib/listState";
import { deriveWeakChapters, type WeakChapterRow } from "@/lib/weakChapters";

/**
 * The §6.3 chapter list, from the student's own rows.
 *
 * Four reads, all of them the student's:
 *   rpc_student_chapter_states  the chapters, their names and revision state
 *   chapter_tally               a session's work in a chapter — accuracy, trend
 *   student_mistakes            open, repeated, oldest, and mistakes by topic
 *   question_attempts           how long questions took
 *   rpc_my_skipped_by_chapter   what is still skipped — Skipped mode's questions
 *
 * `chapter_tally` is what makes §6.4's trend work for a chapter practised
 * inside a WHOLE-SUBJECT session: the tally is per chapter per session, so a
 * twenty-question Mathematics sitting that touched four chapters leaves four
 * rows, and each chapter has its own series. Deriving the trend from
 * practice_sessions.chapter — which is null for a subject session — gave those
 * chapters no trend at all.
 *
 * Attempts are resolved to a chapter through `question_bank_student`, not
 * through `question_attempts.chapter`, which is free text copied from the
 * session and drifts from the curriculum's own spelling.
 */

const PAGE = 1000;

/** Every row of a paged read, the student's own, oldest first. */
async function readAll<T>(
  table: "chapter_tally" | "student_mistakes" | "question_attempts",
  columns: string,
  userId: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq("user_id", userId)
      .order("created_at")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const page = (data ?? []) as unknown as T[];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

export function useWeakChapters(enabled = true, userId?: string | null) {
  const liveVersion = useAcademicLive(["xp", "profile"]);
  const [list, setList] = useState<ListState<WeakChapterRow>>(LOADING_LIST);
  const [reads, setReads] = useState(0);

  const reload = useCallback(() => setReads((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !userId) {
      setList(enabled ? LOADING_LIST : EMPTY_LIST);
      return;
    }
    let cancelled = false;
    setList(LOADING_LIST);

    (async () => {
      try {
        const [statesRes, skippedRes, tallies, mistakes, attempts] = await Promise.all([
          supabase.rpc("rpc_student_chapter_states"),
          supabase.rpc("rpc_my_skipped_by_chapter" as never),
          readAll<{ chapter_id: string | null; attempted: number | null; correct: number | null; created_at: string | null }>(
            "chapter_tally", "chapter_id, attempted, correct, created_at", userId),
          readAll<{ chapter_id: string | null; status: string | null; times_wrong: number | null; created_at: string | null; topic: string | null }>(
            "student_mistakes", "chapter_id, status, times_wrong, created_at, topic", userId),
          readAll<{ bank_question_id: string | null; time_taken_ms: number | null }>(
            "question_attempts", "bank_question_id, time_taken_ms, created_at", userId),
        ]);
        if (statesRes.error) throw statesRes.error;
        if (skippedRes.error) throw skippedRes.error;

        // Chapter for each attempt, from the bank itself. Asked for in pages,
        // because a student can hold more attempts than one response returns.
        const bankIds = [...new Set(attempts.map((a) => a.bank_question_id).filter((id): id is string => Boolean(id)))];
        const chapterOf = new Map<string, string | null>();
        for (let i = 0; i < bankIds.length; i += 200) {
          const { data, error } = await supabase
            .from("question_bank_student")
            .select("id, chapter_id")
            .in("id", bankIds.slice(i, i + 200));
          if (error) throw error;
          for (const row of data ?? []) chapterOf.set(row.id as string, (row.chapter_id as string) ?? null);
        }

        const rows = deriveWeakChapters({
          states: (statesRes.data ?? []) as Parameters<typeof deriveWeakChapters>[0]["states"],
          tallies,
          mistakes,
          attempts: attempts.map((a) => ({
            chapter_id: a.bank_question_id ? chapterOf.get(a.bank_question_id) ?? null : null,
            time_taken_ms: a.time_taken_ms,
          })),
          skipped: (skippedRes.data ?? []) as unknown as Parameters<typeof deriveWeakChapters>[0]["skipped"],
        });
        if (!cancelled) setList({ status: "ready", items: rows });
      } catch (e) {
        // A failed read says so; it never renders as "nothing needs work",
        // which is the one wrong answer this list can give.
        if (!cancelled) setList({ status: "failed", message: (e as { message?: string }).message });
      }
    })();

    return () => { cancelled = true; };
  }, [enabled, userId, liveVersion, reads]);

  return { list, reload };
}
