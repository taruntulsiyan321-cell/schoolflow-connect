/**
 * Honest empty student shape for Gurukul chrome.
 * Never use mock Arjun / invented XP as a fallback.
 * XP / level / study streak: ProgressionService (rpc_get_student_progression).
 * Accuracy: academic snapshot exam_readiness.accuracy_pct only (no charts/mastery dual path).
 */
export type GurukulStudentProfile = {
  name: string;
  firstName: string;
  class: string;
  rollNo: string;
  section: string;
  avatar: string;
  xp: number;
  level: number;
  /** XP remaining to next level (engine). */
  xpToNext: number;
  /** XP earned within current level (engine). */
  xpIntoLevel: number;
  /** 0–100 progress within level (engine). */
  levelProgressPct: number;
  league: string;
  reputation: number;
  streak: number;
  rank: number;
  totalStudents: number;
  accuracy: number;
  attendance: number;
  totalQuestions: number;
  correctAnswers: number;
  sessionsThisWeek: number;
  avgSpeed: number;
  goal: string;
};

export const EMPTY_STUDENT: GurukulStudentProfile = {
  name: "Student",
  firstName: "Student",
  class: "",
  rollNo: "",
  section: "",
  avatar: "ST",
  xp: 0,
  level: 1,
  xpToNext: 100,
  xpIntoLevel: 0,
  levelProgressPct: 0,
  league: "",
  reputation: 0,
  streak: 0,
  rank: 0,
  totalStudents: 0,
  accuracy: 0,
  attendance: 0,
  totalQuestions: 0,
  correctAnswers: 0,
  sessionsThisWeek: 0,
  avgSpeed: 0,
  goal: "",
};
