// ── Admin Panel Mock Data ──────────────────────────────────────────────────────

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

export const adminStudents: AdminStudent[] = [
  { id: "s001", admissionNumber: "GRK2024001", rollNumber: "01", firstName: "Arjun", lastName: "Sharma", fullName: "Arjun Sharma", email: "arjun.sharma@student.gurukul.in", phone: "+91 98765 43210", gender: "male", dob: "2007-03-15", className: "12th", section: "A", status: "active", address: "42, Andheri West, Mumbai - 400053", parentName: "Rajesh Sharma", parentPhone: "+91 98765 11111", parentEmail: "rajesh.sharma@gmail.com", joinedDate: "2021-06-01", attendance: 92, performanceScore: 88, lastActive: "2 hours ago" },
  { id: "s002", admissionNumber: "GRK2024002", rollNumber: "02", firstName: "Priya", lastName: "Patel", fullName: "Priya Patel", email: "priya.patel@student.gurukul.in", phone: "+91 98765 43211", gender: "female", dob: "2007-07-22", className: "12th", section: "A", status: "active", address: "15, Bandra East, Mumbai - 400051", parentName: "Suresh Patel", parentPhone: "+91 98765 22222", parentEmail: "suresh.patel@gmail.com", joinedDate: "2021-06-01", attendance: 96, performanceScore: 94, lastActive: "30 min ago" },
  { id: "s003", admissionNumber: "GRK2024003", rollNumber: "03", firstName: "Rahul", lastName: "Kumar", fullName: "Rahul Kumar", email: "rahul.kumar@student.gurukul.in", phone: "+91 98765 43212", gender: "male", dob: "2007-11-08", className: "12th", section: "B", status: "active", address: "8, Powai, Mumbai - 400076", parentName: "Anil Kumar", parentPhone: "+91 98765 33333", parentEmail: "anil.kumar@gmail.com", joinedDate: "2022-06-01", attendance: 78, performanceScore: 72, lastActive: "1 day ago" },
  { id: "s004", admissionNumber: "GRK2024004", rollNumber: "04", firstName: "Sneha", lastName: "Nair", fullName: "Sneha Nair", email: "sneha.nair@student.gurukul.in", phone: "+91 98765 43213", gender: "female", dob: "2008-01-30", className: "11th", section: "A", status: "active", address: "22, Thane West, Thane - 400601", parentName: "Gopinath Nair", parentPhone: "+91 98765 44444", parentEmail: "gopinath.nair@gmail.com", joinedDate: "2022-06-01", attendance: 88, performanceScore: 81, lastActive: "5 hours ago" },
  { id: "s005", admissionNumber: "GRK2024005", rollNumber: "05", firstName: "Vikram", lastName: "Singh", fullName: "Vikram Singh", email: "vikram.singh@student.gurukul.in", phone: "+91 98765 43214", gender: "male", dob: "2007-05-12", className: "12th", section: "A", status: "suspended", address: "3, Juhu, Mumbai - 400049", parentName: "Harpreet Singh", parentPhone: "+91 98765 55555", parentEmail: "harpreet.singh@gmail.com", joinedDate: "2021-06-01", attendance: 61, performanceScore: 58, lastActive: "3 days ago" },
  { id: "s006", admissionNumber: "GRK2024006", rollNumber: "06", firstName: "Ananya", lastName: "Reddy", fullName: "Ananya Reddy", email: "ananya.reddy@student.gurukul.in", phone: "+91 98765 43215", gender: "female", dob: "2008-09-19", className: "11th", section: "B", status: "active", address: "11, Malad West, Mumbai - 400064", parentName: "Venkat Reddy", parentPhone: "+91 98765 66666", parentEmail: "venkat.reddy@gmail.com", joinedDate: "2022-06-01", attendance: 91, performanceScore: 87, lastActive: "1 hour ago" },
  { id: "s007", admissionNumber: "GRK2024007", rollNumber: "07", firstName: "Karan", lastName: "Mehta", fullName: "Karan Mehta", email: "karan.mehta@student.gurukul.in", phone: "+91 98765 43216", gender: "male", dob: "2007-02-28", className: "12th", section: "B", status: "inactive", address: "7, Versova, Mumbai - 400061", parentName: "Dilip Mehta", parentPhone: "+91 98765 77777", parentEmail: "dilip.mehta@gmail.com", joinedDate: "2021-06-01", attendance: 45, performanceScore: 40, lastActive: "2 weeks ago" },
  { id: "s008", admissionNumber: "GRK2024008", rollNumber: "08", firstName: "Divya", lastName: "Iyer", fullName: "Divya Iyer", email: "divya.iyer@student.gurukul.in", phone: "+91 98765 43217", gender: "female", dob: "2008-06-14", className: "11th", section: "A", status: "active", address: "19, Matunga, Mumbai - 400019", parentName: "Krishnan Iyer", parentPhone: "+91 98765 88888", parentEmail: "krishnan.iyer@gmail.com", joinedDate: "2022-06-01", attendance: 93, performanceScore: 91, lastActive: "45 min ago" },
  { id: "s009", admissionNumber: "GRK2024009", rollNumber: "09", firstName: "Rohan", lastName: "Gupta", fullName: "Rohan Gupta", email: "rohan.gupta@student.gurukul.in", phone: "+91 98765 43218", gender: "male", dob: "2007-08-03", className: "12th", section: "A", status: "active", address: "31, Goregaon East, Mumbai - 400063", parentName: "Ashok Gupta", parentPhone: "+91 98765 99999", parentEmail: "ashok.gupta@gmail.com", joinedDate: "2021-06-01", attendance: 85, performanceScore: 79, lastActive: "3 hours ago" },
  { id: "s010", admissionNumber: "GRK2024010", rollNumber: "10", firstName: "Kavya", lastName: "Menon", fullName: "Kavya Menon", email: "kavya.menon@student.gurukul.in", phone: "+91 98765 43219", gender: "female", dob: "2008-04-27", className: "11th", section: "B", status: "active", address: "5, Santacruz West, Mumbai - 400054", parentName: "Sunil Menon", parentPhone: "+91 98765 10101", parentEmail: "sunil.menon@gmail.com", joinedDate: "2022-06-01", attendance: 89, performanceScore: 83, lastActive: "2 hours ago" },
  { id: "s011", admissionNumber: "GRK2024011", rollNumber: "11", firstName: "Aditya", lastName: "Joshi", fullName: "Aditya Joshi", email: "aditya.joshi@student.gurukul.in", phone: "+91 98765 43220", gender: "male", dob: "2007-12-10", className: "12th", section: "B", status: "active", address: "28, Dadar West, Mumbai - 400028", parentName: "Ramesh Joshi", parentPhone: "+91 98765 20202", parentEmail: "ramesh.joshi@gmail.com", joinedDate: "2021-06-01", attendance: 80, performanceScore: 75, lastActive: "6 hours ago" },
  { id: "s012", admissionNumber: "GRK2024012", rollNumber: "12", firstName: "Ishaan", lastName: "Kapoor", fullName: "Ishaan Kapoor", email: "ishaan.kapoor@student.gurukul.in", phone: "+91 98765 43221", gender: "male", dob: "2008-10-05", className: "11th", section: "A", status: "active", address: "14, Lokhandwala, Andheri West, Mumbai - 400053", parentName: "Ravi Kapoor", parentPhone: "+91 98765 30303", parentEmail: "ravi.kapoor@gmail.com", joinedDate: "2022-06-01", attendance: 94, performanceScore: 90, lastActive: "20 min ago" },
];

