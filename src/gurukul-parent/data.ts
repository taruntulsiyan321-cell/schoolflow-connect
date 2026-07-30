// ── Parent Panel — Mock Data ───────────────────────────────────────────────────

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

function buildAttendanceMonth(year: number, month: number): AttendanceDayStatus[] {
  const days: AttendanceDayStatus[] = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const dow = new Date(date).getDay();
    if (dow === 0 || dow === 6) {
      days.push({ date, status: "weekend" });
    } else if ([3, 12].includes(d)) {
      days.push({ date, status: "holiday" });
    } else if ([5, 18].includes(d)) {
      days.push({ date, status: "absent" });
    } else {
      days.push({ date, status: "present" });
    }
  }
  return days;
}

export const attendanceByChild: Record<string, AttendanceDayStatus[]> = {};

// ── Homework ──────────────────────────────────────────────────────────────────

export const homeworkByChild: Record<string, HomeworkItem[]> = {};

// ── Test Results ──────────────────────────────────────────────────────────────

export const testResultsByChild: Record<string, TestResult[]> = {};

// ── Examinations ──────────────────────────────────────────────────────────────

export const examinationsByChild: Record<string, Examination[]> = {};

// ── Announcements ─────────────────────────────────────────────────────────────

export const parentAnnouncements: Announcement[] = [
  { id: "a1", title: "Half-Yearly Examination Schedule Released", body: "The schedule for the upcoming Half-Yearly Examination has been published. Please check the Examinations section for subject-wise dates and timings. Ensure your child is well-prepared.", audience: "school", date: "2026-07-24", from: "School Administration", priority: "important", hasAttachment: true, attachmentName: "HalfYearly_Schedule.pdf", read: false },
  { id: "a2", title: "Independence Day Celebration — 15th August", body: "The school will celebrate Independence Day on 15th August 2026. All students must be in formal school uniform. Reporting time is 7:30 AM. Cultural events will follow the flag hoisting.", audience: "school", date: "2026-07-22", from: "Principal", priority: "normal", hasAttachment: false, read: true },
  { id: "a3", title: "Parent-Teacher Meeting — 2nd August", body: "A Parent-Teacher Meeting is scheduled for Saturday, 2nd August 2026 from 10:00 AM to 1:00 PM. All parents of Class 10 are requested to attend to discuss academic progress.", audience: "class", date: "2026-07-20", from: "Class Teacher", priority: "important", hasAttachment: false, read: false },
  { id: "a4", title: "Swimming Classes Optional Enrolment", body: "Enrolment for the optional swimming programme is now open. Please fill the form available at the school office. Limited seats — first come first served.", audience: "school", date: "2026-07-18", from: "Sports Department", priority: "normal", hasAttachment: false, read: true },
  { id: "a5", title: "Section Holiday on 28th July", body: "Due to a local festival, Section A will not have classes on 28th July 2026. School resumes normally on 29th July.", audience: "section", date: "2026-07-17", from: "Class Teacher", priority: "normal", hasAttachment: false, read: true },
  { id: "a6", title: "Uniform Inspection on Monday", body: "A uniform inspection will be conducted every Monday morning. Please ensure your child wears the complete uniform including the school belt, ID card, and polished shoes.", audience: "school", date: "2026-07-15", from: "Vice Principal", priority: "normal", hasAttachment: false, read: true },
];

// ── Messages ──────────────────────────────────────────────────────────────────

export const messageThreads: MessageThread[] = [
  {
    id: "mt1",
    participantName: "Mrs. Preethi Sundaram",
    participantRole: "Class Teacher — 10A",
    subject: "Arjun's Progress in Mathematics",
    lastMessage: "Please ensure he revises Chapter 5 over the weekend.",
    lastTimestamp: "2026-07-25 3:42 PM",
    unreadCount: 1,
    messages: [
      { id: "m1", threadId: "mt1", from: "Rajesh Mehta (You)", fromRole: "parent", to: "Mrs. Preethi Sundaram", subject: "Arjun's Progress in Mathematics", body: "Good afternoon, Mrs. Sundaram. I wanted to check in about Arjun's performance in maths. He has been scoring well in unit tests, but I notice he sometimes struggles with word problems.", timestamp: "2026-07-23 10:12 AM", read: true, hasAttachment: false },
      { id: "m2", threadId: "mt1", from: "Mrs. Preethi Sundaram", fromRole: "teacher", to: "Rajesh Mehta", subject: "Re: Arjun's Progress in Mathematics", body: "Hello Mr. Mehta. Thank you for reaching out. Arjun is indeed performing very well overall. His calculative ability is strong. I suggest he practise more word problems from the NCERT exemplar. Please ensure he revises Chapter 5 over the weekend.", timestamp: "2026-07-25 3:42 PM", read: false, hasAttachment: false },
    ],
  },
  {
    id: "mt2",
    participantName: "Mr. Sanjay Pillai",
    participantRole: "Chemistry Teacher",
    subject: "Chemistry Lab Safety Guidelines",
    lastMessage: "The lab safety document is attached for your reference.",
    lastTimestamp: "2026-07-20 11:05 AM",
    unreadCount: 0,
    messages: [
      { id: "m3", threadId: "mt2", from: "Mr. Sanjay Pillai", fromRole: "teacher", to: "All Parents", subject: "Chemistry Lab Safety Guidelines", body: "Dear Parents, please find attached the updated lab safety guidelines for the upcoming practical sessions. Kindly go through them with your child.", timestamp: "2026-07-20 11:05 AM", read: true, hasAttachment: true, attachmentName: "Lab_Safety_Guidelines.pdf" },
    ],
  },
  {
    id: "mt3",
    participantName: "School Administration",
    participantRole: "Admin",
    subject: "Fee Reminder — July 2026",
    lastMessage: "Kindly clear the outstanding amount by 31st July.",
    lastTimestamp: "2026-07-15 9:00 AM",
    unreadCount: 0,
    messages: [
      { id: "m4", threadId: "mt3", from: "School Administration", fromRole: "admin", to: "Rajesh Mehta", subject: "Fee Reminder — July 2026", body: "Dear Parent, this is a gentle reminder that the tuition fee for July 2026 is due. Kindly clear the outstanding amount by 31st July to avoid any late fee. Contact the accounts department for assistance.", timestamp: "2026-07-15 9:00 AM", read: true, hasAttachment: false },
    ],
  },
];

