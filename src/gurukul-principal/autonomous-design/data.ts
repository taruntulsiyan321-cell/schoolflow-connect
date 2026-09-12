/**
 * DESIGN-ONLY — Autonomous Principal Portal fixture data.
 * Not wired to Academic Engine / Supabase. Do not treat as product truth.
 *
 * School year: June 2026 – March 2027. Current date: 11 Sep 2026 (75 school days elapsed)
 */

export type StudentId = string
export type TeacherId = string
export type ClassId = string
export type ExamId = string

export interface FeePayment {
  date: string
  amount: number
  installment: string
}

export interface Student {
  id: StudentId
  name: string
  rollNo: string
  classId: ClassId
  presentDays: number
  totalDays: number
  fees: {
    annual: number
    paid: number
    lastPaymentDate: string | null
    payments: FeePayment[]
  }
  homework: {
    subject: string
    title: string
    dueDate: string
    status: "submitted" | "missing" | "accepted" | "rejected"
  }[]
  examMarks: { examId: string; subject: string; marks: number; outOf: number }[]
  testMarks: { subject: string; title: string; date: string; marks: number; outOf: number }[]
  remarks: { teacher: string; date: string; text: string }[]
}

export interface Teacher {
  id: TeacherId
  name: string
  designation: string
  subjects: string[]
  classIds: ClassId[]
  email: string
  phone: string
  joinDate: string
  presentDays: number
  totalDays: number
  homeworkSet: number
  testsRun: number
}

export interface ExamSubject {
  id: string
  name: string
  hasMarks: boolean
  outOf: number
  passMark: number
}

export interface Exam {
  id: ExamId
  name: string
  term: string
  date: string
  subjects: ExamSubject[]
  classTeacherComment?: string
}

export interface HomeworkItem {
  id: string
  subject: string
  title: string
  setDate: string
  dueDate: string
  totalStudents: number
  submitted: number
  reviewed: number
}

export interface ClassDef {
  id: ClassId
  name: string
  yearGroup: number
  section: string
  formTeacherId: TeacherId
  studentIds: StudentId[]
  todayPresent: number
  below75Count: number
  homeworkCompletion: number
  exams: Exam[]
  homework: HomeworkItem[]
}

export interface LeaveRequest {
  id: string
  studentId: StudentId
  studentName: string
  className: string
  submittedOn: string
  fromDate: string
  toDate: string
  reason: string
  category: "medical" | "family" | "bereavement" | "other"
  status: "pending" | "approved" | "rejected"
  decisionDate?: string
  rejectionReason?: string
}

export interface Announcement {
  id: string
  title: string
  body: string
  sentTo: string[]
  sentBy: string
  sentOn: string
}

export interface AppData {
  principal: { name: string; email: string; role: string; school: string }
  students: Record<StudentId, Student>
  teachers: Record<TeacherId, Teacher>
  classes: Record<ClassId, ClassDef>
  classOrder: ClassId[]
  leaveRequests: LeaveRequest[]
  announcements: Announcement[]
  schoolFees: {
    totalAnnual: number
    totalDue: number
    totalCollected: number
    asOf: string
  }
  schoolAttendance: {
    date: string
    presentCount: number
    totalCount: number
    below75Count: number
    yesterdayPercent: number
  }
}

// Seeded pseudo-random for deterministic data generation
function sr(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(31, h) + seed.charCodeAt(i) | 0
  }
  return (Math.abs(h) % 10000) / 10000
}

