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

export const children: Child[] = [
  {
    id: "c1",
    name: "Arjun Mehta",
    photo: null,
    className: "Class 10",
    section: "A",
    rollNumber: "10A-12",
    admissionNumber: "GKL/2019/0421",
    academicYear: "2026-27",
    school: "Gurukul International School",
    dob: "2011-03-14",
    gender: "male",
    bloodGroup: "B+",
    house: "Chandragupta",
    classTeacher: "Mrs. Preethi Sundaram",
  },
  {
    id: "c2",
    name: "Ananya Mehta",
    photo: null,
    className: "Class 7",
    section: "B",
    rollNumber: "7B-05",
    admissionNumber: "GKL/2022/0187",
    academicYear: "2026-27",
    school: "Gurukul International School",
    dob: "2014-09-28",
    gender: "female",
    bloodGroup: "O+",
    house: "Ashoka",
    classTeacher: "Mr. Ramesh Iyer",
  },
];

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

export const attendanceByChild: Record<string, AttendanceDayStatus[]> = {
  c1: buildAttendanceMonth(2026, 7),
  c2: buildAttendanceMonth(2026, 7),
};

// ── Homework ──────────────────────────────────────────────────────────────────

export const homeworkByChild: Record<string, HomeworkItem[]> = {
  c1: [
    { id: "h1", subject: "Mathematics", title: "Quadratic Equations Practice", description: "Complete exercises 5.1 and 5.2 from NCERT", dueDate: "2026-07-27", assignedDate: "2026-07-24", submissionStatus: "pending", teacherInstructions: "Show all working steps clearly", type: "homework" },
    { id: "h2", subject: "Physics", title: "Laws of Motion — Chapter Questions", description: "Answer all 12 questions at the end of Chapter 5", dueDate: "2026-07-28", assignedDate: "2026-07-25", submissionStatus: "pending", teacherInstructions: "Draw diagrams where applicable", type: "homework" },
    { id: "h3", subject: "English", title: "Essay: Environmental Awareness", description: "Write a 500-word essay on environmental conservation", dueDate: "2026-07-29", assignedDate: "2026-07-23", submissionStatus: "submitted", teacherInstructions: "Use formal tone, no bullet points", type: "assignment" },
    { id: "h4", subject: "Chemistry", title: "Periodic Table Memory Test Prep", description: "Memorise groups 1–18, periods 1–4", dueDate: "2026-07-26", assignedDate: "2026-07-20", submissionStatus: "graded", teacherInstructions: "Be prepared for an oral quiz", type: "homework", marks: 18, totalMarks: 20 },
    { id: "h5", subject: "History", title: "Rise of Nationalism in Europe", description: "Read Chapter 1 and prepare notes", dueDate: "2026-07-25", assignedDate: "2026-07-21", submissionStatus: "late", teacherInstructions: "One-page summary required", type: "homework" },
  ],
  c2: [
    { id: "h6", subject: "Mathematics", title: "Fractions & Decimals", description: "Complete worksheet 3A", dueDate: "2026-07-27", assignedDate: "2026-07-25", submissionStatus: "pending", teacherInstructions: "Show all working steps", type: "homework" },
    { id: "h7", subject: "Science", title: "Food & Nutrition Project", description: "Make a chart showing food groups", dueDate: "2026-07-30", assignedDate: "2026-07-24", submissionStatus: "pending", teacherInstructions: "Use coloured chart paper", type: "assignment" },
    { id: "h8", subject: "English", title: "Creative Writing — My Favourite Festival", description: "Write 200 words", dueDate: "2026-07-26", assignedDate: "2026-07-22", submissionStatus: "submitted", teacherInstructions: "Use vivid descriptions", type: "homework" },
  ],
};

// ── Test Results ──────────────────────────────────────────────────────────────

