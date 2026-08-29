/**
 * DESIGN-ONLY fixture data. Do NOT import value exports into mounted
 * student product routes (`StudentDashboard` / gurukul student shell).
 * Unmounted design prototypes (ConceptMastery, AnalyticsPage) may still
 * reference these for layout review — never as product fallbacks.
 *
 * PageKey: import from `@/gurukul/nav`.
 */
export type { PageKey } from "@/gurukul/nav";

export const student = {
  name: "Arjun Sharma", firstName: "Arjun", class: "XII — Science",
  rollNo: "23", section: "A", avatar: "AS", xp: 8420, level: 14,
  xpToNext: 1000, streak: 12, rank: 3, totalStudents: 48,
  accuracy: 81, attendance: 92,
  totalQuestions: 1240, correctAnswers: 1005, sessionsThisWeek: 6,
  avgSpeed: 38, goal: "IIT JEE 2025",
};

export const subjects = [
  { id: "math",      name: "Mathematics", color: "#5b7ef5", icon: "∑", accuracy: 91, attempts: 210, trend: +7, strongChapters: ["Integration","Matrices"],    weakChapters: ["Differential Equations"] },
  { id: "physics",   name: "Physics",     color: "#4b9fd4", icon: "⚡", accuracy: 88, attempts: 142, trend: +4, strongChapters: ["Optics","Waves"],            weakChapters: ["Electrostatics"] },
  { id: "chemistry", name: "Chemistry",   color: "#8f7dd6", icon: "⚗", accuracy: 73, attempts: 98,  trend: -2, strongChapters: ["Thermodynamics"],            weakChapters: ["Organic Chemistry","Electrochemistry"] },
  { id: "biology",   name: "Biology",     color: "#4aa87a", icon: "🧬", accuracy: 65, attempts: 76,  trend: -5, strongChapters: ["Cell Biology"],              weakChapters: ["Genetics","Plant Physiology"] },
  { id: "english",   name: "English",     color: "#c08a3a", icon: "✍", accuracy: 84, attempts: 54,  trend: +2, strongChapters: ["Grammar","Comprehension"],   weakChapters: ["Essay Writing"] },
];

export const practiceQuestions = [
  { id:"q1", subject:"Mathematics", chapter:"Integration",       question:"The value of ∫₀¹ x·eˣ dx is:", options:["e − 1","e + 1","1","e − 2"], correct:0, explanation:"Using integration by parts: [x·eˣ − eˣ]₀¹ = (e−e) − (0−1) = 1. Answer: e−1.", difficulty:"medium", tags:["calculus"] },
  { id:"q2", subject:"Physics",     chapter:"Optics",            question:"A convex lens of focal length 20 cm forms a real image at 60 cm. What is the object distance?", options:["30 cm","40 cm","15 cm","25 cm"], correct:0, explanation:"Lens formula: 1/v − 1/u = 1/f → 1/60 − 1/u = 1/20 → u = −30 cm.", difficulty:"easy", tags:["optics"] },
  { id:"q3", subject:"Chemistry",   chapter:"Organic Chemistry", question:"Which is the IUPAC name of CH₃−CH(OH)−CH₂−CH₃?", options:["Butan-2-ol","Butan-1-ol","2-Butanol","Butanol"], correct:0, explanation:"4 carbons, −OH on C2. IUPAC: Butan-2-ol.", difficulty:"easy", tags:["nomenclature"] },
  { id:"q4", subject:"Mathematics", chapter:"Matrices",          question:"If A = [[1,2],[3,4]], what is det(A)?", options:["−2","2","10","−10"], correct:0, explanation:"det = (1×4)−(2×3) = 4−6 = −2.", difficulty:"easy", tags:["matrices"] },
  { id:"q5", subject:"Physics",     chapter:"Electrostatics",    question:"Electric field inside a hollow conducting sphere is:", options:["Zero","Uniform","Varies with radius","Maximum at center"], correct:0, explanation:"By Gauss's law, no net charge enclosed → field is zero.", difficulty:"easy", tags:["electrostatics"] },
];