function pickName(classId: string, idx: number): string {
  const first = [
    "Aarav","Aanya","Aditi","Aditya","Akshay","Alok","Amita","Ananya","Anjali","Ankit",
    "Arjun","Asha","Deepa","Diya","Divya","Gaurav","Geeta","Harish","Ishaan","Jyoti",
    "Karan","Kavita","Kavya","Krishna","Lakshmi","Manish","Meera","Mohan","Nisha","Nitin",
    "Pooja","Priya","Rahul","Rajesh","Ravi","Rekha","Rohan","Rohit","Sandeep","Sanjay",
    "Sanya","Seema","Shweta","Sneha","Suresh","Tanya","Usha","Vihaan","Vijay","Vikram",
    "Vinay","Yamini","Yash"
  ]
  const last = [
    "Agarwal","Bhat","Chakraborty","Chaudhary","Das","Desai","Dubey","Ghosh","Gupta",
    "Iyer","Jain","Joshi","Kapoor","Kaur","Khan","Kumar","Lal","Malhotra","Mehta",
    "Menon","Mishra","Nair","Patel","Pillai","Rajan","Rao","Reddy","Sharma","Singh",
    "Sinha","Subramaniam","Thakur","Verma","Yadav"
  ]
  const fi = Math.floor(sr(classId + "f" + idx) * first.length)
  const li = Math.floor(sr(classId + "l" + idx) * last.length)
  return first[fi] + " " + last[li]
}

function makeStudents(classId: string, prefix: string, count: number): Student[] {
  const subjects9 = ["English","Mathematics","Science","Social Studies","Hindi"]
  const subjects10 = ["English","Mathematics","Science","Social Studies","Hindi"]
  const subjects11sci = ["English","Physics","Chemistry","Mathematics","Biology"]
  const subjects11com = ["English","Accountancy","Business Studies","Economics","Mathematics"]
  const subjects12sci = ["English","Physics","Chemistry","Mathematics","Biology"]
  const subjects12com = ["English","Accountancy","Business Studies","Economics","Mathematics"]

  const subjectMap: Record<string, string[]> = {
    "9a": subjects9, "9b": subjects9,
    "10a": subjects10, "10b": subjects10,
    "11sci": subjects11sci, "11com": subjects11com,
    "12sci": subjects12sci, "12com": subjects12com,
  }
  const subs = subjectMap[classId] ?? subjects9

  const hwTitles = [
    ["Chapter 3 comprehension","Algebra worksheet","Photosynthesis diagram","Map work — India","Essay: My Favourite Season"],
    ["Poem analysis","Quadratic equations","Lab report: Acids","Timeline — Independence","Letter writing"],
    ["Grammar exercises","Statistics problems","Force and Motion","Geography quiz","Paragraph writing"],
    ["Summary writing","Geometry constructions","Cell division notes","History chapter notes","Dialogue writing"],
  ]

  return Array.from({ length: count }, (_, i) => {
    const id = `${prefix}${String(i + 1).padStart(3, "0")}`
    const name = pickName(classId + id, i)
    const r = (s: string) => sr(id + s)
    const presentDays = Math.max(40, Math.min(75, Math.round(75 * (0.6 + r("att") * 0.4))))
    const annualFee = 42000
    // By Sep, 2 installments are due (₹14k each = ₹28k)
    const paidInstallments = r("fees") < 0.12 ? 0 : r("fees") < 0.28 ? 1 : r("fees") < 0.65 ? 2 : 3
    const paid = paidInstallments * 14000
    const lastPaymentDate = paidInstallments === 0 ? null :
      paidInstallments === 1 ? "2026-06-" + String(10 + Math.floor(r("lpd") * 15)).padStart(2,"0") :
      paidInstallments === 2 ? "2026-08-" + String(5 + Math.floor(r("lpd") * 20)).padStart(2,"0") :
      "2026-08-" + String(25 + Math.floor(r("lpd") * 5)).padStart(2,"0")

    const hwBatch = hwTitles[i % hwTitles.length]
    const homework = subs.map((sub, si) => {
      const statusR = r("hw" + si)
      return {
        subject: sub,
        title: hwBatch[si] ?? `Exercise ${si + 1}`,
        dueDate: `2026-09-${String(3 + si).padStart(2,"0")}`,
        status: (statusR < 0.1 ? "missing" : statusR < 0.55 ? "submitted" : statusR < 0.8 ? "accepted" : "rejected") as "submitted"|"missing"|"accepted"|"rejected",
      }
    })

    const examMarks = subs.map(sub => {
      const raw = r(id + "exam" + sub)
      const marks = Math.round(raw * 80 + 10)
      return { examId: "ut1", subject: sub, marks: Math.min(marks, 80), outOf: 80 }
    })

    const testMarks = subs.slice(0, 3).map((sub, ti) => {
      const raw = r(id + "test" + ti)
      return {
        subject: sub,
        title: `Unit Test ${ti + 1}`,
        date: `2026-0${7 + ti}-15`,
        marks: Math.round(raw * 20 + 5),
        outOf: 25,
      }
    })

    const remarkTexts = [
      "Shows consistent effort in class. Participates actively.",
      "Needs to submit assignments on time. Work quality is good when submitted.",
      "Strong analytical skills. Could benefit from more practice problems.",
      "Attentive in class. Written expression needs improvement.",
      "Good understanding of concepts. Performance in tests reflects this.",
    ]
    const remarks = r("rmk") > 0.4 ? [{
      teacher: "Class Teacher",
      date: `2026-08-${String(10 + Math.floor(r("rmkd") * 20)).padStart(2,"0")}`,
      text: remarkTexts[Math.floor(r("rmkt") * remarkTexts.length)],
    }] : []

    return {
      id, name, rollNo: id,
      classId,
      presentDays,
      totalDays: 75,
      fees: {
        annual: annualFee,
        paid,
        lastPaymentDate,
        payments: Array.from({ length: paidInstallments }, (_, pi) => ({
          date: pi === 0 ? "2026-06-12" : pi === 1 ? "2026-08-10" : "2026-08-28",
          amount: 14000,
          installment: pi === 0 ? "Installment 1 (June)" : pi === 1 ? "Installment 2 (August)" : "Installment 3 (January advance)",
        })),
      },
      homework,
      examMarks,
      testMarks,
      remarks,
    }
  })
}