// ── Notifications ─────────────────────────────────────────────────────────────

export const parentNotifications: Notification[] = [
  { id: "n1", type: "test", title: "Test Marks Uploaded", body: "Physics Weekly Quiz marks have been uploaded. Arjun scored 17/20.", timestamp: "2026-07-25 4:00 PM", read: false, childName: "Arjun Mehta" },
  { id: "n2", type: "homework", title: "Homework Assigned", body: "Mathematics homework due on 27th July has been assigned to Arjun.", timestamp: "2026-07-24 7:30 PM", read: false, childName: "Arjun Mehta" },
  { id: "n3", type: "announcement", title: "New Announcement", body: "PTM scheduled for 2nd August 2026. Please check the Announcements section.", timestamp: "2026-07-20 10:00 AM", read: true, childName: "Arjun Mehta" },
  { id: "n4", type: "attendance", title: "Attendance Marked", body: "Arjun's attendance has been marked Present for today, 26th July.", timestamp: "2026-07-26 8:15 AM", read: true, childName: "Arjun Mehta" },
  { id: "n5", type: "message", title: "New Message from Teacher", body: "Mrs. Preethi Sundaram has replied to your message.", timestamp: "2026-07-25 3:42 PM", read: false, childName: "Arjun Mehta" },
  { id: "n6", type: "homework", title: "Homework Assigned", body: "Science project due on 30th July has been assigned to Ananya.", timestamp: "2026-07-24 5:30 PM", read: true, childName: "Ananya Mehta" },
  { id: "n7", type: "attendance", title: "Attendance Marked", body: "Ananya's attendance has been marked Present for today, 26th July.", timestamp: "2026-07-26 8:20 AM", read: true, childName: "Ananya Mehta" },
  { id: "n8", type: "exam", title: "Examination Announced", body: "Half-Yearly Examination schedule has been published. Check the Examinations section.", timestamp: "2026-07-24 9:00 AM", read: false, childName: "Arjun Mehta" },
];

// ── Academic Insights (computed / static mock) ────────────────────────────────

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
}> = {
  c1: {
    overallPercentage: 82.5,
    classRank: 7,
    totalStudents: 42,
    subjectPerformance: [
      { subject: "Mathematics", score: 91.2, classAvg: 72.5, trend: "up" },
      { subject: "Physics", score: 85, classAvg: 71, trend: "stable" },
      { subject: "Chemistry", score: 73.3, classAvg: 70.4, trend: "up" },
      { subject: "English", score: 93.3, classAvg: 74.7, trend: "up" },
      { subject: "History", score: 60, classAvg: 65.2, trend: "down" },
      { subject: "Geography", score: 78, classAvg: 69, trend: "stable" },
    ],
    weakSubjects: ["History", "Chemistry"],
    strongSubjects: ["English", "Mathematics"],
    weekAreas: ["Source-based questions", "Balancing chemical equations", "Application problems in Physics"],
    homeworkCompletion: 78,
    classHomeworkAvg: 68,
    practiceConsistency: 72,
    learningStreak: 12,
    questionsAttempted: 847,
    attendanceVsClass: { mine: 91.3, classAvg: 88.5 },
    observations: "Arjun demonstrates strong analytical ability especially in Mathematics and English. He needs to allocate more time to History and focus on descriptive writing in answers. Consistent practice over the next 4 weeks will significantly improve his overall rank.",
  },
  c2: {
    overallPercentage: 90.4,
    classRank: 2,
    totalStudents: 38,
    subjectPerformance: [
      { subject: "Mathematics", score: 93.3, classAvg: 73.9, trend: "up" },
      { subject: "Science", score: 88, classAvg: 74, trend: "stable" },
      { subject: "English", score: 90, classAvg: 76.2, trend: "up" },
      { subject: "Social Studies", score: 85, classAvg: 70.1, trend: "stable" },
      { subject: "Hindi", score: 82, classAvg: 71, trend: "up" },
    ],
    weakSubjects: ["Hindi"],
    strongSubjects: ["Mathematics", "English"],
    weekAreas: ["Hindi grammar", "Social Studies map work"],
    homeworkCompletion: 95,
    classHomeworkAvg: 72,
    practiceConsistency: 90,
    learningStreak: 21,
    questionsAttempted: 524,
    attendanceVsClass: { mine: 94.7, classAvg: 87.2 },
    observations: "Ananya is an exceptional student with consistent performance across all subjects. She should focus on improving Hindi grammar and social studies map-based questions. Her homework completion rate is one of the highest in the class.",
  },
};

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
  name: "Rajesh Mehta",
  email: "rajesh.mehta@email.com",
  phone: "+91 98765 43210",
  occupation: "Software Engineer",
  address: "Flat 4B, Sunflower Apartments, Andheri West, Mumbai 400058",
  relationship: "Father",
  googleLinked: true,
  googleEmail: "rajesh.mehta@gmail.com",
  mobileLinked: true,
};