export const aiMessages: { role: "nova" | "student"; text: string }[] = [
  { role: "nova",    text: "Good morning, Arjun! 🌟 I've reviewed your last 3 sessions. You're doing brilliantly in Mathematics — that Integration streak is real. But Organic Chemistry needs attention. 14 unresolved mistakes, 3 recurring. Want to tackle those today?" },
  { role: "student", text: "Yes, but I don't understand why SN1 reactions keep tripping me up." },
  { role: "nova",    text: "Great question. SN1 confusion usually comes from mixing up carbocation stability with the mechanism. Let me break it down using the Feynman method — explain it back to me first. What do you think happens in Step 1 of an SN1 reaction?" },
];

export const recoveryItems = [
  { id:"r1", concept:"Organic Chemistry — SN1 vs SN2", subject:"Chemistry", mistake:"Confused SN1 with SN2 for primary alkyl halides", mistakeDate:"Jun 10", recoveryQuestion:"Which mechanism does methyl bromide (CH₃Br) follow with NaOH?", options:["SN2 only","SN1 only","Both equally","Neither"], correct:0, hint:"Think about carbocation stability — primary can't form a stable carbocation.", attempts:2 },
  { id:"r2", concept:"Genetics — Dihybrid Cross",       subject:"Biology",   mistake:"Calculated wrong phenotypic ratio in dihybrid cross", mistakeDate:"Jun 9",  recoveryQuestion:"In AaBb × AaBb, what is the phenotypic ratio?", options:["9:3:3:1","3:1","1:2:1","1:1:1:1"], correct:0, hint:"Mendel's law of independent assortment — each trait independently.", attempts:1 },
  { id:"r3", concept:"Differential Equations",          subject:"Mathematics",mistake:"Wrong integrating factor for dy/dx + Py = Q", mistakeDate:"Jun 8",  recoveryQuestion:"The integrating factor for dy/dx + (2/x)y = x² is:", options:["x²","x","1/x²","eˣ"], correct:0, hint:"IF = e^(∫P dx) where P = 2/x.", attempts:3 },
];

export const revisionItems = [
  { id:"rv1", concept:"Integration by Parts", subject:"Mathematics", lastSeen:"2 days ago", dueIn:"Now",     mastery:72, reviews:4 },
  { id:"rv2", concept:"Snell's Law",          subject:"Physics",     lastSeen:"4 days ago", dueIn:"Now",     mastery:80, reviews:6 },
  { id:"rv3", concept:"Electrochemistry",     subject:"Chemistry",   lastSeen:"5 days ago", dueIn:"Tomorrow",mastery:55, reviews:2 },
  { id:"rv4", concept:"Mitosis Phases",       subject:"Biology",     lastSeen:"1 day ago",  dueIn:"2 days",  mastery:85, reviews:7 },
  { id:"rv5", concept:"Matrices Operations",  subject:"Mathematics", lastSeen:"3 days ago", dueIn:"Today",   mastery:90, reviews:9 },
];

export const concepts = [
  { id:"c1", concept:"Integration",       subject:"Mathematics", mastery:94, mistakes:1,  practiced:48, lastPracticed:"Today" },
  { id:"c2", concept:"Optics",            subject:"Physics",     mastery:91, mistakes:2,  practiced:35, lastPracticed:"Yesterday" },
  { id:"c3", concept:"Thermodynamics",    subject:"Chemistry",   mastery:88, mistakes:1,  practiced:28, lastPracticed:"2 days ago" },
  { id:"c4", concept:"Cell Biology",      subject:"Biology",     mastery:82, mistakes:3,  practiced:22, lastPracticed:"3 days ago" },
  { id:"c5", concept:"Grammar Rules",     subject:"English",     mastery:85, mistakes:2,  practiced:18, lastPracticed:"4 days ago" },
  { id:"c6", concept:"Organic Chemistry", subject:"Chemistry",   mastery:51, mistakes:14, practiced:30, lastPracticed:"Yesterday" },
  { id:"c7", concept:"Genetics",          subject:"Biology",     mastery:48, mistakes:11, practiced:20, lastPracticed:"2 days ago" },
  { id:"c8", concept:"Differential Equations", subject:"Mathematics", mastery:62, mistakes:8, practiced:25, lastPracticed:"3 days ago" },
  { id:"c9", concept:"Electrostatics",    subject:"Physics",     mastery:69, mistakes:6,  practiced:32, lastPracticed:"4 days ago" },
];

