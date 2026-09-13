import { useCallback, useEffect, useState } from "react";
import { RecoveryEngineService, type ChapterStateRow, type ServiceContext } from "@/academic";
import { isPlaceholderAcademicLabel } from "@/academic/taxonomy";
import { toErrorMessage } from "@/lib/presentation";

/**
 * Revision's data source — the 7C engine, and nothing else.
 *
 * ── WHAT THIS REPLACED, AND WHY BOTH HAD TO GO ────────────────────────────
 *
 * Until now this module chose between two sources on a feature flag:
 *
 *   flag off   snapshot.revision_queue — rows written by
 *              rpc_record_concept_mistake with `due_date = CURRENT_DATE` on
 *              every single wrong answer. Nothing anywhere applied the §5.3
 *              intervals, so EVERY item was due today, forever. Measured on
 *              production: 223 rows, 223 due, 0 upcoming. That is not spaced
 *              repetition; it is a to-do list that refills itself.
 *
 *   flag on    rpc_revision_plan_v2 — no ids, so this module minted synthetic
 *              ones (`v2:subject|chapter|concept`) and its own comment
 *              admitted "Mark done" would throw `rpc_complete_revision`'s
 *              "item not found". A path that cannot complete an item is not a
 *              revision feature.
 *
 * Neither was the engine. chapter_state is: it carries next_revision_at,
 * revision_stage and consecutive_revision_passes, and the server walks them
 * 7 → 21 → 60 with three consecutive passes to solid. So both branches are
 * gone rather than a third being added beside them — the flag too, because a
 * flag between two wrong answers is not a choice worth keeping.
 *
 * ── ONE ITEM IS ONE CHAPTER ───────────────────────────────────────────────
 *
 * §2: "All triggers, thresholds and scheduling operate on chapter_id." The
 * old queue was keyed on free-text names and filled with 200 rows pointing at
 * 'Chapter 3'. `id` here is the chapter UUID, and it is what the revision
 * check posts its score against.
 */

export interface RevItem {
  /** The chapter UUID. Not a queue-row id — there is no queue row any more. */
  id: string;
  concept: string;
  subject: string;
  chapter: string;
  dueIn: string;
  priority: number;
  bookmarked: boolean;
  teacherAssigned: boolean;
  source: string;
  notes?: string;
  /** Which rung of the 7/21/60 ladder, 1-based. */
  stage: number;
  /** Passes in a row so far. */
  passes: number;
  /** How many are needed before the chapter leaves the queue. */
  stagesToSolid: number;
  /** Open mistakes still recorded against this chapter. */
  openMistakes: number;
  state: ChapterStateRow["state"];
}

export function dueLabelFromDate(dueDate: string | null): string {
  if (!dueDate) return "Solid";
  try {
    const due = new Date(dueDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    const diff = Math.round((due.getTime() - today.getTime()) / 86400000);
    if (diff < 0) return "Now";
    if (diff === 0) return "Today";
    if (diff === 1) return "Tomorrow";
    if (diff <= 7) return `${diff} days`;
    return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

function toRevItem(r: ChapterStateRow): RevItem | null {
  const chapterRaw = r.chapter;
  const subjectRaw = r.subject;
  if (!chapterRaw || isPlaceholderAcademicLabel(chapterRaw)) return null;
  const subject = subjectRaw && !isPlaceholderAcademicLabel(subjectRaw) ? subjectRaw : "";
  if (!subject) return null;

  return {
    id: r.chapter_id,
    concept: chapterRaw,
    subject,
    chapter: chapterRaw,
    dueIn: dueLabelFromDate(r.next_revision_at),
    // Due beats not-due, and among the due ones the longest-overdue sorts
    // first. Not a stored field: the engine has no priority column, because
    // the date already says everything priority used to approximate.
    priority: r.revision_due ? 100 : 50,
    bookmarked: false,
    teacherAssigned: false,
    source: "chapter-state",
    stage: Math.max(r.revision_stage, 1),
    passes: r.consecutive_passes,
    stagesToSolid: 3,
    openMistakes: r.open_mistakes,
    state: r.state,
  };
}

/**
 * Chapters with a revision schedule, soonest first.
 *
 * A chapter that has gone solid (next_revision_at null) is dropped here rather
 * than shown as "Done" — §5.3 says it leaves the queue, and a queue that keeps
 * everything it has ever finished stops being a queue.
 */
export function useRevisionItems(
  ctx: ServiceContext | null,
  academicReady: boolean,
): { items: RevItem[]; error: string | null; loading: boolean; reload: () => void } {
  const [items, setItems] = useState<RevItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!academicReady || !ctx) return;
    let cancelled = false;
    setLoading(true);
    RecoveryEngineService.getChapterStates(ctx)
      .then((rows) => {
        if (cancelled) return;
        setItems(
          rows
            .filter((r) => r.next_revision_at !== null)
            .map(toRevItem)
            .filter((r): r is RevItem => r !== null),
        );
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        // No silent fallback. A swallowed failure here looks exactly like a
        // healthy empty queue, which is how the old V2 path hid a broken
        // pilot for weeks.
        setError(toErrorMessage(e, "Failed to load revision schedule"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, academicReady, nonce]);

  return { items, error, loading, reload };
}
