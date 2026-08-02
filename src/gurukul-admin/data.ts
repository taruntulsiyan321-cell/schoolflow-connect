/**
 * Admin panel shared types + empty stubs.
 * Mounted `/admin/*` UIs must not seed fake students/teachers/KPIs.
 * Prefer Academic Engine / Supabase / live hooks; show 0 / empty when unknown.
 */

export type StudentStatus = "active" | "inactive" | "suspended";
export type TeacherStatus = "active" | "inactive" | "suspended";
export type ParentStatus = "active" | "inactive" | "suspended";

export interface AdminStudent {
  id: string;
  admissionNumber: string;
  rollNumber: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  gender: "male" | "female";
  dob: string;
  className: string;
  section: string;
  status: StudentStatus;
  address: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
  joinedDate: string;
  avatar?: string;
  attendance: number;
  performanceScore: number;
  lastActive: string;
}

export interface AdminTeacher {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  phone: string;
  gender: "male" | "female";
  dob: string;
  qualification: string;
  department: string;
  subjects: string[];
  assignedClasses: string[];
  assignedSections: string[];
  status: TeacherStatus;
  address: string;
  joiningDate: string;
  attendance: number;
  lastActive: string;
}

export interface AdminParent {
  id: string;
  fullName: string;
  fatherName: string;
  motherName: string;
  relationship: "Father" | "Mother" | "Guardian";
  email: string;
  phone: string;
  occupation: string;
  address: string;
  linkedStudentIds: string[];
  status: ParentStatus;
  lastLogin: string;
  joinedDate: string;
}

export interface AdminSection {
  id: string;
  name: string;
  classId: string;
  classTeacherId: string | null;
  subjectTeacherIds: string[];
  studentIds: string[];
  totalStudents: number;
  attendanceToday: number;
}

export interface AdminClass {
  id: string;
  name: string;
  sections: AdminSection[];
  totalStudents: number;
  totalTeachers: number;
  recentAnnouncement?: string;
}

export interface Activity {
  id: string;
  type:
    | "student_added"
    | "teacher_added"
    | "student_deleted"
    | "teacher_deleted"
    | "password_reset"
    | "class_changed"
    | "student_promoted"
    | "announcement"
    | "suspension";
  description: string;
  actor: string;
  target: string;
  time: string;
  ago: string;
}

export interface PendingRequest {
  id: string;
  type: "doubt" | "leave" | "password_reset" | "enrollment" | "transfer";
  title: string;
  from: string;
  fromClass?: string;
  time: string;
  priority: "high" | "medium" | "low";
}

export interface Announcement {
  id: string;
  title: string;
  content: string;
  audience: "all" | "students" | "teachers" | "parents";
  createdBy: string;
  date: string;
  pinned: boolean;
}

/** @deprecated Empty stub — never seed fake roster; wire Academic Engine / profiles. */
export const adminStudents: AdminStudent[] = [];

/** @deprecated Empty stub — never seed fake staff directory. */
export const adminTeachers: AdminTeacher[] = [];

/** @deprecated Empty stub — never seed fake parent directory. */
export const adminParents: AdminParent[] = [];

/** Honest zeros until live school rollups are wired. */
export const adminStats = {
  totalStudents: 0,
  totalTeachers: 0,
  totalParents: 0,
  totalClasses: 0,
  activeUsersToday: 0,
  pendingRequests: 0,
  pendingDoubts: 0,
  studentAttendanceToday: 0,
  teacherAttendanceToday: 0,
  newStudentsThisMonth: 0,
  newTeachersThisMonth: 0,
};

/** @deprecated Empty stub — no fake activity feed. */
export const recentActivities: Activity[] = [];

/** @deprecated Empty stub — no fake pending queue. */
export const pendingRequests: PendingRequest[] = [];

/** @deprecated Empty stub — use announcement service when wired. */
export const announcements: Announcement[] = [];

/** Curriculum option labels (not people/stats). */
export const classes = ["11th", "12th"];
export const sections = ["A", "B"];
export const departments = ["Science", "Commerce", "Languages", "Technology", "Arts"];
export const allSubjects = [
  "Mathematics",
  "Physics",
  "Chemistry",
  "Biology",
  "English",
  "Hindi",
  "Computer Science",
  "Accountancy",
  "Business Studies",
  "Statistics",
  "IT",
  "Literature",
  "Environmental Science",
];

/** @deprecated Empty stub — Classes page loads live AttendanceService / AnalyticsService. */
export const adminClasses: AdminClass[] = [];