export const mistakes = [
  { id:"m1", concept:"SN1 vs SN2",              subject:"Chemistry",   chapter:"Organic Chemistry",     date:"Jun 10", count:3, status:"in-recovery", question:"Confused mechanism for primary alkyl halides" },
  { id:"m2", concept:"Dihybrid Cross",           subject:"Biology",     chapter:"Genetics",              date:"Jun 9",  count:2, status:"in-recovery", question:"Wrong phenotypic ratio calculation" },
  { id:"m3", concept:"Integrating Factor",       subject:"Mathematics", chapter:"Differential Equations",date:"Jun 8",  count:4, status:"pending",     question:"Applied wrong formula for IF" },
  { id:"m4", concept:"Carbocation Stability",    subject:"Chemistry",   chapter:"Organic",               date:"Jun 7",  count:2, status:"mastered",    question:"Ranked stability incorrectly" },
  { id:"m5", concept:"Electrostatic Potential",  subject:"Physics",     chapter:"Electrostatics",        date:"Jun 6",  count:2, status:"pending",     question:"Confused potential with field" },
  { id:"m6", concept:"Genetic Drift",            subject:"Biology",     chapter:"Evolution",             date:"Jun 5",  count:1, status:"mastered",    question:"Mixed with natural selection" },
];

export const battles = [
  { id:"b1", opponent:"Priya Nair",   subject:"Mathematics", status:"active",  myScore:7, theirScore:6, questions:10, timeLeft:"3:42", avatar:"PN", color:"#c08a3a" },
  { id:"b2", opponent:"Rahul Mehta",  subject:"Physics",     status:"pending", myScore:0, theirScore:0, questions:10, timeLeft:"—",    avatar:"RM", color:"#4b9fd4" },
  { id:"b3", opponent:"Sneha Patel",  subject:"Chemistry",   status:"won",     myScore:8, theirScore:5, questions:10, timeLeft:"—",    avatar:"SP", color:"#4aa87a" },
  { id:"b4", opponent:"Karan Joshi",  subject:"Biology",     status:"lost",    myScore:4, theirScore:9, questions:10, timeLeft:"—",    avatar:"KJ", color:"#8f7dd6" },
];

export const leaderboard = [
  { rank:1, name:"Priya Nair",   xp:9810, accuracy:88, streak:18, avatar:"PN", color:"#c08a3a" },
  { rank:2, name:"Rahul Mehta",  xp:9140, accuracy:85, streak:14, avatar:"RM", color:"#4b9fd4" },
  { rank:3, name:"Arjun Sharma", xp:8420, accuracy:81, streak:12, avatar:"AS", color:"#5b7ef5", you:true },
  { rank:4, name:"Sneha Patel",  xp:7990, accuracy:79, streak:9,  avatar:"SP", color:"#4aa87a" },
  { rank:5, name:"Karan Joshi",  xp:7620, accuracy:77, streak:7,  avatar:"KJ", color:"#8f7dd6" },
  { rank:6, name:"Ananya Singh", xp:7200, accuracy:74, streak:5,  avatar:"AN", color:"#cc5069" },
  { rank:7, name:"Dev Kumar",    xp:6980, accuracy:72, streak:4,  avatar:"DK", color:"#fb923c" },
  { rank:8, name:"Meera Rao",    xp:6540, accuracy:71, streak:3,  avatar:"MR", color:"#818cf8" },
];