// --- Build students ---

const classConfigs: { id: ClassId; prefix: string; count: number }[] = [
  { id: "9a",    prefix: "9A",  count: 32 },
  { id: "9b",    prefix: "9B",  count: 30 },
  { id: "10a",   prefix: "10A", count: 28 },
  { id: "10b",   prefix: "10B", count: 31 },
  { id: "11sci", prefix: "11S", count: 24 },
  { id: "11com", prefix: "11C", count: 22 },
  { id: "12sci", prefix: "12S", count: 20 },
  { id: "12com", prefix: "12C", count: 18 },
]

const allStudents: Student[] = classConfigs.flatMap(c => makeStudents(c.id, c.prefix, c.count))
const studentsById: Record<string, Student> = {}
for (const s of allStudents) studentsById[s.id] = s

function classStudents(classId: ClassId) {
  return allStudents.filter(s => s.classId === classId)
}

function computeBelow75(classId: ClassId) {
  return classStudents(classId).filter(s => s.presentDays / s.totalDays < 0.75).length
}

function todayPresent(classId: ClassId, fraction: number) {
  const students = classStudents(classId)
  return Math.round(students.length * fraction)
}

const examUnit1: Exam = {
  id: "ut1",
  name: "Unit Test 1",
  term: "Unit Test",
  date: "2026-08-22",
  subjects: [
    { id: "eng",  name: "English",       hasMarks: true,  outOf: 80, passMark: 32 },
    { id: "math", name: "Mathematics",   hasMarks: true,  outOf: 80, passMark: 32 },
    { id: "sci",  name: "Science",       hasMarks: true,  outOf: 80, passMark: 32 },
    { id: "soc",  name: "Social Studies",hasMarks: true,  outOf: 80, passMark: 32 },
    { id: "hin",  name: "Hindi",         hasMarks: true,  outOf: 80, passMark: 32 },
  ],
  classTeacherComment: "The class has shown steady improvement since the school year began. Mathematics performance needs attention.",
}

