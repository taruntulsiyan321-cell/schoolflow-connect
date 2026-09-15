import { useCallback, useEffect, useState } from "react";
import {
  RecoveryEngineService,
  type ChapterStateRow,
  type RevisionHistoryRow,
  type ServiceContext,
} from "@/academic";
import { isPlaceholderAcademicLabel } from "@/academic/taxonomy";
import { REVISION_STAGES_TO_SOLID } from "@/academic/recovery/constants";
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
  /**
   * Questions in this chapter the student has never seen — the pool the fresh
   * half of a check draws from (§5.4). Carried so the card can warn that a
   * check will be short BEFORE the student sits it.
   */
  freshAvailable: number;
  state: ChapterStateRow["state"];
}

export function dueLabelFromDate(dueDate: string | null): string {
  // Null now means "never scheduled", not "solid": passing three checks drops
  // the chapter to the long interval and it keeps a date. A solid chapter
  // reads as a date like any other, which is the honest thing — forgetting
  // did not stop because the student passed three checks.
  if (!dueDate) return "Not scheduled";
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
    // REVISION_STAGES_TO_SOLID, not a literal 3. The number lives in
    // recovery_constants, is re-exported by the TS constants module, and is
    // checked against the database by check:recovery-constants. A 3 written
    // here is a second home for it and would survive the constant changing.
    stagesToSolid: REVISION_STAGES_TO_SOLID,
    openMistakes: r.open_mistakes,
    freshAvailable: r.revision_fresh_available,
    state: r.state,
  };
}

/**
 * Chapters with a revision schedule, soonest first.
 *
 * A chapter with no date at all is dropped: it has never been scheduled and
 * there is nothing to show. Note this is no longer the same thing as "solid" —
 * a solid chapter keeps a date, at REVISION_INTERVAL_SOLID, and stays in the
 * list. That is deliberate: dropping it is how a student who proved they knew
 * a chapter three times stopped ever being asked about it again.
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

/**
 * Revision checks already taken, newest first.
 *
 * A separate hook rather than another field on useRevisionItems: the queue is
 * what the student has to DO and the history is what they have done, and one
 * of them failing to load is not a reason to blank the other. The screen
 * renders each from its own state.
 *
 * No silent fallback here either — an error is surfaced, because an empty
 * history and a failed read look identical to a student.
 */
export function useRevisionHistory(
  ctx: ServiceContext | null,
  academicReady: boolean,
): { history: RevisionHistoryRow[]; error: string | null; loading: boolean } {
  const [history, setHistory] = useState<RevisionHistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!academicReady || !ctx) return;
    let cancelled = false;
    setLoading(true);
    RecoveryEngineService.getRevisionHistory(ctx, 20)
      .then((rows) => {
        if (cancelled) return;
        setHistory(rows);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(toErrorMessage(e, "Failed to load revision history"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, academicReady]);

  return { history, error, loading };
}
