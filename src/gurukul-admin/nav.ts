export type AdminPageKey =
  | "dashboard"
  | "students"
  | "teachers"
  | "parents"
  | "classes"
  | "reports"
  | "announcements"
  | "examinations"
  | "homework"
  | "leave_requests"
  | "ai_analytics"
  | "settings";

export const ADMIN_PAGE_PATH: Record<AdminPageKey, string> = {
  dashboard: "/admin",
  students: "/admin/students",
  teachers: "/admin/teachers",
  parents: "/admin/parents",
  classes: "/admin/classes",
  reports: "/admin/reports",
  announcements: "/admin/announcements",
  examinations: "/admin/examinations",
  homework: "/admin/homework",
  leave_requests: "/admin/leave-requests",
  ai_analytics: "/admin/ai-analytics",
  settings: "/admin/settings",
};

export const ADMIN_PAGE_TITLES: Record<AdminPageKey, string> = {
  dashboard: "Dashboard",
  students: "Student Management",
  teachers: "Teacher Management",
  parents: "Parent Management",
  classes: "Class & Section Management",
  reports: "Reports",
  announcements: "Announcements",
  examinations: "Examination Management",
  homework: "Homework",
  leave_requests: "Leave Requests",
  ai_analytics: "AI Analytics",
  settings: "Settings",
};

export function adminPathToPage(pathname: string): AdminPageKey {
  const p = pathname.replace(/\/+$/, "") || "/admin";
  if (p.startsWith("/admin/students")) return "students";
  if (p.startsWith("/admin/teachers")) return "teachers";
  if (p.startsWith("/admin/parents")) return "parents";
  if (p.startsWith("/admin/classes")) return "classes";
  if (p.startsWith("/admin/reports") || p.startsWith("/admin/fees")) return "reports";
  if (p.startsWith("/admin/announcements") || p.startsWith("/admin/notices")) return "announcements";
  if (p.startsWith("/admin/examinations") || p.startsWith("/admin/exams")) return "examinations";
  if (p.startsWith("/admin/homework")) return "homework";
  if (p.startsWith("/admin/leave")) return "leave_requests";
  if (p.startsWith("/admin/ai-analytics")) return "ai_analytics";
  if (
    p.startsWith("/admin/settings") ||
    p.startsWith("/admin/roles") ||
    p.startsWith("/admin/profile") ||
    p.startsWith("/admin/users")
  ) {
    return "settings";
  }
  if (p.startsWith("/admin/attendance") || p.startsWith("/admin/timetable")) return "classes";
  if (p === "/admin") return "dashboard";
  const hit = (Object.entries(ADMIN_PAGE_PATH) as [AdminPageKey, string][]).find(
    ([, path]) => path === p,
  );
  return hit?.[0] ?? "dashboard";
}
