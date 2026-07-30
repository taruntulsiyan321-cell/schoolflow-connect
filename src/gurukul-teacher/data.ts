// â”€â”€ Teacher Panel â€” Mock Data â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
  submissions: { studentId: string; studentName: string; submittedAt: string; status: "submitted" | "late" | "pending"; remarks?: string }[];
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
  submissions: { studentId: string; studentName: string; submittedAt: string; status: "submitted" | "graded" | "pending"; marks?: number; feedback?: string }[];
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
  studentMarks: { studentId: string; studentName: string; rollNumber: string; marks: number | null; percentage: number | null; grade: string | null; remarks: string; answerSheetUploaded: boolean }[];
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
  messages: { id: string; from: string; fromRole: string; body: string; timestamp: string; hasAttachment: boolean; attachmentName?: string }[];
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

// â”€â”€ Teacher Profile â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const teacherProfile: TeacherProfile = {
  id: "t1",
  name: "Mrs. Ananya Rajan",
  employeeId: "GKL/TCH/2021/042",
  email: "ananya.rajan@gurukul.edu.in",
  phone: "+91 98400 12345",
  department: "Science & Mathematics",
  subjects: ["Mathematics", "Physics"],
  qualification: "M.Sc. Mathematics, B.Ed.",
  joinedDate: "2021-06-15",
  address: "Flat 7A, Lotus Heights, Bandra West, Mumbai 400050",
  gender: "female",
  isClassTeacher: true,
  classTeacherOf: { className: "Class 10", section: "A" },
  googleLinked: true,
  googleEmail: "ananya.rajan@gmail.com",
  mobileLinked: true,
};

// â”€â”€ Assigned Classes â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** @deprecated Academic mocks removed â€” panels use Academic Engine. Kept empty for type-only imports. */
export const assignedClasses: ClassInfo[] = [];
export const studentsByClass: Record<string, Student[]> = {};
export const todayAttendance: Record<string, { submitted: boolean; approved: boolean; records: AttendanceRecord[] }> = {};
export const homeworkByClass: Record<string, HomeworkItem[]> = {};
export const assignmentsByClass: Record<string, Assignment[]> = {};
export const testsByClass: Record<string, Test[]> = {};

export const teacherDoubts: Doubt[] = [
  {
    id: "d1",
    studentId: "s1",
    studentName: "Arjun Mehta",
    className: "Class 10",
    section: "A",
    subject: "Mathematics",
    question: "I am confused about the discriminant. If D = 0, does that mean there is only one root or two equal roots? My book says two equal roots but my tutor says one root. Which is correct?",
    askedAt: "2026-07-25 4:30 PM",
    status: "open",
    hasAttachment: false,
    replies: [],
  },
  {
    id: "d2",
    studentId: "s3",
    studentName: "Rohan Verma",
    className: "Class 10",
    section: "A",
    subject: "Mathematics",
    question: "In Arithmetic Progressions, when the question says 'find the sum of first n terms', do we use Sn = n/2(2a + (n-1)d) or Sn = n/2(a + l)? When do we use which formula?",
    askedAt: "2026-07-24 7:15 PM",
    status: "resolved",
    hasAttachment: true,
    attachmentName: "AP_formula_sheet.jpg",
    replies: [
      { from: "teacher", text: "Great question, Rohan! Both formulas are correct â€” you use the first formula when you know 'a' and 'd', and the second formula when you know the first term 'a' and the last term 'l'. In most problems, you'll use the first formula since 'l' is not always given. Does that help?", timestamp: "2026-07-24 9:00 PM" },
      { from: "student", text: "Yes! That makes it very clear. Thank you, ma'am!", timestamp: "2026-07-24 9:15 PM" },
    ],
  },
  {
    id: "d3",
    studentId: "s5",
    studentName: "Karan Singh",
    className: "Class 10",
    section: "A",
    subject: "Mathematics",
    question: "I don't understand how to complete the square. The steps in my notebook are confusing. Can you explain with an example?",
    askedAt: "2026-07-23 6:45 PM",
    status: "open",
    hasAttachment: false,
    replies: [
      { from: "teacher", text: "Sure Karan! To complete the square for xÂ² + 6x + 5 = 0: First move the constant â†’ xÂ² + 6x = -5. Then add (6/2)Â² = 9 to both sides â†’ xÂ² + 6x + 9 = 4. Now factor â†’ (x+3)Â² = 4. Take square root â†’ x+3 = Â±2. So x = -1 or x = -5. Try this method with Exercise 4.3 Q1.", timestamp: "2026-07-23 8:30 PM" },
    ],
  },
  {
    id: "d4",
    studentId: "s12",
    studentName: "Lakshmi Iyer",
    className: "Class 9",
    section: "A",
    subject: "Physics",
    question: "Why does a feather fall slower than a stone if gravity acts on both equally? Is it because of the mass difference or air resistance?",
    askedAt: "2026-07-26 10:00 AM",
    status: "open",
    hasAttachment: false,
    replies: [],
  },
];

