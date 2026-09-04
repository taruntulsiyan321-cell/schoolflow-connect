/**
 * Analysis page tabs, and which of them are allowed to fetch marks.
 *
 * In its own module rather than in Analysis.tsx because a component file that
 * exports a constant trips `react-refresh/only-export-components` — and the
 * lint gate is now wired at a baseline that must not grow.
 */

export type Tab =
  | "overview"
  | "subjects"
  | "topics"
  | "practice"
  | "marks"
  | "activity"
  | "milestones";

export const TABS: { key: Tab; label: string }[] = [
  { key: "overview",    label: "Overview" },
  { key: "subjects",    label: "Subjects & Chapters" },
  { key: "topics",      label: "Topics" },
  // RULE 11, per-tab reading: the practice tab is fed by practice and nothing
  // else. It was labelled "Practice & Tests" and rendered "Recent tests" and a
  // test-score trend line — test data in the one surface the rule exists to
  // keep practice-only. Those two blocks moved to `marks`.
  { key: "practice",    label: "Practice" },
  { key: "marks",       label: "Marks history" },
  { key: "activity",    label: "Activity & Speed" },
  { key: "milestones",  label: "Milestones & Reports" },
];

/**
 * Tabs that need marks and exams. The load is gated on these, so opening the
 * practice tab issues no query against a test table at all — which is what
 * "provably practice-only" has to mean. Rendering nothing is not the same as
 * fetching nothing, and the exit criterion is about the query.
 *
 * `overview` is on the list because its "Average score" and "Marks recorded"
 * tiles are marks, and overview is a summary surface rather than the practice
 * surface rule 11 governs.
 */
export const TABS_NEEDING_MARKS: readonly Tab[] = ["overview", "marks"];
