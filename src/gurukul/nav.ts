/**
 * Design page keys for the Gurukul student shell (routing only — not mock data).
 *
 * The live app is the INDIVIDUAL student panel only (2026-10-01). The school
 * student's pages — Battleground, Rankings, Resources, Doubts, Homework,
 * Attendance, Timetable, Calendar, Tests, the Learning and Class hubs, Notices
 * and Fees — are kept on the `organisation` branch (tag
 * organisation-archive-2026-10-01) with the rest of the school side.
 */
export type PageKey =
  | "dashboard" | "practice" | "mocktests" | "aicoach" | "analysis"
  | "recovery"  | "revision" | "mistakebook"
  | "achievements" | "profile" | "premium";

/** Design page keys → React Router paths under /student */
export const PAGE_PATH: Record<PageKey, string> = {
  dashboard: "/student",
  practice: "/student/practice",
  mocktests: "/student/mocks",
  aicoach: "/student/aicoach",
  analysis: "/student/analysis",
  recovery: "/student/recovery",
  revision: "/student/revision",
  mistakebook: "/student/mistakes",
  achievements: "/student/achievements",
  profile: "/student/profile",
  premium: "/student/premium",
};

/** Resolve current pathname to the closest design PageKey */
export function pathToPage(pathname: string): PageKey {
  const p = pathname.replace(/\/+$/, "") || "/student";

  // Deep functional routes still belong to a page
  if (p.startsWith("/student/recovery")) return "recovery";
  if (p.startsWith("/student/practice")) return "practice";
  // Both the list and a paper being sat: /student/mocks and /student/mock/<id>.
  if (p.startsWith("/student/mock")) return "mocktests";
  if (p.startsWith("/student/mistakes")) return "mistakebook";
  if (p.startsWith("/student/analytics") || p.startsWith("/student/analysis") || p.startsWith("/student/report"))
    return "analysis";
  if (p.startsWith("/student/revision") || p.startsWith("/student/plans")) return "revision";

  const match = (Object.entries(PAGE_PATH) as [PageKey, string][]).find(([, path]) => path === p);
  return match ? match[0] : "dashboard";
}

/**
 * The name of every screen, in one place: the screens read it through
 * PageHeader, and Layout reads it for the top bar.
 */
export const PAGE_TITLE: Record<PageKey, string> = {
  dashboard: "Home",
  practice: "Practice",
  mocktests: "Mock Tests",
  aicoach: "AI Coach",
  analysis: "Analysis",
  recovery: "Recovery",
  revision: "Revision",
  mistakebook: "Mistake Book",
  achievements: "Achievements",
  profile: "Profile",
  premium: "Plans",
};

/** `schools.kind`: a school, or an individual account's space of one. */
export type SchoolKind = "school" | "individual";

/** The sidebar and the mobile bottom bar — Layout renders exactly these. */
export const SIDEBAR_PAGES: readonly PageKey[] = [
  "dashboard", "practice", "mocktests", "aicoach", "analysis", "recovery", "revision",
  "mistakebook", "achievements", "premium",
];
export const BOTTOM_PAGES: readonly PageKey[] = [
  "dashboard", "practice", "analysis", "recovery",
];