// â”€â”€ Messages â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const teacherMessages: TeacherMessage[] = [
  {
    id: "tm1",
    threadId: "tm1",
    participantName: "Rajesh Mehta",
    participantRole: "parent",
    subject: "Arjun's Progress in Mathematics",
    lastMessage: "Please ensure he revises Chapter 5 over the weekend.",
    lastTimestamp: "2026-07-25 3:42 PM",
    unreadCount: 0,
    messages: [
      { id: "m1", from: "Rajesh Mehta (Parent)", fromRole: "parent", body: "Good afternoon, Mrs. Rajan. I wanted to check on Arjun's maths performance. He struggles with word problems.", timestamp: "2026-07-23 10:12 AM", hasAttachment: false },
      { id: "m2", from: "Mrs. Ananya Rajan (You)", fromRole: "teacher", body: "Hello Mr. Mehta. Arjun is doing very well overall. His calculative ability is strong. I suggest he practises more word problems from the NCERT exemplar. Please ensure he revises Chapter 5 over the weekend.", timestamp: "2026-07-25 3:42 PM", hasAttachment: false },
    ],
  },
  {
    id: "tm2",
    threadId: "tm2",
    participantName: "Arjun Mehta",
    participantRole: "student",
    subject: "Doubt â€” Quadratic Equations",
    lastMessage: "Thank you ma'am! That explanation was really helpful.",
    lastTimestamp: "2026-07-24 5:00 PM",
    unreadCount: 1,
    messages: [
      { id: "m3", from: "Arjun Mehta (Student)", fromRole: "student", body: "Ma'am, can you explain the graphical method for solving quadratics? I'm confused about what the x-intercepts represent.", timestamp: "2026-07-24 3:00 PM", hasAttachment: false },
      { id: "m4", from: "Mrs. Ananya Rajan (You)", fromRole: "teacher", body: "The x-intercepts (where the parabola crosses the x-axis) represent the real roots of the quadratic equation. If the parabola doesn't touch the x-axis at all, the equation has no real roots (D < 0).", timestamp: "2026-07-24 4:45 PM", hasAttachment: false },
      { id: "m5", from: "Arjun Mehta (Student)", fromRole: "student", body: "Thank you ma'am! That explanation was really helpful.", timestamp: "2026-07-24 5:00 PM", hasAttachment: false },
    ],
  },
  {
    id: "tm3",
    threadId: "tm3",
    participantName: "Dr. Priya Krishnaswamy",
    participantRole: "principal",
    subject: "Class 10A Half-Yearly Readiness",
    lastMessage: "Please ensure 100% syllabus completion by August 15.",
    lastTimestamp: "2026-07-22 11:00 AM",
    unreadCount: 0,
    messages: [
      { id: "m6", from: "Dr. Priya Krishnaswamy (Principal)", fromRole: "principal", body: "Mrs. Rajan, please share the syllabus completion status for Class 10A Mathematics ahead of the Half-Yearly Exam. Please ensure 100% syllabus completion by August 15.", timestamp: "2026-07-22 11:00 AM", hasAttachment: false },
    ],
  },
];

// â”€â”€ Announcements â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const teacherAnnouncements: TeacherAnnouncement[] = [
  { id: "ta1", title: "Unit Test 3 Schedule Confirmed", body: "Unit Test 3 for Class 10A Mathematics will be held on 5th August 2026, 10:00â€“11:30 AM. Syllabus: Quadratic Equations and Arithmetic Progressions. Bring all required stationery.", targetClass: "Class 10", targetSection: "A", status: "published", publishedAt: "2026-07-24", hasAttachment: false, priority: "important" },
  { id: "ta2", title: "Homework Submission Reminder", body: "All pending homework from the Quadratic Equations chapter must be submitted by 27th July without fail. Late submissions will not be accepted after this date.", targetClass: "Class 10", targetSection: "A", status: "published", publishedAt: "2026-07-25", hasAttachment: false, priority: "normal" },
  { id: "ta3", title: "Statistics Project Guidelines", body: "Please refer to the attached document for detailed guidelines on the Statistics Data Collection project. Deadline: 30th July.", targetClass: "Class 10", targetSection: "A", status: "draft", hasAttachment: true, attachmentName: "Statistics_Project_Guidelines.pdf", priority: "normal" },
];

// â”€â”€ Leave Requests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const leaveRequests: LeaveRequest[] = [
  { id: "l1", leaveType: "casual", fromDate: "2026-08-15", toDate: "2026-08-15", days: 1, reason: "Independence Day family function", status: "approved", appliedAt: "2026-07-20", adminRemarks: "Approved. Enjoy the holiday." },
  { id: "l2", leaveType: "sick", fromDate: "2026-07-01", toDate: "2026-07-02", days: 2, reason: "High fever and doctor advised rest for 2 days", status: "approved", appliedAt: "2026-07-01", adminRemarks: "Approved. Get well soon." },
  { id: "l3", leaveType: "earned", fromDate: "2026-09-05", toDate: "2026-09-07", days: 3, reason: "Family travel during post-examination period", status: "pending", appliedAt: "2026-07-25" },
];
