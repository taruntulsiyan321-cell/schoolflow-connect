export type ParentPageKey =
  | "dashboard"
  | "children"
  | "academic_insights"
  | "test_results"
  | "announcements"
  | "notifications"
  | "profile";

export const PARENT_PAGE_PATH: Record<ParentPageKey, string> = {
  dashboard: "/parent",
  children: "/parent/children",
  academic_insights: "/parent/insights",
  test_results: "/parent/marks",
  announcements: "/parent/notices",
  notifications: "/parent/notifications",
  profile: "/parent/profile",
};

export const PARENT_PAGE_TITLES: Record<ParentPageKey, string> = {
  dashboard: "Dashboard",
  children: "My Children",
  academic_insights: "Academic Insights",
  test_results: "Test Results",
  announcements: "Announcements",
  notifications: "Notifications",
  profile: "My Profile",
};

/**
 * The page a parent's notification opens — a parent page, or none.
 *
 * Until 20260925180000 the router gave a parent the student's own link
 * ("/student/homework"), which the parent panel cannot open. Rows written
 * before then still carry one; they open nothing rather than a dead route.
 */
export function parentLinkOf(n: { link: string | null }): string | null {
  return n.link && (n.link === "/parent" || n.link.startsWith("/parent/")) ? n.link : null;
}

export function parentPathToPage(pathname: string): ParentPageKey {
  const p = pathname.replace(/\/+$/, "") || "/parent";
  if (p.startsWith("/parent/children") || p.startsWith("/parent/attendance") || p.startsWith("/parent/homework"))
    return "children";
  if (p.startsWith("/parent/insights")) return "academic_insights";
  if (p.startsWith("/parent/marks") || p.startsWith("/parent/test-results")) return "test_results";
  if (p.startsWith("/parent/notices") || p.startsWith("/parent/announcements")) return "announcements";
  // Chat is gone from every panel; its old addresses land on the notices a
  // parent still receives rather than on a dead route.
  if (p.startsWith("/parent/chat") || p.startsWith("/parent/messages") || p.startsWith("/parent/complaints"))
    return "announcements";
  if (p.startsWith("/parent/notifications")) return "notifications";
  if (p.startsWith("/parent/profile") || p.startsWith("/parent/fees")) return "profile";
  if (p === "/parent") return "dashboard";
  const hit = (Object.entries(PARENT_PAGE_PATH) as [ParentPageKey, string][]).find(([, path]) => path === p);
  return hit?.[0] ?? "dashboard";
}
