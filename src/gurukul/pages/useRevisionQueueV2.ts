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
import { EMPTY_LIST, LOADING_LIST, type ListState } from "@/lib/listState";

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
 * along the §5.3 ladder, three consecutive passes to solid. So both branches
 * are gone rather than a third being added beside them — the flag too,
 * because a flag between two wrong answers is not a choice worth keeping.
 *
 * ── ONE ITEM IS ONE CHAPTER ───────────────────────────────────────────────
 *
 * §2: "All triggers, thresholds and scheduling operate on chapter_id." The
 * old queue was keyed on free-text names and filled with 200 rows pointing at
 * 'Chapter 3'. `id` here is the chapter UUID, and it is what the revision
 * check posts its score against.
 */

/**
 * One chapter on the revision ladder, as the screen shows it.
 *
 * Only what the screen reads. The item used to carry `priority` (computed,
 * read by nothing — the server already sorts soonest first), `bookmarked`,
 * `teacherAssigned`, `source` and `notes` (constants, so the "Teacher" badge
 * and the bookmark icon could never render), `stage` (unread) and `concept`
 * (the chapter name a second time, formatted with the concept dictionary).
 */
export interface RevItem {
  /** The chapter UUID. Not a queue-row id — there is no queue row any more. */
  id: string;
  chapter: string;
  subject: string;
  dueIn: string;
  /** Passes in a row so far. */
  passes: number;
  /** How many are needed before the chapter goes solid. */
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
  const chapter = r.chapter;
  if (!chapter || isPlaceholderAcademicLabel(chapter)) return null;
  const subject = r.subject && !isPlaceholderAcademicLabel(r.subject) ? r.subject : "";
  if (!subject) return null;
  return {
    id: r.chapter_id,
    chapter,
    subject,
    dueIn: dueLabelFromDate(r.next_revision_at),
    passes: r.consecutive_passes,
    // REVISION_STAGES_TO_SOLID, not a literal 3. The number lives in
    // recovery_constants, is re-exported by the TS constants module, and is
    // checked against the database by check:recovery-constants.
    stagesToSolid: REVISION_STAGES_TO_SOLID,
    openMistakes: r.open_mistakes,
    freshAvailable: r.revision_fresh_available,
    state: r.state,
  };
}

/**
 * One read of the engine, as a list state — loading, failed, or read.
 *
 * Both hooks below started as `loading = true` and let only an effect that
 * bailed out without a context end it, so an account the app settled without
 * a student context showed "Loading revision" for ever; and the history's
 * loading flag was never read, so the screen said "No revision checks taken
 * yet" while the history was still arriving.
 */
function useEngineList<T>(
  ctx: ServiceContext | null,
  academicReady: boolean,
  academicSettled: boolean,
  read: (ctx: ServiceContext) => Promise<T[]>,
): { list: ListState<T>; reload: () => void } {
  const [list, setList] = useState<ListState<T>>(LOADING_LIST);
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!academicReady || !ctx) {
      setList(academicSettled ? EMPTY_LIST : LOADING_LIST);
      return;
    }
    let cancelled = false;
    setList(LOADING_LIST);
    read(ctx).then(
      (items) => { if (!cancelled) setList({ status: "ready", items }); },
      // No silent fallback. A swallowed failure looks exactly like a healthy
      // empty list, which is how the old V2 path hid a broken pilot for weeks.
      // The screen says it could not load; the message is only for an error
      // that says something more than that (empty otherwise).
      (e) => { if (!cancelled) setList({ status: "failed", message: toErrorMessage(e, "") }); },
    );
    return () => { cancelled = true; };
    // `read` is a module-level constant per caller, so listing it costs
    // nothing and keeps the dependency list honest.
  }, [ctx, academicReady, academicSettled, nonce, read]);

  return { list, reload };
}

/**
 * Chapters with a revision schedule, soonest first — the server's order.
 *
 * A chapter with no date at all is dropped: it has never been scheduled and
 * there is nothing to show. That is not the same thing as "solid" — a solid
 * chapter keeps a date, at REVISION_INTERVAL_SOLID, and stays in the list.
 */
const readRevisionItems = async (ctx: ServiceContext): Promise<RevItem[]> =>
  (await RecoveryEngineService.getChapterStates(ctx))
    .filter((r) => r.next_revision_at !== null)
    .map(toRevItem)
    .filter((r): r is RevItem => r !== null);

export function useRevisionItems(
  ctx: ServiceContext | null,
  academicReady: boolean,
  academicSettled: boolean,
): { items: ListState<RevItem>; reload: () => void } {
  const { list, reload } = useEngineList(ctx, academicReady, academicSettled, readRevisionItems);
  return { items: list, reload };
}

/**
 * Revision checks already taken, newest first.
 *
 * Its own read rather than another field on useRevisionItems: the queue is
 * what the student has to DO and the history is what they have done, and one
 * of them failing to load is not a reason to blank the other.
 */
const readRevisionHistory = (ctx: ServiceContext) => RecoveryEngineService.getRevisionHistory(ctx, 20);

export function useRevisionHistory(
  ctx: ServiceContext | null,
  academicReady: boolean,
  academicSettled: boolean,
): { history: ListState<RevisionHistoryRow>; reload: () => void } {
  const { list, reload } = useEngineList(ctx, academicReady, academicSettled, readRevisionHistory);
  return { history: list, reload };
}
