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