export const testResultsByChild: Record<string, TestResult[]> = {
  c1: [
    { id: "t1", testName: "Unit Test 2", subject: "Mathematics", teacher: "Mr. Arun Kumar", testDate: "2026-07-10", marksObtained: 38, totalMarks: 40, percentage: 95, grade: "A+", teacherRemarks: "Excellent command over quadratic equations. Keep it up!", hasAnswerSheet: true, classAverage: 29.5, classRank: 2, totalStudents: 42 },
    { id: "t2", testName: "Weekly Quiz", subject: "Physics", teacher: "Mrs. Deepa Nair", testDate: "2026-07-15", marksObtained: 17, totalMarks: 20, percentage: 85, grade: "A", teacherRemarks: "Good understanding of Newton's laws. Review motion graphs.", hasAnswerSheet: false, classAverage: 14.2, classRank: 5, totalStudents: 42 },
    { id: "t3", testName: "Unit Test 2", subject: "Chemistry", teacher: "Mr. Sanjay Pillai", testDate: "2026-07-12", marksObtained: 22, totalMarks: 30, percentage: 73.3, grade: "B+", teacherRemarks: "Good effort. Work on balancing equations.", hasAnswerSheet: true, classAverage: 21.1, classRank: 14, totalStudents: 42 },
    { id: "t4", testName: "Reading Comprehension", subject: "English", teacher: "Ms. Kavitha Rao", testDate: "2026-07-08", marksObtained: 28, totalMarks: 30, percentage: 93.3, grade: "A+", teacherRemarks: "Outstanding vocabulary and comprehension skills.", hasAnswerSheet: false, classAverage: 22.4, classRank: 3, totalStudents: 42 },
    { id: "t5", testName: "Chapter Test", subject: "History", teacher: "Mr. Vikram Singh", testDate: "2026-07-05", marksObtained: 15, totalMarks: 25, percentage: 60, grade: "C+", teacherRemarks: "Needs to study source-based questions more carefully.", hasAnswerSheet: false, classAverage: 16.3, classRank: 22, totalStudents: 42 },
    { id: "t6", testName: "Unit Test 1", subject: "Mathematics", teacher: "Mr. Arun Kumar", testDate: "2026-06-15", marksObtained: 35, totalMarks: 40, percentage: 87.5, grade: "A", teacherRemarks: "Very good. Improve on application-based problems.", hasAnswerSheet: true, classAverage: 28.2, classRank: 4, totalStudents: 42 },
  ],
  c2: [
    { id: "t7", testName: "Unit Test 2", subject: "Mathematics", teacher: "Mr. Ravi Shankar", testDate: "2026-07-12", marksObtained: 28, totalMarks: 30, percentage: 93.3, grade: "A+", teacherRemarks: "Excellent! Perfect in fractions.", hasAnswerSheet: false, classAverage: 22.1, classRank: 1, totalStudents: 38 },
    { id: "t8", testName: "Class Test", subject: "Science", teacher: "Mrs. Lalitha Kumar", testDate: "2026-07-14", marksObtained: 22, totalMarks: 25, percentage: 88, grade: "A", teacherRemarks: "Good understanding of plants and food.", hasAnswerSheet: false, classAverage: 18.5, classRank: 3, totalStudents: 38 },
  ],
};

// ── Examinations ──────────────────────────────────────────────────────────────

export const examinationsByChild: Record<string, Examination[]> = {
  c1: [
    {
      id: "e1",
      name: "Half Yearly Examination",
      type: "Mid Term",
      startDate: "2026-09-01",
      endDate: "2026-09-14",
      instructions: "Bring your hall ticket, pens, pencil, and geometry box. Mobile phones are strictly prohibited.",
      resultPublished: false,
      schedule: [
        { subject: "Mathematics", date: "2026-09-01", time: "09:00 AM", duration: "3 hrs", maxMarks: 80 },
        { subject: "Science", date: "2026-09-03", time: "09:00 AM", duration: "3 hrs", maxMarks: 80 },
        { subject: "English", date: "2026-09-05", time: "09:00 AM", duration: "3 hrs", maxMarks: 80 },
        { subject: "History", date: "2026-09-08", time: "09:00 AM", duration: "3 hrs", maxMarks: 80 },
        { subject: "Geography", date: "2026-09-10", time: "09:00 AM", duration: "3 hrs", maxMarks: 80 },
        { subject: "Hindi", date: "2026-09-12", time: "09:00 AM", duration: "3 hrs", maxMarks: 80 },
      ],
    },
    {
      id: "e2",
      name: "Unit Test 3",
      type: "Unit Test",
      startDate: "2026-08-05",
      endDate: "2026-08-10",
      instructions: "Syllabus covers chapters taught between July 15 – August 1.",
      resultPublished: false,
      schedule: [
        { subject: "Mathematics", date: "2026-08-05", time: "10:00 AM", duration: "1.5 hrs", maxMarks: 40 },
        { subject: "Physics", date: "2026-08-06", time: "10:00 AM", duration: "1.5 hrs", maxMarks: 40 },
        { subject: "Chemistry", date: "2026-08-07", time: "10:00 AM", duration: "1.5 hrs", maxMarks: 40 },
        { subject: "English", date: "2026-08-08", time: "10:00 AM", duration: "1.5 hrs", maxMarks: 40 },
        { subject: "History", date: "2026-08-10", time: "10:00 AM", duration: "1.5 hrs", maxMarks: 40 },
      ],
    },
    {
      id: "e3",
      name: "Unit Test 2",
      type: "Unit Test",
      startDate: "2026-07-01",
      endDate: "2026-07-08",
      instructions: "Open book exam. Notes allowed.",
      resultPublished: true,
      schedule: [],
      results: [
        { subject: "Mathematics", marksObtained: 38, totalMarks: 40, grade: "A+" },
        { subject: "Physics", marksObtained: 32, totalMarks: 40, grade: "A" },
        { subject: "Chemistry", marksObtained: 28, totalMarks: 40, grade: "B+" },
        { subject: "English", marksObtained: 36, totalMarks: 40, grade: "A+" },
        { subject: "History", marksObtained: 26, totalMarks: 40, grade: "B" },
      ],
    },
  ],
  c2: [
    {
      id: "e4",
      name: "Half Yearly Examination",
      type: "Mid Term",
      startDate: "2026-09-02",
      endDate: "2026-09-12",
      instructions: "Students must wear the prescribed school uniform. Bring hall ticket every day.",
      resultPublished: false,
      schedule: [
        { subject: "Mathematics", date: "2026-09-02", time: "09:30 AM", duration: "2.5 hrs", maxMarks: 80 },
        { subject: "Science", date: "2026-09-04", time: "09:30 AM", duration: "2.5 hrs", maxMarks: 80 },
        { subject: "English", date: "2026-09-06", time: "09:30 AM", duration: "2.5 hrs", maxMarks: 80 },
        { subject: "Social Studies", date: "2026-09-09", time: "09:30 AM", duration: "2.5 hrs", maxMarks: 80 },
        { subject: "Hindi", date: "2026-09-11", time: "09:30 AM", duration: "2.5 hrs", maxMarks: 80 },
      ],
    },
  ],
};

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

