// ── Teacher Panel — Mock Data ─────────────────────────────────────────────────

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

// ── Teacher Profile ───────────────────────────────────────────────────────────

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

// ── Assigned Classes ──────────────────────────────────────────────────────────

export const assignedClasses: ClassInfo[] = [
  { id: "c10a", className: "Class 10", section: "A", subject: "Mathematics", isClassTeacher: true, studentCount: 42, schedule: [{ day: "Monday", time: "08:00–08:45" }, { day: "Wednesday", time: "10:00–10:45" }, { day: "Friday", time: "09:00–09:45" }] },
  { id: "c10b", className: "Class 10", section: "B", subject: "Mathematics", isClassTeacher: false, studentCount: 40, schedule: [{ day: "Tuesday", time: "09:00–09:45" }, { day: "Thursday", time: "08:00–08:45" }] },
  { id: "c9a", className: "Class 9", section: "A", subject: "Physics", isClassTeacher: false, studentCount: 45, schedule: [{ day: "Monday", time: "11:00–11:45" }, { day: "Friday", time: "11:00–11:45" }] },
];

// ── Students ──────────────────────────────────────────────────────────────────

export const studentsByClass: Record<string, Student[]> = {
  c10a: [
    { id: "s1", name: "Arjun Mehta", rollNumber: "10A-01", admissionNumber: "GKL/2019/0421", gender: "male", parentName: "Rajesh Mehta", parentPhone: "+91 98765 43210", attendancePct: 91, performanceScore: 88, status: "active" },
    { id: "s2", name: "Priya Sharma", rollNumber: "10A-02", admissionNumber: "GKL/2019/0422", gender: "female", parentName: "Suresh Sharma", parentPhone: "+91 98765 43211", attendancePct: 96, performanceScore: 93, status: "active" },
    { id: "s3", name: "Rohan Verma", rollNumber: "10A-03", admissionNumber: "GKL/2019/0423", gender: "male", parentName: "Anil Verma", parentPhone: "+91 98765 43212", attendancePct: 78, performanceScore: 65, status: "active" },
    { id: "s4", name: "Sneha Pillai", rollNumber: "10A-04", admissionNumber: "GKL/2019/0424", gender: "female", parentName: "Ravi Pillai", parentPhone: "+91 98765 43213", attendancePct: 88, performanceScore: 79, status: "active" },
    { id: "s5", name: "Karan Singh", rollNumber: "10A-05", admissionNumber: "GKL/2019/0425", gender: "male", parentName: "Gurpreet Singh", parentPhone: "+91 98765 43214", attendancePct: 72, performanceScore: 58, status: "active" },
    { id: "s6", name: "Meera Nair", rollNumber: "10A-06", admissionNumber: "GKL/2019/0426", gender: "female", parentName: "Sunil Nair", parentPhone: "+91 98765 43215", attendancePct: 94, performanceScore: 91, status: "active" },
    { id: "s7", name: "Vijay Kumar", rollNumber: "10A-07", admissionNumber: "GKL/2019/0427", gender: "male", parentName: "Ramesh Kumar", parentPhone: "+91 98765 43216", attendancePct: 85, performanceScore: 74, status: "active" },
    { id: "s8", name: "Anita Desai", rollNumber: "10A-08", admissionNumber: "GKL/2019/0428", gender: "female", parentName: "Mahesh Desai", parentPhone: "+91 98765 43217", attendancePct: 99, performanceScore: 97, status: "active" },
  ],
  c10b: [
    { id: "s9", name: "Riya Patel", rollNumber: "10B-01", admissionNumber: "GKL/2019/0451", gender: "female", parentName: "Dinesh Patel", parentPhone: "+91 98765 43230", attendancePct: 90, performanceScore: 82, status: "active" },
    { id: "s10", name: "Aman Gupta", rollNumber: "10B-02", admissionNumber: "GKL/2019/0452", gender: "male", parentName: "Sandeep Gupta", parentPhone: "+91 98765 43231", attendancePct: 83, performanceScore: 71, status: "active" },
    { id: "s11", name: "Divya Rao", rollNumber: "10B-03", admissionNumber: "GKL/2019/0453", gender: "female", parentName: "Prasad Rao", parentPhone: "+91 98765 43232", attendancePct: 95, performanceScore: 89, status: "active" },
  ],
  c9a: [
    { id: "s12", name: "Lakshmi Iyer", rollNumber: "9A-01", admissionNumber: "GKL/2020/0301", gender: "female", parentName: "Venkat Iyer", parentPhone: "+91 98765 43250", attendancePct: 92, performanceScore: 86, status: "active" },
    { id: "s13", name: "Harsh Jain", rollNumber: "9A-02", admissionNumber: "GKL/2020/0302", gender: "male", parentName: "Piyush Jain", parentPhone: "+91 98765 43251", attendancePct: 76, performanceScore: 61, status: "active" },
    { id: "s14", name: "Pooja Mishra", rollNumber: "9A-03", admissionNumber: "GKL/2020/0303", gender: "female", parentName: "Rajendra Mishra", parentPhone: "+91 98765 43252", attendancePct: 89, performanceScore: 80, status: "active" },
  ],
};