export const adminTeachers: AdminTeacher[] = [
  { id: "t001", employeeId: "GRK-T001", firstName: "Dr. Meena", lastName: "Krishnamurthy", fullName: "Dr. Meena Krishnamurthy", email: "meena.k@gurukul.in", phone: "+91 99876 54321", gender: "female", dob: "1980-04-12", qualification: "Ph.D. Mathematics", department: "Science", subjects: ["Mathematics", "Statistics"], assignedClasses: ["11th", "12th"], assignedSections: ["A", "B"], status: "active", address: "201, Teacher Colony, Andheri, Mumbai", joiningDate: "2015-07-01", attendance: 97, lastActive: "1 hour ago" },
  { id: "t002", employeeId: "GRK-T002", firstName: "Prof. Rajiv", lastName: "Menon", fullName: "Prof. Rajiv Menon", email: "rajiv.m@gurukul.in", phone: "+91 99876 54322", gender: "male", dob: "1975-09-28", qualification: "M.Sc. Physics", department: "Science", subjects: ["Physics"], assignedClasses: ["11th", "12th"], assignedSections: ["A", "B"], status: "active", address: "45, Staff Quarters, Bandra, Mumbai", joiningDate: "2012-06-15", attendance: 95, lastActive: "30 min ago" },
  { id: "t003", employeeId: "GRK-T003", firstName: "Ms. Anita", lastName: "Sharma", fullName: "Ms. Anita Sharma", email: "anita.s@gurukul.in", phone: "+91 99876 54323", gender: "female", dob: "1985-02-14", qualification: "M.Sc. Chemistry", department: "Science", subjects: ["Chemistry"], assignedClasses: ["11th", "12th"], assignedSections: ["A"], status: "active", address: "12, Park View Society, Powai, Mumbai", joiningDate: "2018-07-01", attendance: 93, lastActive: "2 hours ago" },
  { id: "t004", employeeId: "GRK-T004", firstName: "Mr. Suresh", lastName: "Nambiar", fullName: "Mr. Suresh Nambiar", email: "suresh.n@gurukul.in", phone: "+91 99876 54324", gender: "male", dob: "1982-07-20", qualification: "M.Sc. Biology", department: "Science", subjects: ["Biology", "Environmental Science"], assignedClasses: ["11th", "12th"], assignedSections: ["B"], status: "active", address: "78, Green Park, Thane, Mumbai", joiningDate: "2016-06-01", attendance: 91, lastActive: "4 hours ago" },
  { id: "t005", employeeId: "GRK-T005", firstName: "Mrs. Pooja", lastName: "Verma", fullName: "Mrs. Pooja Verma", email: "pooja.v@gurukul.in", phone: "+91 99876 54325", gender: "female", dob: "1979-11-03", qualification: "M.A. English Literature", department: "Languages", subjects: ["English", "Literature"], assignedClasses: ["11th", "12th"], assignedSections: ["A", "B"], status: "active", address: "33, Blossom Apartments, Goregaon, Mumbai", joiningDate: "2010-07-01", attendance: 98, lastActive: "15 min ago" },
  { id: "t006", employeeId: "GRK-T006", firstName: "Mr. Deepak", lastName: "Pandey", fullName: "Mr. Deepak Pandey", email: "deepak.p@gurukul.in", phone: "+91 99876 54326", gender: "male", dob: "1988-05-15", qualification: "M.Com. Accounts", department: "Commerce", subjects: ["Accountancy", "Business Studies"], assignedClasses: ["12th"], assignedSections: ["A"], status: "inactive", address: "55, Sunrise Colony, Dadar, Mumbai", joiningDate: "2019-08-01", attendance: 72, lastActive: "1 week ago" },
  { id: "t007", employeeId: "GRK-T007", firstName: "Ms. Lalitha", lastName: "Raghavan", fullName: "Ms. Lalitha Raghavan", email: "lalitha.r@gurukul.in", phone: "+91 99876 54327", gender: "female", dob: "1991-08-25", qualification: "B.Ed., M.A. Hindi", department: "Languages", subjects: ["Hindi"], assignedClasses: ["11th", "12th"], assignedSections: ["A", "B"], status: "active", address: "9, Shanti Nagar, Malad, Mumbai", joiningDate: "2020-06-01", attendance: 88, lastActive: "3 hours ago" },
  { id: "t008", employeeId: "GRK-T008", firstName: "Mr. Aryan", lastName: "Bose", fullName: "Mr. Aryan Bose", email: "aryan.b@gurukul.in", phone: "+91 99876 54328", gender: "male", dob: "1990-03-07", qualification: "M.Sc. Computer Science", department: "Technology", subjects: ["Computer Science", "IT"], assignedClasses: ["11th", "12th"], assignedSections: ["B"], status: "active", address: "101, Tech Park, Powai, Mumbai", joiningDate: "2021-07-15", attendance: 94, lastActive: "1 hour ago" },
];

