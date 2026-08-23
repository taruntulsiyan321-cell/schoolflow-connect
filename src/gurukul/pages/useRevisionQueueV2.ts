import { useEffect, useMemo, useState } from "react";
import type { ServiceContext } from "@/academic";
import { DecisionEngineService, type RevisionRecommendation } from "@/academic/services/decisionEngineService";
import { isPlaceholderAcademicLabel } from "@/academic/taxonomy";
import { DECISION_ENGINE_FEATURE_FLAGS } from "@/lib/productFeatureFlags";
import type { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { toErrorMessage } from "@/lib/presentation";

/**
 * Revision.tsx's item shape and legacy (snapshot.revision_queue-derived)
 * mapping -- moved here rather than left inline in the page component so
 * that file keeps exporting only components (React Fast Refresh requires
 * this; a page file that also exports plain functions/types loses
 * component-level hot reload). Zero behavioral change from where these
 * lived before.
 */
export interface RevItem {
  id: string; concept: string; subject: string; chapter: string;
  dueIn: string; priority: number; bookmarked: boolean;
  teacherAssigned: boolean;
  source: string; notes?: string;
}

function dueLabelFromDate(dueDate: string): string {
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

function mapRevisionQueue(
  queue: NonNullable<ReturnType<typeof useStudentAcademicSnapshot>["data"]>["revision_queue"],
): RevItem[] {
  if (!queue?.length) return [];
  return queue
    .map((r) => {
      const concept = [r.topic, r.chapter, r.subject].find((x) => !isPlaceholderAcademicLabel(x));
      const subject = !isPlaceholderAcademicLabel(r.subject) ? r.subject : "";
      if (!concept || !subject) return null;
      const chapter = !isPlaceholderAcademicLabel(r.chapter) ? (r.chapter ?? "—") : "—";
      return {
        id: r.id,
        concept,
        subject,
        chapter,
        dueIn: dueLabelFromDate(r.due_date),
        priority: r.priority,
        bookmarked: false,
        teacherAssigned: false,
        source: "revision",
      };
    })
    .filter((row): row is RevItem => !!row);
}

/**
 * Decision Engine Slice 2 swap-in for Revision.tsx's data source, gated by
 * DECISION_ENGINE_FEATURE_FLAGS.revisionV2 (default off).
 *
 * Flag off: returns the exact legacy mapping above, unchanged.
 * Flag on: fetches rpc_revision_plan_v2 directly instead of reading
 * snapshot.revision_queue -- that field is shared by Dashboard, LearningHub,
 * and Analysis.tsx too (confirmed via grep), so overriding it in the shared
 * useStudentAcademicSnapshot hook would leak into those pages. Scoping the
 * swap here keeps this to the one intended consumer, Revision.tsx.
 */
export function useRevisionItems(
  ctx: ServiceContext | null,
  academicReady: boolean,
  snapshot: ReturnType<typeof useStudentAcademicSnapshot>["data"],
): { items: RevItem[]; v2Error: string | null } {
  const legacy = useMemo(() => mapRevisionQueue(snapshot?.revision_queue), [snapshot?.revision_queue]);
  const [v2Items, setV2Items] = useState<RevItem[] | null>(null);
  const [v2Error, setV2Error] = useState<string | null>(null);

  useEffect(() => {
    if (!DECISION_ENGINE_FEATURE_FLAGS.revisionV2 || !academicReady || !ctx) return;
    let cancelled = false;
    DecisionEngineService.getRevisionPlanV2(ctx)
      .then((recs) => {
        if (cancelled) return;
        setV2Items(recs.map(toRevItem));
        setV2Error(null);
      })
      .catch((e) => {
        if (cancelled) return;
        // No silent fallback -- same reasoning as Weak Areas V2: a
        // swallowed failure here would look identical to a healthy, empty
        // queue, masking a broken pilot. Surfaced via Revision.tsx's own
        // existing error UI (widened OR-condition), not a new one.
        setV2Error(toErrorMessage(e, "Failed to load revision plan"));
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, academicReady]);

  if (!DECISION_ENGINE_FEATURE_FLAGS.revisionV2) return { items: legacy, v2Error: null };
  return { items: v2Items ?? [], v2Error };
}

function toRevItem(r: RevisionRecommendation): RevItem {
  const subject = r.subject;
  const chapter = r.chapter && !isPlaceholderAcademicLabel(r.chapter) ? r.chapter : "—";
  const concept = r.subconcept ?? r.concept;
  return {
    // Synthetic -- rpc_revision_plan_v2 has no id, and this never
    // corresponds to a real revision_queue row. "Mark done" on a V2 item
    // will fail with rpc_complete_revision's own "item not found" exception
    // rather than silently succeeding -- safe by construction, documented
    // as a known limitation of this first pass rather than fixed here (no
    // rpc_complete_revision_v2 exists yet to fix it with).
    id: `v2:${subject}|${chapter}|${concept}`,
    concept,
    subject,
    chapter,
    // Adapter, not a real date -- rpc_revision_plan_v2 has no due_date;
    // retention decays continuously, there is no single day it crosses a
    // threshold without picking one. priority (0-100, urgency) is mapped
    // into the same bucket labels the legacy due_date path already
    // produces, so every downstream consumer (AI_SCHEDULE grouping, the
    // due/upcoming filter, DueTag styling) works unchanged.
    dueIn: dueLabelFromPriority(r.priority),
    priority: r.priority,
    bookmarked: false,
    teacherAssigned: false,
    source: "revision-v2",
  };
}

function dueLabelFromPriority(priority: number): string {
  if (priority >= 80) return "Now";
  if (priority >= 60) return "Today";
  if (priority >= 40) return "Tomorrow";
  const days = Math.max(2, Math.round((100 - priority) / 10));
  return `${days} days`;
}
