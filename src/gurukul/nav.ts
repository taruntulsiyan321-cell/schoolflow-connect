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
  notices: "/student/notices",
};

export function legacyClassesRedirectPath(hash?: string): string {
  const key = (hash ?? "").replace(/^#/, "").trim().toLowerCase();
  if (key && LEGACY_CLASSES_ABS[key]) return LEGACY_CLASSES_ABS[key];
  const page = LEGACY_CLASSES_HASH[key];
  return page ? PAGE_PATH[page] : PAGE_PATH.classhub;
}

/**
 * The two hub sections. Layout kept its own `LEARNING_KEYS`/`CLASS_KEYS` copies
 * of these to decide which sidebar entry stays lit; exported now so the
 * sidebar, the section eyebrow and the route resolver all read one list.
 */
export const LEARNING: PageKey[] = ["learninghub", "analysis", "recovery", "revision", "mistakebook"];
export const CLASS: PageKey[] = [
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
  if (p.startsWith("/student/test")) return "tests";
  if (p.startsWith("/student/mistakes")) return "mistakebook";
  if (p.startsWith("/student/analytics") || p.startsWith("/student/analysis") || p.startsWith("/student/report"))
    return "analysis";
  if (p.startsWith("/student/revision") || p.startsWith("/student/plans")) return "revision";
  if (p.startsWith("/student/notices") || p.startsWith("/student/notifications"))
    return "classhub";
  if (p.startsWith("/student/classes")) return "classhub";
  if (p.startsWith("/student/fees")) return "profile";

  const match = (Object.entries(PAGE_PATH) as [PageKey, string][]).find(([, path]) => path === p);
  if (match) return match[0];

  if (LEARNING.some((k) => PAGE_PATH[k] === p)) return p.split("/").pop() as PageKey;
  if (CLASS.some((k) => PAGE_PATH[k] === p)) return p.split("/").pop() as PageKey;

  return "dashboard";
}

/**
 * The name of every screen, in one place.
 *
 * This map also existed as a private `const pageTitle` inside Layout.tsx, with
 * identical contents, while the function that used to live here was exported
 * and imported by nobody. Two homes for one fact; the screens now read this one
 * through PageHeader, and Layout reads it for the top bar.
 */
export const PAGE_TITLE: Record<PageKey, string> = {
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

export function pageTitle(page: PageKey): string {
  return PAGE_TITLE[page];
}

/**
 * Which sidebar section a screen lives under — the header's eyebrow.
 *
 * Screens carried four different eyebrow vocabularies: "Student Panel" (2),
 * "Learning Workflow" (3), "Gurukul" (1), the time-of-day greeting (1), and
 * nothing at all (15). None of them told the student anything they could use.
 *
 * This does: it names the sidebar entry the screen sits under, so a student who
 * arrived on Recovery from a Home shortcut can see it belongs to Learning and
 * knows where to find it again. The six top-level screens are their own
 * section and get no eyebrow — the title already says it.
 */
export function pageSection(page: PageKey): string | undefined {
  if (TOP_LEVEL.includes(page)) return undefined;
  if (LEARNING.includes(page)) return "Learning";
  if (CLASS.includes(page)) return "Class";
  return undefined;
}

/** The six entries in the sidebar. Their own titles are the whole hierarchy. */
const TOP_LEVEL: PageKey[] = [
  "dashboard", "practice", "aicoach", "battleground", "learninghub", "classhub",
];
