export type PrincipalPageKey =
  | "dashboard"
  | "teachers"
  | "students"
  | "classes"
  | "examinations"
  | "attendance"
  | "leaves"
  | "cases"
  | "announcements"
  | "messages"
  | "settings";

export const PRINCIPAL_PAGE_PATH: Record<PrincipalPageKey, string> = {
  dashboard: "/principal",
  teachers: "/principal/teachers",
  students: "/principal/students",
  classes: "/principal/classes",
  examinations: "/principal/exams",
  attendance: "/principal/attendance",
  leaves: "/principal/leaves",
  cases: "/principal/cases",
  announcements: "/principal/announcements",
  messages: "/principal/messages",
  settings: "/principal/settings",
};

export const PRINCIPAL_PAGE_TITLES: Record<PrincipalPageKey, string> = {
  dashboard: "Dashboard",
  teachers: "Teachers",
  students: "Students",
  classes: "Classes",
  examinations: "Examinations",
  attendance: "Attendance",
  leaves: "Leave Requests",
  cases: "Inquiries & Complaints",
  announcements: "Announcements",
  messages: "Messages",
  settings: "Settings",
};

export const PRINCIPAL_NAV_LABEL: Record<PrincipalPageKey, string> = {
  dashboard: "Dashboard",
  teachers: "Teachers",
  students: "Students",
  classes: "Classes",
  examinations: "Examinations",
  attendance: "Attendance",
  leaves: "Leave Requests",
  cases: "Inquiries & Complaints",
  announcements: "Announcements",
  messages: "Messages",
  settings: "Settings",
};

export function principalPathToPage(pathname: string): PrincipalPageKey {
  const p = pathname.replace(/\/+$/, "") || "/principal";

  if (p.startsWith("/principal/teachers")) return "teachers";
  if (p.startsWith("/principal/classes")) return "classes";
  if (p.startsWith("/principal/students")) return "students";
  if (p.startsWith("/principal/exams")) return "examinations";
  if (p.startsWith("/principal/attendance") || p.startsWith("/principal/present")) return "attendance";
  if (p.startsWith("/principal/leaves")) return "leaves";
  if (p.startsWith("/principal/cases") || p.startsWith("/principal/inquiries") || p.startsWith("/principal/complaints")) return "cases";
  if (p.startsWith("/principal/announcements") || p.startsWith("/principal/notices")) return "announcements";
  if (p.startsWith("/principal/messages")) return "messages";
  if (p.startsWith("/principal/settings") || p.startsWith("/principal/profile")) return "settings";
  if (p === "/principal") return "dashboard";

  const hit = (Object.entries(PRINCIPAL_PAGE_PATH) as [PrincipalPageKey, string][]).find(([, path]) => path === p);
  return hit?.[0] ?? "dashboard";
}
