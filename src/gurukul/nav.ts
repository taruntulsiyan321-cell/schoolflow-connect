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
  | "achievements" | "profile" | "premium" | "notifications";

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
  notifications: "/student/notifications",
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

/** The name of every screen, as the top bar shows it. */
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
  notifications: "Notifications",
};

/** `schools.kind`: a school, or an individual account's space of one. */
export type SchoolKind = "school" | "individual";

export type NavGroupKey = "home" | "study" | "improve" | "progress" | "account";
export type NavGroup = { key: NavGroupKey; label: string; pages: readonly PageKey[] };

/**
 * Every page, classified under one head (owner, 2026-10-03: the pages do not
 * fit a phone side by side). This one list is the whole menu. The sidebar shows
 * each head as a section; a phone's bottom bar has one tab per head, and the
 * open head's pages run along the top of the screen. A head's tab opens its
 * FIRST page — the same pages the phone's bottom bar opened before the heads.
 */
export const NAV_GROUPS: readonly NavGroup[] = [
  { key: "home", label: "Home", pages: ["dashboard"] },
  { key: "study", label: "Study", pages: ["practice", "mocktests", "aicoach"] },
  { key: "improve", label: "Improve", pages: ["recovery", "revision", "mistakebook"] },
  { key: "progress", label: "Progress", pages: ["analysis", "achievements"] },
  { key: "account", label: "Account", pages: ["profile", "premium", "notifications"] },
];

/**
 * Pages that fill the screen rather than scroll as a document: the shell gives
 * them a full-height frame with no side padding, and they lay themselves out
 * inside it. AI Coach is a chat — its composer must stay on screen.
 */
export const FILLS_SCREEN: ReadonlySet<PageKey> = new Set<PageKey>(["aicoach"]);

/** The head a page is filed under. Every page has exactly one (nav.individualPanel.test.ts). */
export function groupOf(page: PageKey): NavGroup {
  return NAV_GROUPS.find((g) => g.pages.includes(page)) ?? NAV_GROUPS[0];
}