// ── Today's Attendance ────────────────────────────────────────────────────────

export const todayAttendance: Record<string, { submitted: boolean; approved: boolean; records: AttendanceRecord[] }> = {
  c10a: {
    submitted: false,
    approved: false,
    records: (studentsByClass.c10a ?? []).map((s) => ({
      studentId: s.id,
      studentName: s.name,
      rollNumber: s.rollNumber,
      status: "present" as const,
    })),
  },
  c10b: {
    submitted: true,
    approved: true,
    records: (studentsByClass.c10b ?? []).map((s, i) => ({
      studentId: s.id,
      studentName: s.name,
      rollNumber: s.rollNumber,
      status: (i === 1 ? "absent" : "present") as AttendanceRecord["status"],
    })),
  },
  c9a: {
    submitted: true,
    approved: false,
    records: (studentsByClass.c9a ?? []).map((s, i) => ({
      studentId: s.id,
      studentName: s.name,
      rollNumber: s.rollNumber,
      status: (i === 1 ? "late" : "present") as AttendanceRecord["status"],
    })),
  },
};

// ── Homework ──────────────────────────────────────────────────────────────────

export const homeworkByClass: Record<string, HomeworkItem[]> = {
  c10a: [
    {
      id: "hw1",
      classId: "c10a",
      subject: "Mathematics",
      title: "Quadratic Equations Practice",
      description: "Complete exercises 5.1 and 5.2 from NCERT",
      instructions: "Show all working steps. Neat presentation required.",
      assignedDate: "2026-07-24",
      dueDate: "2026-07-27",
      totalStudents: 8,
      submitted: 5,
      pending: 3,
      status: "active",
      submissions: [
        { studentId: "s1", studentName: "Arjun Mehta", submittedAt: "2026-07-25", status: "submitted" },
        { studentId: "s2", studentName: "Priya Sharma", submittedAt: "2026-07-24", status: "submitted" },
        { studentId: "s6", studentName: "Meera Nair", submittedAt: "2026-07-25", status: "submitted", remarks: "Excellent work" },
        { studentId: "s7", studentName: "Vijay Kumar", submittedAt: "2026-07-26", status: "submitted" },
        { studentId: "s8", studentName: "Anita Desai", submittedAt: "2026-07-24", status: "submitted", remarks: "Outstanding" },
        { studentId: "s3", studentName: "Rohan Verma", submittedAt: "", status: "pending" },
        { studentId: "s4", studentName: "Sneha Pillai", submittedAt: "", status: "pending" },
        { studentId: "s5", studentName: "Karan Singh", submittedAt: "", status: "pending" },
      ],
    },
    {
      id: "hw2",
      classId: "c10a",
      subject: "Mathematics",
      title: "Polynomials — Revision Sheet",
      description: "Complete the revision worksheet distributed in class",
      instructions: "All 20 questions must be attempted.",
      assignedDate: "2026-07-20",
      dueDate: "2026-07-23",
      totalStudents: 8,
      submitted: 7,
      pending: 1,
      status: "closed",
      submissions: [
        { studentId: "s1", studentName: "Arjun Mehta", submittedAt: "2026-07-22", status: "submitted" },
        { studentId: "s2", studentName: "Priya Sharma", submittedAt: "2026-07-21", status: "submitted" },
        { studentId: "s3", studentName: "Rohan Verma", submittedAt: "2026-07-23", status: "late" },
        { studentId: "s4", studentName: "Sneha Pillai", submittedAt: "2026-07-22", status: "submitted" },
        { studentId: "s5", studentName: "Karan Singh", submittedAt: "", status: "pending" },
        { studentId: "s6", studentName: "Meera Nair", submittedAt: "2026-07-21", status: "submitted" },
        { studentId: "s7", studentName: "Vijay Kumar", submittedAt: "2026-07-22", status: "submitted" },
        { studentId: "s8", studentName: "Anita Desai", submittedAt: "2026-07-21", status: "submitted" },
      ],
    },
  ],
};