export const richInsightsByChild: Record<string, RichInsights> = {
  c1: {
    overallPercentage: 82.5,
    overallGrade: "A",
    previousOverallPercentage: 74.8,
    classRank: 7,
    totalStudents: 42,
    subjectPerformance: [
      { subject: "Mathematics", score: 91.2, classAvg: 72.5, previousScore: 79.5, trend: "up" },
      { subject: "Physics", score: 85, classAvg: 71, previousScore: 83.5, trend: "stable" },
      { subject: "Chemistry", score: 73.3, classAvg: 70.4, previousScore: 67.2, trend: "up" },
      { subject: "English", score: 93.3, classAvg: 74.7, previousScore: 88.0, trend: "up" },
      { subject: "History", score: 60, classAvg: 65.2, previousScore: 66.4, trend: "down" },
      { subject: "Geography", score: 78, classAvg: 69, previousScore: 76.5, trend: "stable" },
    ],
    weakSubjects: ["History", "Chemistry"],
    strongSubjects: ["English", "Mathematics"],
    weakChapters: ["Nationalism in Europe (History)", "Chemical Reactions & Equations (Chemistry)", "Acids, Bases and Salts (Chemistry)"],
    weakTopics: ["Source-based questions", "Balancing chemical equations", "Ionic equations", "Application problems in motion"],
    strongChapters: ["Quadratic Equations (Maths)", "Polynomials (Maths)", "Reading Comprehension (English)"],
    strongTopics: ["Algebraic manipulation", "Vocabulary & comprehension", "Newton's laws", "Coordinate geometry"],
    frequentlyMistaken: ["Source-based historical analysis", "Balancing redox equations", "Force diagram interpretation", "Long-form essay structure"],
    improvingAreas: ["Mathematics overall", "Chemistry (basic reactions)", "English writing"],
    urgentAttentionAreas: ["History source questions", "Chemical equation balancing"],
    questionsToday: 23,
    questionsThisWeek: 142,
    questionsThisMonth: 498,
    questionsTotal: 847,
    practiceSessionsTotal: 64,
    practiceConsistency: 72,
    learningStreak: 12,
    homeworkAssigned: 18,
    homeworkCompleted: 14,
    assignmentsTotal: 6,
    assignmentsSubmitted: 5,
    homeworkCompletion: 78,
    classHomeworkAvg: 68,
    attendancePct: 91.3,
    presentDays: 21,
    absentDays: 2,
    lateAttendanceDays: 1,
    previousMonthAttendancePct: 86.4,
    attendanceVsClass: { mine: 91.3, classAvg: 88.5 },
    teacherFeedback: [
      {
        teacher: "Mrs. Preethi Sundaram",
        subject: "Class Teacher",
        date: "2026-07-22",
        remarks: "Arjun is a focused and disciplined student. His performance in core science subjects is commendable.",
        observations: "He tends to rush through descriptive answers in humanities. He needs to practise structured essay writing. His participation in class discussions has improved noticeably this term.",
        suggestions: "Allocate at least 30 minutes daily to History reading. Focus on framing answers with introduction, body, and conclusion structure. Consider revising Chemistry equations every alternate day.",
      },
      {
        teacher: "Mr. Arun Kumar",
        subject: "Mathematics",
        date: "2026-07-18",
        remarks: "Excellent performance in algebra and coordinate geometry. Unit Test 2 result is outstanding.",
        observations: "Application-based word problems still present some challenge. He solves the mathematical steps correctly but sometimes misinterprets the problem statement.",
        suggestions: "Practise 5 word problems from NCERT Exemplar daily. Revisit previous year board question papers for application problems.",
      },
      {
        teacher: "Mr. Vikram Singh",
        subject: "History",
        date: "2026-07-15",
        remarks: "Performance in factual recall is adequate but source-based analysis needs significant improvement.",
        observations: "Arjun demonstrates understanding of historical events but struggles to analyse primary sources critically. His written answers lack specific dates and events.",
        suggestions: "Practise at least 3 source-based questions daily. Read the NCERT chapter notes carefully and highlight key dates. Attempt previous year board questions for this chapter.",
      },
    ],
  },
  c2: {
    overallPercentage: 90.4,
    overallGrade: "A+",
    previousOverallPercentage: 87.1,
    classRank: 2,
    totalStudents: 38,
    subjectPerformance: [
      { subject: "Mathematics", score: 93.3, classAvg: 73.9, previousScore: 88.5, trend: "up" },
      { subject: "Science", score: 88, classAvg: 74, previousScore: 88.4, trend: "stable" },
      { subject: "English", score: 90, classAvg: 76.2, previousScore: 85.0, trend: "up" },
      { subject: "Social Studies", score: 85, classAvg: 70.1, previousScore: 82.0, trend: "stable" },
      { subject: "Hindi", score: 82, classAvg: 71, previousScore: 79.5, trend: "up" },
    ],
    weakSubjects: ["Hindi"],
    strongSubjects: ["Mathematics", "English"],
    weakChapters: ["Hindi Vyakaran (Grammar)", "Map Work — Asia (Social Studies)"],
    weakTopics: ["Sandhi Viched", "Map labelling", "Formal letter writing in Hindi"],
    strongChapters: ["Fractions and Decimals (Maths)", "Nutrition in Plants (Science)", "Reading & Writing (English)"],
    strongTopics: ["Fraction operations", "Decimal arithmetic", "Comprehension passages", "Plant biology"],
    frequentlyMistaken: ["Hindi grammar rules", "Map-based questions", "Formal Hindi letter format"],
    improvingAreas: ["Mathematics (number operations)", "English (creative writing)", "Hindi (basic grammar)"],
    urgentAttentionAreas: ["Hindi Vyakaran", "Social Studies map work"],
    questionsToday: 18,
    questionsThisWeek: 96,
    questionsThisMonth: 312,
    questionsTotal: 524,
    practiceSessionsTotal: 48,
    practiceConsistency: 90,
    learningStreak: 21,
    homeworkAssigned: 12,
    homeworkCompleted: 11,
    assignmentsTotal: 4,
    assignmentsSubmitted: 4,
    homeworkCompletion: 95,
    classHomeworkAvg: 72,
    attendancePct: 94.7,
    presentDays: 23,
    absentDays: 0,
    lateAttendanceDays: 1,
    previousMonthAttendancePct: 91.3,
    attendanceVsClass: { mine: 94.7, classAvg: 87.2 },
    teacherFeedback: [
      {
        teacher: "Mr. Ramesh Iyer",
        subject: "Class Teacher",
        date: "2026-07-23",
        remarks: "Ananya is one of the most consistent and dedicated students in the class. Her attitude toward learning is exemplary.",
        observations: "She actively participates in all class activities and helps her peers. Her only area requiring attention is Hindi grammar, specifically Sandhi and Samas.",
        suggestions: "Dedicate 15–20 minutes daily to Hindi grammar exercises. Use the school's supplementary grammar workbook for practice.",
      },
      {
        teacher: "Mr. Ravi Shankar",
        subject: "Mathematics",
        date: "2026-07-20",
        remarks: "Ananya has demonstrated exceptional understanding of fractions and decimals. She topped the class in Unit Test 2.",
        observations: "Her speed and accuracy in arithmetic are well above average. She is ready for advanced problem types.",
        suggestions: "Begin working on NCERT Class 8 preview problems to stay ahead. Explore mental math techniques to further improve speed.",
      },
    ],
  },
};

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