const examHY: Exam = {
  id: "hy",
  name: "Half Yearly",
  term: "Half Yearly",
  date: "2026-10-15",
  subjects: [
    { id: "eng",  name: "English",       hasMarks: false, outOf: 100, passMark: 40 },
    { id: "math", name: "Mathematics",   hasMarks: false, outOf: 100, passMark: 40 },
    { id: "sci",  name: "Science",       hasMarks: false, outOf: 100, passMark: 40 },
    { id: "soc",  name: "Social Studies",hasMarks: false, outOf: 100, passMark: 40 },
    { id: "hin",  name: "Hindi",         hasMarks: false, outOf: 100, passMark: 40 },
  ],
}

const exam11UT1: Exam = {
  id: "ut1_11",
  name: "Unit Test 1",
  term: "Unit Test",
  date: "2026-08-20",
  subjects: [
    { id: "eng",  name: "English",     hasMarks: true,  outOf: 80, passMark: 32 },
    { id: "phy",  name: "Physics",     hasMarks: true,  outOf: 80, passMark: 32 },
    { id: "chem", name: "Chemistry",   hasMarks: true,  outOf: 80, passMark: 32 },
    { id: "math", name: "Mathematics", hasMarks: true,  outOf: 80, passMark: 32 },
    { id: "bio",  name: "Biology",     hasMarks: false, outOf: 80, passMark: 32 },
  ],
  classTeacherComment: "Physics and Chemistry scores are strong. Biology practical records need to be submitted before marks can be entered.",
}

const examHigherUT1: Exam = {
  id: "ut1_com",
  name: "Unit Test 1",
  term: "Unit Test",
  date: "2026-08-21",
  subjects: [
    { id: "eng",  name: "English",         hasMarks: true,  outOf: 80, passMark: 32 },
    { id: "acc",  name: "Accountancy",     hasMarks: true,  outOf: 80, passMark: 32 },
    { id: "bst",  name: "Business Studies",hasMarks: true,  outOf: 80, passMark: 32 },
    { id: "eco",  name: "Economics",       hasMarks: true,  outOf: 80, passMark: 32 },
    { id: "math", name: "Mathematics",     hasMarks: false, outOf: 80, passMark: 32 },
  ],
}

function makeHW(classId: string): HomeworkItem[] {
  return [
    { id: "hw1", subject: "Mathematics",    title: "Chapter 4: Quadratic Equations",    setDate: "2026-09-08", dueDate: "2026-09-10", totalStudents: classStudents(classId).length, submitted: Math.round(classStudents(classId).length * 0.82), reviewed: Math.round(classStudents(classId).length * 0.60) },
    { id: "hw2", subject: "English",        title: "Summary writing – Chapter 2",       setDate: "2026-09-07", dueDate: "2026-09-09", totalStudents: classStudents(classId).length, submitted: Math.round(classStudents(classId).length * 0.90), reviewed: Math.round(classStudents(classId).length * 0.80) },
    { id: "hw3", subject: "Science",        title: "Lab report: Acids and Bases",       setDate: "2026-09-05", dueDate: "2026-09-08", totalStudents: classStudents(classId).length, submitted: Math.round(classStudents(classId).length * 0.72), reviewed: Math.round(classStudents(classId).length * 0.55) },
    { id: "hw4", subject: "Social Studies", title: "Map work – Physical features",      setDate: "2026-09-03", dueDate: "2026-09-06", totalStudents: classStudents(classId).length, submitted: Math.round(classStudents(classId).length * 0.88), reviewed: Math.round(classStudents(classId).length * 0.88) },
    { id: "hw5", subject: "Hindi",          title: "Nibandh lekhan",                   setDate: "2026-09-02", dueDate: "2026-09-05", totalStudents: classStudents(classId).length, submitted: Math.round(classStudents(classId).length * 0.78), reviewed: Math.round(classStudents(classId).length * 0.70) },
  ]
}

// --- Teachers ---

