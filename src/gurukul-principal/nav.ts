export type PrincipalPageKey =
  | "dashboard"
  | "analytics"
  | "teachers"
  | "students"
  | "examinations"
  | "attendance"
  | "announcements"
  | "messages"
  | "settings";

export const PRINCIPAL_PAGE_PATH: Record<PrincipalPageKey, string> = {
  dashboard: "/principal",
  analytics: "/principal/analytics",
  teachers: "/principal/teachers",
  students: "/principal/students",
  examinations: "/principal/exams",
  attendance: "/principal/attendance",
  announcements: "/principal/announcements",
  messages: "/principal/messages",
  settings: "/principal/settings",
};

export const PRINCIPAL_PAGE_TITLES: Record<PrincipalPageKey, string> = {
  dashboard: "Dashboard",
  analytics: "Analytics",
  teachers: "Teachers",
  students: "Students",
  examinations: "Examinations",
  attendance: "Attendance",
  announcements: "Announcements",
  messages: "Messages",
  settings: "Settings",
};

export const PRINCIPAL_NAV_LABEL: Record<PrincipalPageKey, string> = {
  dashboard: "Dashboard",
  analytics: "Analytics",
  teachers: "Teachers",
  students: "Students",
  examinations: "Examinations",
  attendance: "Attendance",
  announcements: "Announcements",
  messages: "Messages",
  settings: "Settings",
};

export function principalPathToPage(pathname: string): PrincipalPageKey {
  const p = pathname.replace(/\/+$/, "") || "/principal";

  if (p.startsWith("/principal/analytics") || p.startsWith("/principal/reports") || p.startsWith("/principal/performance") || p.startsWith("/principal/leaderboard"))
    return "analytics";
  if (p.startsWith("/principal/teachers")) return "teachers";
  if (p.startsWith("/principal/students") || p.startsWith("/principal/classes")) return "students";
  if (p.startsWith("/principal/exams")) return "examinations";
  if (p.startsWith("/principal/attendance") || p.startsWith("/principal/present")) return "attendance";
  if (p.startsWith("/principal/announcements") || p.startsWith("/principal/notices")) return "announcements";
  if (p.startsWith("/principal/messages")) return "messages";
  if (p.startsWith("/principal/settings") || p.startsWith("/principal/profile")) return "settings";
  if (p === "/principal") return "dashboard";

  const hit = (Object.entries(PRINCIPAL_PAGE_PATH) as [PrincipalPageKey, string][]).find(([, path]) => path === p);
  return hit?.[0] ?? "dashboard";
}
