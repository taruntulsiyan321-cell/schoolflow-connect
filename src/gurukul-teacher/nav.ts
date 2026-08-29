export type TeacherPageKey =
  | "dashboard"
  | "myclasses"
  | "doubts"
  | "communication"
  | "announcements"
  | "leave"
  | "profile"
  | "battleground"
  | "questionbank"
  | "aicoach";

export const TEACHER_PAGE_PATH: Record<TeacherPageKey, string> = {
  dashboard: "/teacher",
  myclasses: "/teacher/classes",
  doubts: "/teacher/doubts",
  communication: "/teacher/communication",
  announcements: "/teacher/announcements",
  leave: "/teacher/leave",
  profile: "/teacher/profile",
  battleground: "/teacher/battleground",
  questionbank: "/teacher/question-bank",
  aicoach: "/teacher/ai-coach",
};

export const TEACHER_PAGE_TITLES: Record<TeacherPageKey, string> = {
  dashboard: "Dashboard",
  myclasses: "My Classes",
  doubts: "Student Doubts",
  communication: "Communication",
  announcements: "Announcements",
  leave: "Leave",
  profile: "My Profile",
  battleground: "Battles Monitor",
  questionbank: "Question Bank",
  aicoach: "AI Coach",
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
    p.startsWith("/teacher/homework") ||
    p.startsWith("/teacher/test") ||
    p.startsWith("/teacher/reports") ||
    p.startsWith("/teacher/insights")
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
  if (p.startsWith("/teacher/battleground")) return "battleground";
  if (p.startsWith("/teacher/question-bank") || p.startsWith("/teacher/practice"))
    return "questionbank";
  if (p.startsWith("/teacher/ai-coach")) return "aicoach";
  if (p === "/teacher") return "dashboard";

  const hit = (Object.entries(TEACHER_PAGE_PATH) as [TeacherPageKey, string][]).find(([, path]) => path === p);
  return hit?.[0] ?? "dashboard";
}
