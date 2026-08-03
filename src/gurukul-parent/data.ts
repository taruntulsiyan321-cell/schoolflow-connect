// ── Parent Panel — shared types + empty stubs (product UIs use live hooks) ─────

export interface Child {
  id: string;
  name: string;
  photo: string | null;
  className: string;
  section: string;
  rollNumber: string;
  admissionNumber: string;
  academicYear: string;
  school: string;
  dob: string;
  gender: "male" | "female";
  bloodGroup: string;
  house: string;
  classTeacher: string;
}

export interface AttendanceDayStatus {
  date: string; // "2026-07-DD"
  status: "present" | "absent" | "holiday" | "half_day" | "weekend";
}

export interface HomeworkItem {
  id: string;
  subject: string;
  title: string;
  description: string;
  dueDate: string;
  assignedDate: string;
  submissionStatus: "pending" | "submitted" | "late" | "graded";
  teacherInstructions: string;
  type: "homework" | "assignment";
  marks?: number;
  totalMarks?: number;
}

export interface TestResult {
  id: string;
  testName: string;
  subject: string;
  teacher: string;
  testDate: string;
  marksObtained: number;
  totalMarks: number;
  percentage: number;
  grade: string;
  teacherRemarks: string;
  hasAnswerSheet: boolean;
  classAverage: number;
  classRank: number;
  totalStudents: number;
}

export interface Examination {
  id: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  schedule: { subject: string; date: string; time: string; duration: string; maxMarks: number }[];
  instructions: string;
  resultPublished: boolean;
  results?: { subject: string; marksObtained: number; totalMarks: number; grade: string }[];
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  audience: "school" | "class" | "section";
  date: string;
  from: string;
  priority: "normal" | "important" | "urgent";
  hasAttachment: boolean;
  attachmentName?: string;
  read: boolean;
}

export interface Message {
  id: string;
  threadId: string;
  from: string;
  fromRole: "parent" | "teacher" | "admin";
  to: string;
  subject: string;
  body: string;
  timestamp: string;
  read: boolean;
  hasAttachment: boolean;
  attachmentName?: string;
}

export interface MessageThread {
  id: string;
  participantName: string;
  participantRole: string;
  subject: string;
  lastMessage: string;
  lastTimestamp: string;
  unreadCount: number;
  messages: Message[];
}

export interface Notification {
  id: string;
  type: "attendance" | "homework" | "test" | "exam" | "announcement" | "message" | "leave";
  title: string;
  body: string;
  timestamp: string;
  read: boolean;
  childName: string;
  link?: string;
}

export interface ParentProfile {
  name: string;
  email: string;
  phone: string;
  occupation: string;
  address: string;
  relationship: string;
  googleLinked: boolean;
  googleEmail: string;
  mobileLinked: boolean;
}

// ── Children ──────────────────────────────────────────────────────────────────

export const children: Child[] = [];

// ── Attendance ────────────────────────────────────────────────────────────────

/** @deprecated Empty stub — use ParentLiveAttendance / AttendanceService. */
export const attendanceByChild: Record<string, AttendanceDayStatus[]> = {};

// ── Homework ──────────────────────────────────────────────────────────────────

/** @deprecated Empty stub — use HomeworkService (Academic Engine). */
export const homeworkByChild: Record<string, HomeworkItem[]> = {};

// ── Test Results ──────────────────────────────────────────────────────────────

export const testResultsByChild: Record<string, TestResult[]> = {};

// ── Examinations ──────────────────────────────────────────────────────────────

export const examinationsByChild: Record<string, Examination[]> = {};

// ── Announcements ─────────────────────────────────────────────────────────────

/** Mounted product route — empty until AnnouncementService list is wired; never seed fake notices. */
export const parentAnnouncements: Announcement[] = [];

// ── Messages ──────────────────────────────────────────────────────────────────

/** Mounted product route — empty until messaging service is live. */
export const messageThreads: MessageThread[] = [];

// ── Notifications ─────────────────────────────────────────────────────────────

/** Prefer `useNotifications` for live rows; keep stub empty for type imports. */
export const parentNotifications: Notification[] = [];

// ── Academic Insights (deprecated — use ParentLivePerformance) ────────────────

export const academicInsightsByChild: Record<string, {
  overallPercentage: number;
  classRank: number;
  totalStudents: number;
  subjectPerformance: { subject: string; score: number; classAvg: number; trend: "up" | "down" | "stable" }[];
  weakSubjects: string[];
  strongSubjects: string[];
  weekAreas: string[];
  homeworkCompletion: number;
  classHomeworkAvg: number;
  practiceConsistency: number;
  learningStreak: number;
  questionsAttempted: number;
  attendanceVsClass: { mine: number; classAvg: number };
  observations: string;
}> = {};

// ── Extended Insights (for Academic Insights page) ───────────────────────────

export interface TeacherFeedbackEntry {
  teacher: string;
  subject: string;
  date: string;
  remarks: string;
  observations: string;
  suggestions: string;
}

export interface RichInsights {
  overallPercentage: number;
  overallGrade: string;
  previousOverallPercentage: number;
  classRank: number;
  totalStudents: number;
  subjectPerformance: { subject: string; score: number; classAvg: number; previousScore: number; trend: "up" | "down" | "stable" }[];
  weakSubjects: string[];
  strongSubjects: string[];
  weakChapters: string[];
  weakTopics: string[];
  strongChapters: string[];
  strongTopics: string[];
  frequentlyMistaken: string[];
  improvingAreas: string[];
  urgentAttentionAreas: string[];
  questionsToday: number;
  questionsThisWeek: number;
  questionsThisMonth: number;
  questionsTotal: number;
  practiceSessionsTotal: number;
  practiceConsistency: number;
  learningStreak: number;
  homeworkAssigned: number;
  homeworkCompleted: number;
  assignmentsTotal: number;
  assignmentsSubmitted: number;
  homeworkCompletion: number;
  classHomeworkAvg: number;
  attendancePct: number;
  presentDays: number;
  absentDays: number;
  lateAttendanceDays: number;
  previousMonthAttendancePct: number;
  attendanceVsClass: { mine: number; classAvg: number };
  teacherFeedback: TeacherFeedbackEntry[];
}

export const richInsightsByChild: Record<string, RichInsights> = {};

// ── Parent Profile ────────────────────────────────────────────────────────────

export const parentProfile: ParentProfile = {
  name: "",
  email: "",
  phone: "",
  occupation: "",
  address: "",
  relationship: "",
  googleLinked: false,
  googleEmail: "",
  mobileLinked: false,
};