// ── Assignments ───────────────────────────────────────────────────────────────

export const assignmentsByClass: Record<string, Assignment[]> = {
  c10a: [
    {
      id: "asgn1",
      classId: "c10a",
      subject: "Mathematics",
      title: "Statistics Project — Data Collection",
      description: "Collect data on any real-world topic, tabulate it, and compute mean, median, mode.",
      dueDate: "2026-07-30",
      maxMarks: 20,
      assignedDate: "2026-07-20",
      totalStudents: 8,
      submitted: 4,
      graded: 2,
      status: "active",
      submissions: [
        { studentId: "s2", studentName: "Priya Sharma", submittedAt: "2026-07-24", status: "graded", marks: 18, feedback: "Excellent data selection and accurate calculations." },
        { studentId: "s8", studentName: "Anita Desai", submittedAt: "2026-07-23", status: "graded", marks: 19, feedback: "Outstanding work. Well-presented and analytically strong." },
        { studentId: "s1", studentName: "Arjun Mehta", submittedAt: "2026-07-25", status: "submitted" },
        { studentId: "s6", studentName: "Meera Nair", submittedAt: "2026-07-25", status: "submitted" },
        { studentId: "s3", studentName: "Rohan Verma", submittedAt: "", status: "pending" },
        { studentId: "s4", studentName: "Sneha Pillai", submittedAt: "", status: "pending" },
        { studentId: "s5", studentName: "Karan Singh", submittedAt: "", status: "pending" },
        { studentId: "s7", studentName: "Vijay Kumar", submittedAt: "", status: "pending" },
      ],
    },
  ],
};

// ── Tests ─────────────────────────────────────────────────────────────────────

export const testsByClass: Record<string, Test[]> = {
  c10a: [
    {
      id: "test1",
      classId: "c10a",
      className: "Class 10",
      section: "A",
      subject: "Mathematics",
      testName: "Unit Test 3",
      testDate: "2026-08-05",
      startTime: "10:00",
      endTime: "11:30",
      duration: "90 mins",
      totalQuestions: 25,
      totalMarks: 40,
      chapters: ["Quadratic Equations", "Arithmetic Progressions"],
      topics: ["Nature of roots", "Sum of AP", "General term"],
      instructions: "Attempt all questions. Show all working steps. Calculator not permitted.",
      status: "scheduled",
      marksPublished: false,
      studentMarks: (studentsByClass.c10a ?? []).map((s) => ({ studentId: s.id, studentName: s.name, rollNumber: s.rollNumber, marks: null, percentage: null, grade: null, remarks: "", answerSheetUploaded: false })),
    },
    {
      id: "test2",
      classId: "c10a",
      className: "Class 10",
      section: "A",
      subject: "Mathematics",
      testName: "Unit Test 2",
      testDate: "2026-07-10",
      startTime: "10:00",
      endTime: "11:30",
      duration: "90 mins",
      totalQuestions: 20,
      totalMarks: 40,
      chapters: ["Polynomials", "Pair of Linear Equations"],
      topics: ["Zeroes of polynomial", "Graphical method", "Substitution method"],
      instructions: "Attempt all questions.",
      status: "marks_published",
      marksPublished: true,
      studentMarks: [
        { studentId: "s1", studentName: "Arjun Mehta", rollNumber: "10A-01", marks: 38, percentage: 95, grade: "A+", remarks: "Excellent command over quadratic equations.", answerSheetUploaded: true },
        { studentId: "s2", studentName: "Priya Sharma", rollNumber: "10A-02", marks: 39, percentage: 97.5, grade: "A+", remarks: "Outstanding. Perfect in all sections.", answerSheetUploaded: false },
        { studentId: "s3", studentName: "Rohan Verma", rollNumber: "10A-03", marks: 24, percentage: 60, grade: "C+", remarks: "Work on simultaneous equations. Needs more practice.", answerSheetUploaded: false },
        { studentId: "s4", studentName: "Sneha Pillai", rollNumber: "10A-04", marks: 31, percentage: 77.5, grade: "B+", remarks: "Good effort. Some calculation errors.", answerSheetUploaded: false },
        { studentId: "s5", studentName: "Karan Singh", rollNumber: "10A-05", marks: 21, percentage: 52.5, grade: "C", remarks: "Needs significant improvement. Please revise all chapters.", answerSheetUploaded: false },
        { studentId: "s6", studentName: "Meera Nair", rollNumber: "10A-06", marks: 37, percentage: 92.5, grade: "A+", remarks: "Very strong performance.", answerSheetUploaded: false },
        { studentId: "s7", studentName: "Vijay Kumar", rollNumber: "10A-07", marks: 29, percentage: 72.5, grade: "B", remarks: "Decent performance. Focus on application problems.", answerSheetUploaded: false },
        { studentId: "s8", studentName: "Anita Desai", rollNumber: "10A-08", marks: 40, percentage: 100, grade: "A+", remarks: "Perfect score. Exceptional work!", answerSheetUploaded: true },
      ],
    },
  ],
};