export const teachers: Record<TeacherId, Teacher> = {
  T01: { id:"T01", name:"Priya Sharma",         designation:"Senior Teacher",       subjects:["Mathematics"],              classIds:["9a","9b","10a"],          email:"priya.sharma@gurukul.edu",         phone:"98401 11201", joinDate:"2018-06-01", presentDays:72, totalDays:75, homeworkSet:18, testsRun:4 },
  T02: { id:"T02", name:"Arjun Nair",            designation:"Teacher",              subjects:["Physics"],                  classIds:["11sci","12sci"],           email:"arjun.nair@gurukul.edu",           phone:"98401 11202", joinDate:"2021-06-01", presentDays:70, totalDays:75, homeworkSet:12, testsRun:3 },
  T03: { id:"T03", name:"Kavitha Rajan",         designation:"Senior Teacher",       subjects:["English"],                  classIds:["9a","9b","10a","10b"],     email:"kavitha.rajan@gurukul.edu",        phone:"98401 11203", joinDate:"2015-06-01", presentDays:74, totalDays:75, homeworkSet:22, testsRun:5 },
  T04: { id:"T04", name:"Dr. Ravi Kumar",        designation:"Head of Department",   subjects:["Chemistry"],                classIds:["11sci","12sci","10a"],     email:"ravi.kumar@gurukul.edu",           phone:"98401 11204", joinDate:"2012-06-01", presentDays:71, totalDays:75, homeworkSet:15, testsRun:4 },
  T05: { id:"T05", name:"Dr. Nalini Menon",      designation:"Senior Teacher",       subjects:["Biology"],                  classIds:["11sci","12sci"],           email:"nalini.menon@gurukul.edu",         phone:"98401 11205", joinDate:"2016-06-01", presentDays:68, totalDays:75, homeworkSet:10, testsRun:2 },
  T06: { id:"T06", name:"Suresh Pillai",         designation:"Teacher",              subjects:["Accountancy"],              classIds:["11com","12com"],           email:"suresh.pillai@gurukul.edu",        phone:"98401 11206", joinDate:"2020-06-01", presentDays:73, totalDays:75, homeworkSet:14, testsRun:3 },
  T07: { id:"T07", name:"Lakshmi Iyer",          designation:"Senior Teacher",       subjects:["Business Studies"],         classIds:["11com","12com"],           email:"lakshmi.iyer@gurukul.edu",         phone:"98401 11207", joinDate:"2014-06-01", presentDays:72, totalDays:75, homeworkSet:16, testsRun:4 },
  T08: { id:"T08", name:"Mohan Das",             designation:"Teacher",              subjects:["Social Studies"],           classIds:["9a","9b","10a","10b"],     email:"mohan.das@gurukul.edu",            phone:"98401 11208", joinDate:"2019-06-01", presentDays:69, totalDays:75, homeworkSet:11, testsRun:2 },
  T09: { id:"T09", name:"Asha Krishnan",         designation:"Teacher",              subjects:["Hindi"],                    classIds:["9a","9b","10a","10b","11sci","11com","12sci","12com"], email:"asha.krishnan@gurukul.edu", phone:"98401 11209", joinDate:"2017-06-01", presentDays:74, totalDays:75, homeworkSet:20, testsRun:5 },
  T10: { id:"T10", name:"Thomas Varghese",       designation:"Teacher",              subjects:["Computer Science"],         classIds:["9a","9b","11sci"],         email:"thomas.varghese@gurukul.edu",      phone:"98401 11210", joinDate:"2022-06-01", presentDays:75, totalDays:75, homeworkSet:8,  testsRun:2 },
  T11: { id:"T11", name:"Deepa Menon",           designation:"Teacher",              subjects:["Economics"],                classIds:["11com","12com"],           email:"deepa.menon@gurukul.edu",          phone:"98401 11211", joinDate:"2023-06-01", presentDays:67, totalDays:75, homeworkSet:9,  testsRun:2 },
  T12: { id:"T12", name:"Radhika Subramaniam",   designation:"Head of Department",   subjects:["Mathematics"],              classIds:["10b","11com","12com"],     email:"radhika.subramaniam@gurukul.edu",  phone:"98401 11212", joinDate:"2011-06-01", presentDays:73, totalDays:75, homeworkSet:19, testsRun:5 },
}

// --- Classes ---