export const adminParents: AdminParent[] = [
  { id: "p001", fullName: "Rajesh Sharma", fatherName: "Rajesh Sharma", motherName: "Sunita Sharma", relationship: "Father", email: "rajesh.sharma@gmail.com", phone: "+91 98765 11111", occupation: "Software Engineer", address: "42, Andheri West, Mumbai - 400053", linkedStudentIds: ["s001"], status: "active", lastLogin: "2 hours ago", joinedDate: "2021-06-01" },
  { id: "p002", fullName: "Suresh Patel", fatherName: "Suresh Patel", motherName: "Meera Patel", relationship: "Father", email: "suresh.patel@gmail.com", phone: "+91 98765 22222", occupation: "Business Owner", address: "15, Bandra East, Mumbai - 400051", linkedStudentIds: ["s002"], status: "active", lastLogin: "1 day ago", joinedDate: "2021-06-01" },
  { id: "p003", fullName: "Anil Kumar", fatherName: "Anil Kumar", motherName: "Priya Kumar", relationship: "Father", email: "anil.kumar@gmail.com", phone: "+91 98765 33333", occupation: "Doctor", address: "8, Powai, Mumbai - 400076", linkedStudentIds: ["s003"], status: "active", lastLogin: "3 days ago", joinedDate: "2022-06-01" },
  { id: "p004", fullName: "Gopinath Nair", fatherName: "Gopinath Nair", motherName: "Rekha Nair", relationship: "Father", email: "gopinath.nair@gmail.com", phone: "+91 98765 44444", occupation: "Chartered Accountant", address: "22, Thane West, Thane - 400601", linkedStudentIds: ["s004"], status: "active", lastLogin: "5 hours ago", joinedDate: "2022-06-01" },
  { id: "p005", fullName: "Harpreet Singh", fatherName: "Harpreet Singh", motherName: "Gurpreet Kaur", relationship: "Father", email: "harpreet.singh@gmail.com", phone: "+91 98765 55555", occupation: "Retired Army Officer", address: "3, Juhu, Mumbai - 400049", linkedStudentIds: ["s005"], status: "suspended", lastLogin: "1 week ago", joinedDate: "2021-06-01" },
  { id: "p006", fullName: "Venkat Reddy", fatherName: "Venkat Reddy", motherName: "Lakshmi Reddy", relationship: "Father", email: "venkat.reddy@gmail.com", phone: "+91 98765 66666", occupation: "IT Manager", address: "11, Malad West, Mumbai - 400064", linkedStudentIds: ["s006"], status: "active", lastLogin: "30 min ago", joinedDate: "2022-06-01" },
  { id: "p007", fullName: "Dilip Mehta", fatherName: "Dilip Mehta", motherName: "Asha Mehta", relationship: "Father", email: "dilip.mehta@gmail.com", phone: "+91 98765 77777", occupation: "Advocate", address: "7, Versova, Mumbai - 400061", linkedStudentIds: ["s007"], status: "inactive", lastLogin: "3 weeks ago", joinedDate: "2021-06-01" },
  { id: "p008", fullName: "Krishnan Iyer", fatherName: "Krishnan Iyer", motherName: "Padma Iyer", relationship: "Father", email: "krishnan.iyer@gmail.com", phone: "+91 98765 88888", occupation: "Professor", address: "19, Matunga, Mumbai - 400019", linkedStudentIds: ["s008"], status: "active", lastLogin: "1 hour ago", joinedDate: "2022-06-01" },
  { id: "p009", fullName: "Ashok Gupta", fatherName: "Ashok Gupta", motherName: "Vandana Gupta", relationship: "Father", email: "ashok.gupta@gmail.com", phone: "+91 98765 99999", occupation: "Entrepreneur", address: "31, Goregaon East, Mumbai - 400063", linkedStudentIds: ["s009"], status: "active", lastLogin: "4 hours ago", joinedDate: "2021-06-01" },
  { id: "p010", fullName: "Sunil Menon", fatherName: "Sunil Menon", motherName: "Divya Menon", relationship: "Father", email: "sunil.menon@gmail.com", phone: "+91 98765 10101", occupation: "Banker", address: "5, Santacruz West, Mumbai - 400054", linkedStudentIds: ["s010"], status: "active", lastLogin: "3 hours ago", joinedDate: "2022-06-01" },
];

