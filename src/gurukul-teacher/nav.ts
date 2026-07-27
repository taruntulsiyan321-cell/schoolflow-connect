export type TeacherPageKey =
  | "dashboard"
  | "myclasses"
  | "doubts"
  | "communication"
  | "announcements"
  | "leave"
  | "profile";

export const TEACHER_PAGE_PATH: Record<TeacherPageKey, string> = {
  dashboard: "/teacher",
  myclasses: "/teacher/classes",
  doubts: "/teacher/doubts",
  communication: "/teacher/communication",
  announcements: "/teacher/announcements",
  leave: "/teacher/leave",
  profile: "/teacher/profile",
};

export const TEACHER_PAGE_TITLES: Record<TeacherPageKey, string> = {
  dashboard: "Dashboard",
  myclasses: "My Classes",
  doubts: "Student Doubts",
  communication: "Communication",
  announcements: "Announcements",
  leave: "Leave",
  profile: "My Profile",
};

export function teacherPathToPage(pathname: string): TeacherPageKey {
  const p = pathname.replace(/\/+$/, "") || "/teacher";

  if (
    p.startsWith("/teacher/classes") ||
    p.startsWith("/teacher/class") ||
    p.startsWith("/teacher/my-class") ||
    p.startsWith("/teacher/my-subjects") ||
    p.startsWith("/teacher/attendance") ||
    p.startsWith("/teacher/exams") ||
    p.startsWith("/teacher/timetable") ||
    p.startsWith("/teacher/performance") ||
    p.startsWith("/teacher/homework")
  )
    return "myclasses";
  if (p.startsWith("/teacher/doubts")) return "doubts";
  if (
    p.startsWith("/teacher/communication") ||
    p.startsWith("/teacher/chat") ||
    p.startsWith("/teacher/connect")
  )
    return "communication";
  if (p.startsWith("/teacher/announcements") || p.startsWith("/teacher/notices"))
    return "announcements";
  if (p.startsWith("/teacher/leave") || p.startsWith("/teacher/leaves")) return "leave";
  if (p.startsWith("/teacher/profile")) return "profile";
  if (p === "/teacher") return "dashboard";

  const hit = (Object.entries(TEACHER_PAGE_PATH) as [TeacherPageKey, string][]).find(([, path]) => path === p);
  return hit?.[0] ?? "dashboard";
}
