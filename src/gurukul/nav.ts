/** Design page keys for the Gurukul student shell (routing only — not mock data). */
export type PageKey =
  | "dashboard" | "practice" | "aicoach" | "analysis"
  | "recovery"  | "revision" | "mistakebook"
  | "battleground" | "leaderboard" | "achievements"
  | "resources" | "doubtportal" | "assignments" | "attendance" | "profile"
  | "timetable" | "calendar" | "tests"
  | "learninghub" | "classhub";

/** Design page keys → React Router paths under /student */
export const PAGE_PATH: Record<PageKey, string> = {
  dashboard: "/student",
  practice: "/student/practice",
  aicoach: "/student/aicoach",
  analysis: "/student/analysis",
  recovery: "/student/recovery",
  revision: "/student/revision",
  mistakebook: "/student/mistakes",
  battleground: "/student/battleground",
  leaderboard: "/student/leaderboard",
  achievements: "/student/achievements",
  resources: "/student/resources",
  doubtportal: "/student/doubts",
  assignments: "/student/homework",
  attendance: "/student/attendance",
  profile: "/student/profile",
  timetable: "/student/timetable",
  calendar: "/student/calendar",
  tests: "/student/tests",
  learninghub: "/student/learning",
  classhub: "/student/class",
};

/** Legacy `/student/classes#section` → Gurukul class-facing routes. */
const LEGACY_CLASSES_HASH: Record<string, PageKey> = {
  attendance: "attendance",
  timetable: "timetable",
  calendar: "calendar",
  leaderboard: "leaderboard",
  homework: "assignments",
  exams: "tests",
  doubts: "doubtportal",
  resources: "resources",
  achievements: "achievements",
  class: "classhub",
};

/** Absolute paths for hashes that are not PAGE_PATH keys. */
const LEGACY_CLASSES_ABS: Record<string, string> = {
  fees: "/student/fees",
  chat: "/student/chat",
  notices: "/student/notices",
};

export function legacyClassesRedirectPath(hash?: string): string {
  const key = (hash ?? "").replace(/^#/, "").trim().toLowerCase();
  if (key && LEGACY_CLASSES_ABS[key]) return LEGACY_CLASSES_ABS[key];
  const page = LEGACY_CLASSES_HASH[key];
  return page ? PAGE_PATH[page] : PAGE_PATH.classhub;
}

const LEARNING: PageKey[] = ["learninghub", "analysis", "recovery", "revision", "mistakebook"];
const CLASS: PageKey[] = [
  "classhub", "timetable", "calendar", "attendance", "assignments",
  "tests", "doubtportal", "leaderboard", "achievements", "resources",
];

/** Resolve current pathname to the closest design PageKey */
export function pathToPage(pathname: string): PageKey {
  const p = pathname.replace(/\/+$/, "") || "/student";

  // Deep functional routes still belong to a hub
  if (p.startsWith("/student/recovery")) return "recovery";
  if (p.startsWith("/student/practice")) return "practice";
  if (p.startsWith("/student/battleground")) return "battleground";
  if (p.startsWith("/student/dpp")) return "tests";
  if (p.startsWith("/student/mistakes")) return "mistakebook";
  if (p.startsWith("/student/analytics") || p.startsWith("/student/analysis") || p.startsWith("/student/report"))
    return "analysis";
  if (p.startsWith("/student/revision") || p.startsWith("/student/plans")) return "revision";
  if (p.startsWith("/student/chat") || p.startsWith("/student/notices")) return "classhub";
  if (p.startsWith("/student/classes")) return "classhub";
  if (p.startsWith("/student/fees")) return "profile";

  const match = (Object.entries(PAGE_PATH) as [PageKey, string][]).find(([, path]) => path === p);
  if (match) return match[0];

  if (LEARNING.some((k) => PAGE_PATH[k] === p)) return p.split("/").pop() as PageKey;
  if (CLASS.some((k) => PAGE_PATH[k] === p)) return p.split("/").pop() as PageKey;

  return "dashboard";
}

export function pageTitle(page: PageKey): string {
  const titles: Record<PageKey, string> = {
    dashboard: "Home",
    practice: "Practice",
    aicoach: "AI Coach",
    analysis: "Analysis",
    recovery: "Recovery",
    revision: "Revision",
    mistakebook: "Mistake Book",
    battleground: "Battleground",
    leaderboard: "Rankings",
    achievements: "Achievements",
    resources: "Resources",
    doubtportal: "Doubts",
    assignments: "Homework",
    attendance: "Attendance",
    profile: "Profile",
    timetable: "Timetable",
    calendar: "Calendar",
    tests: "Tests",
    learninghub: "Learning",
    classhub: "Class",
  };
  return titles[page];
}
