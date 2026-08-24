/**
 * Principal Portal - Redesigned Navigation
 *
 * Simplified, decision-oriented structure:
 * - Dashboard: Daily overview + action items
 * - People: Students, Teachers, Classes (with drill-down to profiles)
 * - Academics: Exams, Tests, Marks, Events
 * - Attendance: Daily + class-wise
 * - Communication: Messages, Inquiries, Complaints, Announcements
 * - Leave Requests: Simple operational view
 * - Reports: Existing analysis/exports
 * - Settings
 */

export type PrincipalPageKey =
  | "dashboard"
  | "people-students"
  | "people-teachers"
  | "people-classes"
  | "academics"
  | "attendance"
  | "communication"
  | "leave-requests"
  | "reports"
  | "settings";

export const PRINCIPAL_PAGE_PATH: Record<PrincipalPageKey, string> = {
  "dashboard": "/principal",
  "people-students": "/principal/students",
  "people-teachers": "/principal/teachers",
  "people-classes": "/principal/classes",
  "academics": "/principal/academics",
  "attendance": "/principal/attendance",
  "communication": "/principal/communication",
  "leave-requests": "/principal/leaves",
  "reports": "/principal/reports",
  "settings": "/principal/settings",
};

export const PRINCIPAL_NAV_STRUCTURE = [
  { key: "dashboard", label: "Dashboard", group: null },
  { key: "people-students", label: "Students", group: "People" },
  { key: "people-teachers", label: "Teachers", group: "People" },
  { key: "people-classes", label: "Classes", group: "People" },
  { key: "academics", label: "Academics", group: null },
  { key: "attendance", label: "Attendance", group: null },
  { key: "communication", label: "Communication", group: null },
  { key: "leave-requests", label: "Leave Requests", group: null },
  { key: "reports", label: "Reports", group: null },
  { key: "settings", label: "Settings", group: null },
] as const;

export function principalPathToPage(pathname: string): PrincipalPageKey {
  const p = pathname.replace(/\/+$/, "") || "/principal";

  if (p === "/principal") return "dashboard";
  if (p.startsWith("/principal/students")) return "people-students";
  if (p.startsWith("/principal/teachers")) return "people-teachers";
  if (p.startsWith("/principal/classes")) return "people-classes";
  if (p.startsWith("/principal/academics") || p.startsWith("/principal/exams") || p.startsWith("/principal/tests")) return "academics";
  if (p.startsWith("/principal/attendance")) return "attendance";
  if (p.startsWith("/principal/communication") || p.startsWith("/principal/messages") || p.startsWith("/principal/inquiries") || p.startsWith("/principal/complaints") || p.startsWith("/principal/announcements")) return "communication";
  if (p.startsWith("/principal/leaves")) return "leave-requests";
  if (p.startsWith("/principal/reports") || p.startsWith("/principal/analytics")) return "reports";
  if (p.startsWith("/principal/settings")) return "settings";

  return "dashboard";
}