export const achievements = [
  { id:"a1", title:"Streak Master",      desc:"12 days in a row",                        icon:"🔥", unlocked:true,  xp:500,  date:"Jun 12" },
  { id:"a2", title:"Math Wizard",        desc:"90%+ in Mathematics for 7 days",          icon:"🧮", unlocked:true,  xp:1000, date:"Jun 10" },
  { id:"a3", title:"Battle Champion",    desc:"Win 10 battles",                           icon:"⚔️", unlocked:true,  xp:750,  date:"Jun 8"  },
  { id:"a4", title:"Error Eliminator",   desc:"Resolve 20 mistakes",                     icon:"✅", unlocked:false, xp:500,  progress:14, target:20 },
  { id:"a5", title:"Speed Demon",        desc:"Answer 20 questions in under 30s each",  icon:"⚡", unlocked:false, xp:600,  progress:12, target:20 },
  { id:"a6", title:"Scholar",            desc:"Reach Level 20",                          icon:"🎓", unlocked:false, xp:2000, progress:14, target:20 },
  { id:"a7", title:"Subject Master",     desc:"90%+ in all subjects",                    icon:"🏅", unlocked:false, xp:3000, progress:2,  target:5  },
  { id:"a8", title:"Feynman",            desc:"Explain 10 concepts in AI Coach",         icon:"🧠", unlocked:true,  xp:400,  date:"Jun 5"  },
];

export const resources = [
  { id:"res1", title:"Integration Techniques — Full Notes",  subject:"Mathematics", type:"PDF",   size:"2.4 MB", uploadedBy:"Mr. Verma",  date:"Jun 10", downloads:38 },
  { id:"res2", title:"Optics Video Lecture — Ch. 9",        subject:"Physics",     type:"Video",  size:"145 MB", uploadedBy:"Ms. Sharma", date:"Jun 9",  downloads:52 },
  { id:"res3", title:"Organic Chemistry Mechanisms",        subject:"Chemistry",   type:"PDF",   size:"4.1 MB", uploadedBy:"Mr. Khan",   date:"Jun 8",  downloads:61 },
  { id:"res4", title:"Genetics Practice Problems",          subject:"Biology",     type:"PDF",   size:"1.8 MB", uploadedBy:"Ms. Iyer",   date:"Jun 7",  downloads:29 },
  { id:"res5", title:"Essay Writing Guide — Board Exam",   subject:"English",     type:"PDF",   size:"0.9 MB", uploadedBy:"Ms. Kapoor", date:"Jun 6",  downloads:17 },
  { id:"res6", title:"Electrostatics — Formula Sheet",     subject:"Physics",     type:"PDF",   size:"0.5 MB", uploadedBy:"Ms. Sharma", date:"Jun 5",  downloads:44 },
];

export const doubts = [
  { id:"d1", question:"Why does SN2 not work for tertiary halides?",   subject:"Chemistry",   chapter:"Organic Chemistry", date:"Jun 11", status:"answered", answer:"Steric hindrance from the three bulky groups prevents the nucleophile from attacking from the back.", answeredBy:"Mr. Khan" },
  { id:"d2", question:"How to integrate ∫sec³x dx?",                   subject:"Mathematics", chapter:"Integration",       date:"Jun 10", status:"pending",  answer:null, answeredBy:null },
  { id:"d3", question:"Difference between dominant and codominance?",   subject:"Biology",     chapter:"Genetics",          date:"Jun 9",  status:"answered", answer:"In dominance one allele masks another. In codominance both alleles are expressed equally (e.g., AB blood type).", answeredBy:"Ms. Iyer" },
];

/** DESIGN-ONLY fixture — never import into mounted student Homework / Assignments. */
export const assignments: never[] = [];

export const attendanceData = {
  overall: 92,
  bySubject: [
    { subject:"Mathematics", present:44, total:46, pct:95 },
    { subject:"Physics",     present:42, total:46, pct:91 },
    { subject:"Chemistry",   present:40, total:46, pct:87 },
    { subject:"Biology",     present:43, total:46, pct:93 },
    { subject:"English",     present:44, total:46, pct:96 },
  ],
  calendar: (() => {
    const cal: Record<string, "present"|"absent"|"holiday"> = {};
    for (let d = 1; d <= 30; d++) {
      const key = `2025-06-${String(d).padStart(2,"0")}`;
      const day = new Date(2025,5,d).getDay();
      if (day === 0 || day === 6)           cal[key] = "holiday";
      else if (d === 4||d === 11||d === 18) cal[key] = "absent";
      else if (d <= 13)                     cal[key] = "present";
    }
    return cal;
  })(),
};

