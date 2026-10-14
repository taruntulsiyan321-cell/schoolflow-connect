import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PreviousYearPaper = { source: string | null; exam_year: number | null };

const NONE: ReadonlyMap<string, PreviousYearPaper> = new Map();

/**
 * The papers the previous-year questions among `ids` were set in, from the
 * student's own view of the bank. Any other question is absent from the map.
 */
export async function loadPreviousYearPapers(ids: ReadonlyArray<string>): Promise<ReadonlyMap<string, PreviousYearPaper>> {
  if (ids.length === 0) return NONE;
  const { data, error } = await supabase
    .from("question_bank_student")
    .select("id, source, exam_year")
    .in("id", [...ids])
    .not("exam_year", "is", null);
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{ id: string } & PreviousYearPaper>;
  return new Map(rows.map((r) => [r.id, { source: r.source, exam_year: r.exam_year }]));
}

/**
 * loadPreviousYearPapers for a screen that holds questions as an attempt froze
 * them (a session's or a mock paper's review), for PreviousYearBadge.
 *
 * One read for the whole screen, again only when the set of ids changes. A
 * read that fails leaves the map empty: the questions are all still shown,
 * only without their paper's name.
 */
export function usePreviousYearPapers(bankQuestionIds: ReadonlyArray<string>): ReadonlyMap<string, PreviousYearPaper> {
  const key = [...new Set(bankQuestionIds)].sort().join(",");
  const [papers, setPapers] = useState<ReadonlyMap<string, PreviousYearPaper>>(NONE);
  useEffect(() => {
    let cancelled = false;
    loadPreviousYearPapers(key ? key.split(",") : []).then(
      (found) => { if (!cancelled) setPapers(found); },
      () => { if (!cancelled) setPapers(NONE); },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);
  return papers;
}
