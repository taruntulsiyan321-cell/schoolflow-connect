/** Teacher panel shared types. Product UIs load live Academic Engine / Supabase data — no demo seeds. */

export interface TeacherProfile {
  id: string;
  name: string;
  employeeId: string;
  email: string;
  phone: string;
  department: string;
  subjects: string[];
  qualification: string;
  joinedDate: string;
  address: string;
  gender: "male" | "female";
  isClassTeacher: boolean;
  classTeacherOf: { className: string; section: string } | null;
  googleLinked: boolean;
  googleEmail: string;
  mobileLinked: boolean;
}

export interface ClassInfo {
  id: string;
  className: string;
  section: string;
  subject: string;
  isClassTeacher: boolean;
  studentCount: number;
  schedule: { day: string; time: string }[];
}

export interface Student {
  id: string;
  name: string;
  rollNumber: string;
  admissionNumber: string;
  gender: "male" | "female";
  parentName: string;
  parentPhone: string;
  attendancePct: number;
  performanceScore: number;
  status: "active" | "inactive";
}

export interface AttendanceRecord {
  studentId: string;
  studentName: string;
  rollNumber: string;
  status: "present" | "absent" | "late" | "excused";
}

export interface HomeworkItem {
  id: string;
  classId: string;
  subject: string;
  title: string;
  description: string;
  instructions: string;
  assignedDate: string;
  dueDate: string;
  totalStudents: number;
  submitted: number;
  pending: number;
  status: "active" | "closed";
  submissions: {
    studentId: string;
    studentName: string;
    submittedAt: string;
    status: "submitted" | "late" | "pending";
    remarks?: string;
  }[];
}

export interface Assignment {
  id: string;
  classId: string;
  subject: string;
  title: string;
  description: string;
  dueDate: string;
  maxMarks: number;
  assignedDate: string;
  totalStudents: number;
  submitted: number;
  graded: number;
  status: "active" | "closed";
  submissions: {
    studentId: string;
    studentName: string;
    submittedAt: string;
    status: "submitted" | "graded" | "pending";
    marks?: number;
    feedback?: string;
  }[];
}

export interface Test {
  id: string;
  classId: string;
  className: string;
  section: string;
  subject: string;
  testName: string;
  testDate: string;
  startTime: string;
  endTime: string;
  duration: string;
  totalQuestions: number;
  totalMarks: number;
  chapters: string[];
  topics: string[];
  instructions: string;
  status: "draft" | "scheduled" | "ongoing" | "completed" | "marks_published";
  marksPublished: boolean;
  studentMarks: {
    studentId: string;
    studentName: string;
    rollNumber: string;
    marks: number | null;
    percentage: number | null;
    grade: string | null;
    remarks: string;
    answerSheetUploaded: boolean;
  }[];
}

export interface Doubt {
  id: string;
  studentId: string;
  studentName: string;
  className: string;
  section: string;
  subject: string;
  question: string;
  askedAt: string;
  status: "open" | "resolved";
  hasAttachment: boolean;
  attachmentName?: string;
  replies: { from: "teacher" | "student"; text: string; timestamp: string; hasAttachment?: boolean }[];
}

export interface TeacherMessage {
  id: string;
  threadId: string;
  participantName: string;
  participantRole: "student" | "parent" | "admin" | "principal";
  subject: string;
  lastMessage: string;
  lastTimestamp: string;
  unreadCount: number;
  messages: {
    id: string;
    from: string;
    fromRole: string;
    body: string;
    timestamp: string;
    hasAttachment: boolean;
    attachmentName?: string;
  }[];
}

export interface TeacherAnnouncement {
  id: string;
  title: string;
  body: string;
  targetClass: string;
  targetSection: string;
  status: "draft" | "published" | "scheduled";
  scheduledFor?: string;
  publishedAt?: string;
  hasAttachment: boolean;
  attachmentName?: string;
  priority: "normal" | "important" | "urgent";
}

export interface LeaveRequest {
  id: string;
  leaveType: "casual" | "sick" | "earned" | "emergency" | "other";
  fromDate: string;
  toDate: string;
  days: number;
  reason: string;
  status: "pending" | "approved" | "rejected";
  appliedAt: string;
  adminRemarks?: string;
}

/** @deprecated Empty stubs — product panels use Academic Engine / live hooks. */
export const assignedClasses: ClassInfo[] = [];
export const studentsByClass: Record<string, Student[]> = {};
export const todayAttendance: Record<
  string,
  { submitted: boolean; approved: boolean; records: AttendanceRecord[] }
> = {};
export const homeworkByClass: Record<string, HomeworkItem[]> = {};
export const assignmentsByClass: Record<string, Assignment[]> = {};
export const testsByClass: Record<string, Test[]> = {};
export const teacherDoubts: Doubt[] = [];
export const teacherMessages: TeacherMessage[] = [];
export const teacherAnnouncements: TeacherAnnouncement[] = [];
export const leaveRequests: LeaveRequest[] = [];