// ── Doubts ────────────────────────────────────────────────────────────────────

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
      { from: "teacher", text: "Great question, Rohan! Both formulas are correct — you use the first formula when you know 'a' and 'd', and the second formula when you know the first term 'a' and the last term 'l'. In most problems, you'll use the first formula since 'l' is not always given. Does that help?", timestamp: "2026-07-24 9:00 PM" },
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
      { from: "teacher", text: "Sure Karan! To complete the square for x² + 6x + 5 = 0: First move the constant → x² + 6x = -5. Then add (6/2)² = 9 to both sides → x² + 6x + 9 = 4. Now factor → (x+3)² = 4. Take square root → x+3 = ±2. So x = -1 or x = -5. Try this method with Exercise 4.3 Q1.", timestamp: "2026-07-23 8:30 PM" },
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

// ── Messages ──────────────────────────────────────────────────────────────────

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
    subject: "Doubt — Quadratic Equations",
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

// ── Announcements ─────────────────────────────────────────────────────────────

export const teacherAnnouncements: TeacherAnnouncement[] = [
  { id: "ta1", title: "Unit Test 3 Schedule Confirmed", body: "Unit Test 3 for Class 10A Mathematics will be held on 5th August 2026, 10:00–11:30 AM. Syllabus: Quadratic Equations and Arithmetic Progressions. Bring all required stationery.", targetClass: "Class 10", targetSection: "A", status: "published", publishedAt: "2026-07-24", hasAttachment: false, priority: "important" },
  { id: "ta2", title: "Homework Submission Reminder", body: "All pending homework from the Quadratic Equations chapter must be submitted by 27th July without fail. Late submissions will not be accepted after this date.", targetClass: "Class 10", targetSection: "A", status: "published", publishedAt: "2026-07-25", hasAttachment: false, priority: "normal" },
  { id: "ta3", title: "Statistics Project Guidelines", body: "Please refer to the attached document for detailed guidelines on the Statistics Data Collection project. Deadline: 30th July.", targetClass: "Class 10", targetSection: "A", status: "draft", hasAttachment: true, attachmentName: "Statistics_Project_Guidelines.pdf", priority: "normal" },
];

// ── Leave Requests ────────────────────────────────────────────────────────────

export const leaveRequests: LeaveRequest[] = [
  { id: "l1", leaveType: "casual", fromDate: "2026-08-15", toDate: "2026-08-15", days: 1, reason: "Independence Day family function", status: "approved", appliedAt: "2026-07-20", adminRemarks: "Approved. Enjoy the holiday." },
  { id: "l2", leaveType: "sick", fromDate: "2026-07-01", toDate: "2026-07-02", days: 2, reason: "High fever and doctor advised rest for 2 days", status: "approved", appliedAt: "2026-07-01", adminRemarks: "Approved. Get well soon." },
  { id: "l3", leaveType: "earned", fromDate: "2026-09-05", toDate: "2026-09-07", days: 3, reason: "Family travel during post-examination period", status: "pending", appliedAt: "2026-07-25" },
];