export const adminStats = {
  totalStudents: 248,
  totalTeachers: 18,
  totalParents: 231,
  totalClasses: 8,
  activeUsersToday: 192,
  pendingRequests: 14,
  pendingDoubts: 23,
  studentAttendanceToday: 91,
  teacherAttendanceToday: 94,
  newStudentsThisMonth: 7,
  newTeachersThisMonth: 1,
};

export const recentActivities: Activity[] = [
  { id: "a1", type: "student_added", description: "New student enrolled", actor: "Admin", target: "Ishaan Kapoor (GRK2024012)", time: "2026-07-26T10:30:00", ago: "20 min ago" },
  { id: "a2", type: "password_reset", description: "Password reset performed", actor: "Admin", target: "Vikram Singh", time: "2026-07-26T09:15:00", ago: "1 hr ago" },
  { id: "a3", type: "class_changed", description: "Student moved to new class", actor: "Admin", target: "Rahul Kumar → 12B", time: "2026-07-26T08:00:00", ago: "2 hrs ago" },
  { id: "a4", type: "teacher_added", description: "New teacher added", actor: "Admin", target: "Mr. Aryan Bose (GRK-T008)", time: "2026-07-25T16:45:00", ago: "Yesterday" },
  { id: "a5", type: "suspension", description: "Student suspended", actor: "Admin", target: "Vikram Singh — Policy violation", time: "2026-07-25T14:00:00", ago: "Yesterday" },
  { id: "a6", type: "student_promoted", description: "Bulk promotion completed", actor: "Admin", target: "36 students from 11th → 12th", time: "2026-07-24T11:30:00", ago: "2 days ago" },
  { id: "a7", type: "announcement", description: "Announcement published", actor: "Admin", target: "Exam schedule for July 2026", time: "2026-07-24T09:00:00", ago: "2 days ago" },
];