export const classes: Record<ClassId, ClassDef> = {
  "9a":    { id:"9a",    name:"9 — A",       yearGroup:9,  section:"A", formTeacherId:"T01", studentIds: classStudents("9a").map(s=>s.id),    todayPresent: todayPresent("9a",0.875),    below75Count: computeBelow75("9a"),    homeworkCompletion:0.78, exams:[examUnit1, examHY],            homework:makeHW("9a") },
  "9b":    { id:"9b",    name:"9 — B",       yearGroup:9,  section:"B", formTeacherId:"T02", studentIds: classStudents("9b").map(s=>s.id),    todayPresent: todayPresent("9b",0.833),    below75Count: computeBelow75("9b"),    homeworkCompletion:0.72, exams:[examUnit1, examHY],            homework:makeHW("9b") },
  "10a":   { id:"10a",   name:"10 — A",      yearGroup:10, section:"A", formTeacherId:"T03", studentIds: classStudents("10a").map(s=>s.id),   todayPresent: todayPresent("10a",0.911),   below75Count: computeBelow75("10a"),   homeworkCompletion:0.85, exams:[examUnit1, examHY],            homework:makeHW("10a") },
  "10b":   { id:"10b",   name:"10 — B",      yearGroup:10, section:"B", formTeacherId:"T12", studentIds: classStudents("10b").map(s=>s.id),   todayPresent: todayPresent("10b",0.871),   below75Count: computeBelow75("10b"),   homeworkCompletion:0.80, exams:[examUnit1, examHY],            homework:makeHW("10b") },
  "11sci": { id:"11sci", name:"11 — Science", yearGroup:11, section:"Science", formTeacherId:"T05", studentIds: classStudents("11sci").map(s=>s.id), todayPresent: todayPresent("11sci",0.917), below75Count: computeBelow75("11sci"), homeworkCompletion:0.88, exams:[exam11UT1],                    homework:makeHW("11sci") },
  "11com": { id:"11com", name:"11 — Commerce",yearGroup:11, section:"Commerce", formTeacherId:"T06", studentIds: classStudents("11com").map(s=>s.id), todayPresent: todayPresent("11com",0.850), below75Count: computeBelow75("11com"), homeworkCompletion:0.75, exams:[examHigherUT1],                homework:makeHW("11com") },
  "12sci": { id:"12sci", name:"12 — Science", yearGroup:12, section:"Science", formTeacherId:"T04", studentIds: classStudents("12sci").map(s=>s.id), todayPresent: todayPresent("12sci",0.950), below75Count: computeBelow75("12sci"), homeworkCompletion:0.90, exams:[exam11UT1],                    homework:makeHW("12sci") },
  "12com": { id:"12com", name:"12 — Commerce",yearGroup:12, section:"Commerce", formTeacherId:"T07", studentIds: classStudents("12com").map(s=>s.id), todayPresent: todayPresent("12com",0.889), below75Count: computeBelow75("12com"), homeworkCompletion:0.82, exams:[examHigherUT1],                homework:makeHW("12com") },
}

const CLASS_ORDER: ClassId[] = ["9a","9b","10a","10b","11sci","11com","12sci","12com"]

// --- School-level aggregates ---

function computeSchoolFees() {
  let totalAnnual = 0, totalDue = 0, totalCollected = 0
  for (const s of allStudents) {
    totalAnnual += s.fees.annual
    totalDue += 28000 // first 2 installments due by Sep
    totalCollected += s.fees.paid
  }
  return { totalAnnual, totalDue, totalCollected, asOf: "11 Sep 2026, 8:47 AM" }
}

function computeSchoolAttendance() {
  let present = 0, total = 0, below75 = 0
  for (const classId of CLASS_ORDER) {
    const cls = classes[classId]
    present += cls.todayPresent
    total += cls.studentIds.length
    below75 += cls.below75Count
  }
  return { date:"11 Sep 2026", presentCount:present, totalCount:total, below75Count:below75, yesterdayPercent:91 }
}

// --- Leave requests ---