export const weeklyActivity = [
  { day:"Mon", test:12, practice:8,  battles:3,  total:23 },
  { day:"Tue", test:18, practice:14, battles:5,  total:37 },
  { day:"Wed", test:6,  practice:20, battles:0,  total:26 },
  { day:"Thu", test:22, practice:10, battles:8,  total:40 },
  { day:"Fri", test:15, practice:18, battles:4,  total:37 },
  { day:"Sat", test:28, practice:22, battles:10, total:60 },
  { day:"Sun", test:8,  practice:6,  battles:2,  total:16 },
];

export const accuracyTrend = [
  { week:"W1", score:62 }, { week:"W2", score:67 }, { week:"W3", score:71 },
  { week:"W4", score:69 }, { week:"W5", score:75 }, { week:"W6", score:78 }, { week:"W7", score:81 },
];

export const timetable = [
  { day:"Monday",    periods:[
    { time:"8:00–8:45",  subject:"Mathematics", teacher:"Mr. Verma",   room:"R101", color:"#5b7ef5" },
    { time:"8:45–9:30",  subject:"Physics",     teacher:"Ms. Sharma",  room:"Lab1", color:"#4b9fd4" },
    { time:"9:30–10:15", subject:"Break",       teacher:"",            room:"",     color:"#78788c" },
    { time:"10:15–11:00",subject:"Chemistry",   teacher:"Mr. Khan",    room:"R103", color:"#8f7dd6" },
    { time:"11:00–11:45",subject:"English",     teacher:"Ms. Patel",   room:"R201", color:"#c08a3a" },
    { time:"11:45–12:30",subject:"Biology",     teacher:"Ms. Iyer",    room:"R104", color:"#4aa87a" },
    { time:"12:30–1:15", subject:"Lunch",       teacher:"",            room:"",     color:"#78788c" },
    { time:"1:15–2:00",  subject:"Physics Lab", teacher:"Ms. Sharma",  room:"Lab1", color:"#4b9fd4" },
  ]},
  { day:"Tuesday",   periods:[
    { time:"8:00–8:45",  subject:"Chemistry",   teacher:"Mr. Khan",    room:"R103", color:"#8f7dd6" },
    { time:"8:45–9:30",  subject:"Mathematics", teacher:"Mr. Verma",   room:"R101", color:"#5b7ef5" },
    { time:"9:30–10:15", subject:"Break",       teacher:"",            room:"",     color:"#78788c" },
    { time:"10:15–11:00",subject:"Biology",     teacher:"Ms. Iyer",    room:"R104", color:"#4aa87a" },
    { time:"11:00–11:45",subject:"Physics",     teacher:"Ms. Sharma",  room:"Lab1", color:"#4b9fd4" },
    { time:"11:45–12:30",subject:"English",     teacher:"Ms. Patel",   room:"R201", color:"#c08a3a" },
    { time:"12:30–1:15", subject:"Lunch",       teacher:"",            room:"",     color:"#78788c" },
    { time:"1:15–2:00",  subject:"Mathematics", teacher:"Mr. Verma",   room:"R101", color:"#5b7ef5" },
  ]},
  { day:"Wednesday", periods:[
    { time:"8:00–8:45",  subject:"Physics",     teacher:"Ms. Sharma",  room:"Lab1", color:"#4b9fd4" },
    { time:"8:45–9:30",  subject:"Biology",     teacher:"Ms. Iyer",    room:"R104", color:"#4aa87a" },
    { time:"9:30–10:15", subject:"Break",       teacher:"",            room:"",     color:"#78788c" },
    { time:"10:15–11:00",subject:"Mathematics", teacher:"Mr. Verma",   room:"R101", color:"#5b7ef5" },
    { time:"11:00–11:45",subject:"Chemistry",   teacher:"Mr. Khan",    room:"Lab2", color:"#8f7dd6" },
    { time:"11:45–12:30",subject:"English",     teacher:"Ms. Patel",   room:"R201", color:"#c08a3a" },
    { time:"12:30–1:15", subject:"Lunch",       teacher:"",            room:"",     color:"#78788c" },
    { time:"1:15–2:00",  subject:"Free Period", teacher:"",            room:"",     color:"#78788c" },
  ]},
  { day:"Thursday",  periods:[
    { time:"8:00–8:45",  subject:"English",     teacher:"Ms. Patel",   room:"R201", color:"#c08a3a" },
    { time:"8:45–9:30",  subject:"Chemistry",   teacher:"Mr. Khan",    room:"R103", color:"#8f7dd6" },
    { time:"9:30–10:15", subject:"Break",       teacher:"",            room:"",     color:"#78788c" },
    { time:"10:15–11:00",subject:"Physics",     teacher:"Ms. Sharma",  room:"Lab1", color:"#4b9fd4" },
    { time:"11:00–11:45",subject:"Mathematics", teacher:"Mr. Verma",   room:"R101", color:"#5b7ef5" },
    { time:"11:45–12:30",subject:"Biology",     teacher:"Ms. Iyer",    room:"R104", color:"#4aa87a" },
    { time:"12:30–1:15", subject:"Lunch",       teacher:"",            room:"",     color:"#78788c" },
    { time:"1:15–2:00",  subject:"Chemistry Lab",teacher:"Mr. Khan",   room:"Lab2", color:"#8f7dd6" },
  ]},
  { day:"Friday",    periods:[
    { time:"8:00–8:45",  subject:"Biology",     teacher:"Ms. Iyer",    room:"R104", color:"#4aa87a" },
    { time:"8:45–9:30",  subject:"Physics",     teacher:"Ms. Sharma",  room:"Lab1", color:"#4b9fd4" },
    { time:"9:30–10:15", subject:"Break",       teacher:"",            room:"",     color:"#78788c" },
    { time:"10:15–11:00",subject:"English",     teacher:"Ms. Patel",   room:"R201", color:"#c08a3a" },
    { time:"11:00–11:45",subject:"Mathematics", teacher:"Mr. Verma",   room:"R101", color:"#5b7ef5" },
    { time:"11:45–12:30",subject:"Chemistry",   teacher:"Mr. Khan",    room:"R103", color:"#8f7dd6" },
    { time:"12:30–1:15", subject:"Lunch",       teacher:"",            room:"",     color:"#78788c" },
    { time:"1:15–2:00",  subject:"PTM / Assembly", teacher:"",         room:"Hall", color:"#78788c" },
  ]},
];