export const pendingRequests: PendingRequest[] = [
  { id: "r1", type: "password_reset", title: "Password Reset Request", from: "Karan Mehta", fromClass: "12B", time: "2 hours ago", priority: "medium" },
  { id: "r2", type: "doubt", title: "Unresolved doubts (23 pending)", from: "Various students", time: "Ongoing", priority: "high" },
  { id: "r3", type: "enrollment", title: "New admission inquiry", from: "Parent: Sanjay Trivedi", time: "1 day ago", priority: "medium" },
  { id: "r4", type: "leave", title: "Teacher leave request", from: "Mr. Deepak Pandey", time: "3 days ago", priority: "high" },
  { id: "r5", type: "transfer", title: "Section transfer request", from: "Sneha Nair (11A)", time: "2 days ago", priority: "low" },
];

export const announcements: Announcement[] = [
  { id: "an1", title: "July 2026 Exam Schedule Released", content: "Unit tests begin August 4th. All students must carry hall tickets.", audience: "all", createdBy: "Admin", date: "Jul 24, 2026", pinned: true },
  { id: "an2", title: "Parent-Teacher Meeting — Aug 2", content: "PTM scheduled for Saturday, August 2nd from 10 AM to 1 PM.", audience: "parents", createdBy: "Admin", date: "Jul 22, 2026", pinned: false },
  { id: "an3", title: "New AI Coach Features Available", content: "Nova AI coach now supports voice Q&A and personalized revision plans.", audience: "students", createdBy: "Admin", date: "Jul 20, 2026", pinned: false },
];

export const classes = ["11th", "12th"];
export const sections = ["A", "B"];
export const departments = ["Science", "Commerce", "Languages", "Technology", "Arts"];
export const allSubjects = ["Mathematics", "Physics", "Chemistry", "Biology", "English", "Hindi", "Computer Science", "Accountancy", "Business Studies", "Statistics", "IT", "Literature", "Environmental Science"];

export const adminClasses: AdminClass[] = [
  {
    id: "c001", name: "11th", totalStudents: 126, totalTeachers: 8,
    recentAnnouncement: "Unit Test 1 scheduled for Aug 4",
    sections: [
      { id: "c001-A", name: "A", classId: "c001", classTeacherId: "t001", subjectTeacherIds: ["t001", "t002", "t003", "t005"], studentIds: ["s004", "s006", "s008", "s012"], totalStudents: 63, attendanceToday: 92 },
      { id: "c001-B", name: "B", classId: "c001", classTeacherId: "t004", subjectTeacherIds: ["t001", "t002", "t004", "t005", "t007"], studentIds: ["s010"], totalStudents: 63, attendanceToday: 89 },
    ],
  },
  {
    id: "c002", name: "12th", totalStudents: 122, totalTeachers: 8,
    recentAnnouncement: "Board exam forms submission deadline: Aug 15",
    sections: [
      { id: "c002-A", name: "A", classId: "c002", classTeacherId: "t005", subjectTeacherIds: ["t001", "t002", "t003", "t005", "t006"], studentIds: ["s001", "s002", "s005", "s009"], totalStudents: 61, attendanceToday: 94 },
      { id: "c002-B", name: "B", classId: "c002", classTeacherId: "t002", subjectTeacherIds: ["t001", "t002", "t004", "t005", "t008"], studentIds: ["s003", "s007", "s011"], totalStudents: 61, attendanceToday: 88 },
    ],
  },
];