export const leaveRequests: LeaveRequest[] = [
  { id:"L001", studentId:"9A003", studentName:"Arjun Pillai",    className:"9 — A", submittedOn:"2026-09-08", fromDate:"2026-09-09", toDate:"2026-09-10", reason:"Viral fever — doctor has advised two days rest. Medical certificate attached.", category:"medical",     status:"pending" },
  { id:"L002", studentId:"9A006", studentName:"Kavya Nair",      className:"9 — A", submittedOn:"2026-09-09", fromDate:"2026-09-12", toDate:"2026-09-16", reason:"Elder sister's wedding in Thrissur. Family travel required for five days.",       category:"family",      status:"pending" },
  { id:"L003", studentId:"10B008",studentName:"Arjun Mehta",     className:"10 — B",submittedOn:"2026-09-10", fromDate:"2026-09-11", toDate:"2026-09-13", reason:"Paternal grandfather passed away. Family is travelling to Lucknow.",              category:"bereavement", status:"pending" },
  { id:"L004", studentId:"11C005",studentName:"Priya Sharma",    className:"11 — Commerce",submittedOn:"2026-09-11", fromDate:"2026-09-11", toDate:"2026-09-11", reason:"Specialist appointment — orthopaedic follow-up after August fracture.",   category:"medical",     status:"pending" },
  { id:"L005", studentId:"9B004", studentName:"Diya Krishnan",   className:"9 — B", submittedOn:"2026-09-04", fromDate:"2026-09-05", toDate:"2026-09-06", reason:"High fever. Medical certificate provided.",                                       category:"medical",     status:"approved", decisionDate:"2026-09-04" },
  { id:"L006", studentId:"10A002",studentName:"Sneha Menon",     className:"10 — A",submittedOn:"2026-09-02", fromDate:"2026-09-03", toDate:"2026-09-05", reason:"Cousin's wedding in Chennai.",                                                     category:"family",      status:"rejected", decisionDate:"2026-09-02", rejectionReason:"Leave cannot be granted during the assessment week. The student may apply for a different period." },
  { id:"L007", studentId:"12S003",studentName:"Rahul Subramaniam",className:"12 — Science",submittedOn:"2026-08-28", fromDate:"2026-08-29", toDate:"2026-08-29", reason:"State-level chess tournament — invited to represent district.", category:"other", status:"approved", decisionDate:"2026-08-28" },
  { id:"L008", studentId:"9A001", studentName:"Aarav Mehta",     className:"9 — A", submittedOn:"2026-08-20", fromDate:"2026-08-21", toDate:"2026-08-22", reason:"Dengue — hospitalised. Discharge summary provided.",                               category:"medical",     status:"approved", decisionDate:"2026-08-20" },
]

// --- Announcements ---

export const announcements: Announcement[] = [
  { id:"A001", title:"Revised timetable — Class 10 Unit Test 2", body:"The Unit Test 2 for Classes 10-A and 10-B will now be held from 22 September to 26 September 2026. The original dates (18–22 September) stand cancelled. Subject teachers will share the updated schedule with students today.\n\nThe examination hall seating plan will be posted on the notice board by 19 September.", sentTo:["10a","10b"], sentBy:"Meera Krishnamurthy", sentOn:"2026-09-08" },
  { id:"A002", title:"Annual Day 2026 — Participation notice",  body:"Annual Day 2026 is scheduled for 28 November 2026. All students in Classes 9 through 12 are invited to audition for cultural performances. Auditions will be held on 20 and 21 September in the main hall from 3:30 PM onwards.\n\nStudents interested in backstage, decoration, or technical support should submit their names to the class teacher by 15 September.", sentTo:["all"], sentBy:"Meera Krishnamurthy", sentOn:"2026-09-05" },
  { id:"A003", title:"Parent–Teacher Meeting — 20 September",   body:"The quarterly Parent–Teacher Meeting will be held on Saturday, 20 September 2026 from 9:00 AM to 1:00 PM. All parents and guardians are requested to attend.\n\nAppointment slips will be sent home with students by 15 September. Walk-in appointments will be accommodated between 12:00 PM and 1:00 PM only if scheduled slots are complete.", sentTo:["all"], sentBy:"Meera Krishnamurthy", sentOn:"2026-09-03" },
  { id:"A004", title:"Independence Day function — 15 August",   body:"The school will hold its Independence Day function on Friday, 15 August 2026 at 8:00 AM in the assembly ground. Attendance is compulsory for all students. The programme will conclude by 10:00 AM.\n\nAll staff are requested to be present by 7:30 AM.", sentTo:["all"], sentBy:"Meera Krishnamurthy", sentOn:"2026-08-13" },
  { id:"A005", title:"August fee installment — due 15 August",  body:"A reminder that the second fee installment for the academic year 2026–27 is due by 15 August 2026. Families who have not yet remitted payment are requested to do so at the school office before the due date.\n\nOnline payment details are available at the school office. Late fee of ₹100 per day will apply from 16 August.", sentTo:["all"], sentBy:"Meera Krishnamurthy", sentOn:"2026-08-01" },
]