export const calendarEvents = [
  { id:"ce1",  date:"2025-06-03", title:"Math Unit Test",              subject:"Mathematics", type:"test",     color:"#5b7ef5" },
  { id:"ce2",  date:"2025-06-05", title:"Chemistry Assignment Due",    subject:"Chemistry",   type:"deadline", color:"#8f7dd6" },
  { id:"ce3",  date:"2025-06-07", title:"Science Exhibition",          subject:"",            type:"event",    color:"#c08a3a" },
  { id:"ce4",  date:"2025-06-09", title:"Physics Lab Practical",       subject:"Physics",     type:"test",     color:"#4b9fd4" },
  { id:"ce5",  date:"2025-06-11", title:"Holiday — School Closed",     subject:"",            type:"holiday",  color:"#78788c" },
  { id:"ce6",  date:"2025-06-12", title:"Biology Quiz",                subject:"Biology",     type:"test",     color:"#4aa87a" },
  { id:"ce7",  date:"2025-06-14", title:"Organic Chemistry Due",       subject:"Chemistry",   type:"deadline", color:"#8f7dd6" },
  { id:"ce8",  date:"2025-06-15", title:"Integration Assignment Due",  subject:"Mathematics", type:"deadline", color:"#5b7ef5" },
  { id:"ce9",  date:"2025-06-16", title:"Wave Optics Assignment Due",  subject:"Physics",     type:"deadline", color:"#4b9fd4" },
  { id:"ce10", date:"2025-06-18", title:"Mid-Term Examination Begins", subject:"",            type:"exam",     color:"#cc5069" },
  { id:"ce11", date:"2025-06-19", title:"Math Mid-Term",               subject:"Mathematics", type:"exam",     color:"#cc5069" },
  { id:"ce12", date:"2025-06-20", title:"Physics Mid-Term",            subject:"Physics",     type:"exam",     color:"#cc5069" },
  { id:"ce13", date:"2025-06-21", title:"Chemistry Mid-Term",          subject:"Chemistry",   type:"exam",     color:"#cc5069" },
  { id:"ce14", date:"2025-06-23", title:"Biology Mid-Term",            subject:"Biology",     type:"exam",     color:"#cc5069" },
  { id:"ce15", date:"2025-06-24", title:"English Mid-Term",            subject:"English",     type:"exam",     color:"#cc5069" },
  { id:"ce16", date:"2025-06-26", title:"Parent-Teacher Meeting",      subject:"",            type:"event",    color:"#c08a3a" },
  { id:"ce17", date:"2025-06-28", title:"Annual Sports Day",           subject:"",            type:"event",    color:"#4aa87a" },
];

