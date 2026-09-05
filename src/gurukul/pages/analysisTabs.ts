/**
 * Analysis page tabs.
 *
 * In its own module rather than in Analysis.tsx because a component file that
 * exports a constant trips `react-refresh/only-export-components` — and the
 * lint gate is wired at a baseline that must not grow.
 *
 * ── RULE 11, AS AMENDED 2026-09-05: ANALYSIS IS PRACTICE-ONLY ──────────────
 *
 * The earlier reading of rule 11 was per-tab: keep test data out of the
 * `practice` tab, and give marks their own `marks` tab plus a gated fetch. That
 * is no longer the rule. Analysis is fed by practice and by nothing else — not
 * test data, and not exam/marks data either. So:
 *
 *   · the `marks` tab is gone, along with its "Recent tests" list and
 *     test-score trend line
 *   · `TABS_NEEDING_MARKS` is gone, because no tab needs marks
 *   · Analysis issues no query against `marks` or `exams` at all
 *
 * The student's exam marks live on their marks surface. Duplicating them here
 * bought nothing and cost the separation.
 *
 * ACCEPTED CONSEQUENCE: for a student who does not practise, Analysis is now
 * near-empty. That is correct and honest — an empty analysis tab is better than
 * one padded with school data.
 *
 * It also removes a §4.2b blend that was live: `overview.avgScore` was
 * `examAvg ?? accuracy`, one field that was an exam average for some students
 * and a practice accuracy for others, with a sibling boolean as the only way to
 * tell which. Two rates from different sources are never one number.
 */

export type Tab =
  | "overview"
  | "subjects"
  | "topics"
  | "practice"
  | "activity"
  | "milestones";

export const TABS: { key: Tab; label: string }[] = [
  { key: "overview",    label: "Overview" },
  { key: "subjects",    label: "Subjects & Chapters" },
  { key: "topics",      label: "Topics" },
  { key: "practice",    label: "Practice" },
  { key: "activity",    label: "Activity & Speed" },
  { key: "milestones",  label: "Milestones & Reports" },
];