export const appData: AppData = {
  principal: { name:"Meera Krishnamurthy", email:"principal@gurukul.edu", role:"Principal", school:"Gurukul" },
  students: studentsById,
  teachers,
  classes,
  classOrder: CLASS_ORDER,
  leaveRequests,
  announcements,
  schoolFees: computeSchoolFees(),
  schoolAttendance: computeSchoolAttendance(),
}

// Helper: get student marks for a class+exam+subject (for score distribution view)
export function getClassSubjectMarks(classId: ClassId, examId: ExamId, subjectId: string): { studentId: string; name: string; marks: number; outOf: number }[] {
  const cls = classes[classId]
  if (!cls) return []
  const exam = cls.exams.find(e => e.id === examId)
  const sub = exam?.subjects.find(s => s.id === subjectId)
  if (!sub) return []
  return cls.studentIds.map(sid => {
    const st = studentsById[sid]
    if (!st) return null
    // Use seeded random for marks
    const r = sr(sid + examId + subjectId)
    const isStruggling = r < 0.12
    const isExcellent = r > 0.82
    const marks = isStruggling
      ? Math.round(r * sub.passMark * 0.9)
      : isExcellent
      ? Math.round(sub.outOf * (0.85 + (r - 0.82) * 0.88))
      : Math.round(sub.outOf * (0.38 + r * 0.47))
    return { studentId: sid, name: st.name, marks: Math.min(marks, sub.outOf), outOf: sub.outOf }
  }).filter(Boolean) as { studentId: string; name: string; marks: number; outOf: number }[]
}

export function getAbsentsForDate(classId: ClassId, date: string): StudentId[] {
  const cls = classes[classId]
  if (!cls) return []
  let presentCount: number
  if (date === "2026-09-11") {
    presentCount = cls.todayPresent
  } else {
    const r = sr(date + classId + "att")
    const basePct = cls.todayPresent / cls.studentIds.length
    const pct = Math.max(0.55, Math.min(1, basePct + (r - 0.5) * 0.12))
    presentCount = Math.round(cls.studentIds.length * pct)
  }
  const absentCount = Math.max(0, cls.studentIds.length - presentCount)
  return [...cls.studentIds]
    .sort((a, b) => sr(a + date + "absent") - sr(b + date + "absent"))
    .slice(0, absentCount)
}

export function getClassPresentForDate(classId: ClassId, date: string): number {
  const cls = classes[classId]
  if (!cls) return 0
  if (date === "2026-09-11") return cls.todayPresent
  const r = sr(date + classId + "att")
  const basePct = cls.todayPresent / cls.studentIds.length
  const pct = Math.max(0.55, Math.min(1, basePct + (r - 0.5) * 0.12))
  return Math.round(cls.studentIds.length * pct)
}

export function fmtRupees(n: number): string {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(2)} Cr`
  if (n >= 100000)   return `₹${(n / 100000).toFixed(2)} L`
  if (n >= 1000)     return `₹${(n / 1000).toFixed(1)}k`
  return `₹${n}`
}

export function fmtPct(n: number, d: number): string {
  if (d === 0) return "—"
  return `${((n / d) * 100).toFixed(1)}%`
}