export const tests = [
  { id:"t1", title:"Mathematics Mid-Term",    subject:"Mathematics", type:"mid-term",  date:"Jun 19", totalMarks:80, scored:68, rank:3,  totalStudents:48, avgScore:52, topScore:76, status:"graded",   topics:["Integration","Matrices","Differential Equations"] },
  { id:"t2", title:"Physics Unit Test 2",     subject:"Physics",     type:"unit-test", date:"Jun 9",  totalMarks:30, scored:26, rank:5,  totalStudents:48, avgScore:19, topScore:29, status:"graded",   topics:["Optics","Waves","Sound"] },
  { id:"t3", title:"Chemistry Quiz 3",        subject:"Chemistry",   type:"quiz",      date:"Jun 3",  totalMarks:20, scored:13, rank:12, totalStudents:48, avgScore:14, topScore:20, status:"graded",   topics:["Organic Chemistry","Isomerism"] },
  { id:"t4", title:"Biology Quiz 2",          subject:"Biology",     type:"quiz",      date:"Jun 12", totalMarks:20, scored:null,rank:null,totalStudents:48, avgScore:null, topScore:null, status:"upcoming", topics:["Genetics","Heredity"] },
  { id:"t5", title:"English Unit Test 2",     subject:"English",     type:"unit-test", date:"Jun 22", totalMarks:50, scored:null,rank:null,totalStudents:48, avgScore:null, topScore:null, status:"upcoming", topics:["Grammar","Comprehension","Essay"] },
  { id:"t6", title:"Physics Mid-Term",        subject:"Physics",     type:"mid-term",  date:"Jun 20", totalMarks:80, scored:null,rank:null,totalStudents:48, avgScore:null, topScore:null, status:"upcoming", topics:["All chapters"] },
  { id:"t7", title:"Mathematics Unit Test 1", subject:"Mathematics", type:"unit-test", date:"May 20", totalMarks:30, scored:29, rank:1,  totalStudents:48, avgScore:21, topScore:29, status:"graded",   topics:["Limits","Continuity","Differentiation"] },
  { id:"t8", title:"Chemistry Unit Test 2",   subject:"Chemistry",   type:"unit-test", date:"May 28", totalMarks:30, scored:19, rank:14, totalStudents:48, avgScore:18, topScore:28, status:"graded",   topics:["Thermodynamics","Equilibrium"] },
];

export const todayMission = {
  practiceTarget:30, practiceDone:22,
  recoveryTarget:3,  recoveryDone:1,
  revisionTarget:5,  revisionDone:3,
  nextAction: { label:"Complete Recovery", page:"recovery", reason:"3 mistakes from Chemistry need your attention today." },
};
