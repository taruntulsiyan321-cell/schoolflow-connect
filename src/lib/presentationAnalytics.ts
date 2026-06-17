/**
 * Static demo enrichments for student Analysis — used only when PRESENTATION_MODE is on
 * and live hooks return sparse data. Realistic Class 12 scholastic content.
 */
import type { ConceptMasteryItem } from "@/hooks/useConceptMastery";
import type { PracticeSessionSummary, LeaderboardEntry } from "@/hooks/useAnalysisPageData";
import type {
  AnalyticsInsights,
  MistakeTopicAggregate,
  MomentumSignal,
  StudyPlanItem,
  TopicGapInsight,
} from "@/lib/analyticsInsights";

export const DEMO_MASTERY: ConceptMasteryItem[] = [
  { subject: "Mathematics", chapter: "Relations & Functions", concept: "Composition", mastery_score: 88, total_attempts: 14, correct_attempts: 12, recovery_attempts: 1, mistake_count: 0 },
  { subject: "Mathematics", chapter: "Matrices", concept: "Determinants", mastery_score: 76, total_attempts: 11, correct_attempts: 8, recovery_attempts: 2, mistake_count: 1 },
  { subject: "Mathematics", chapter: "Continuity", concept: "Limits", mastery_score: 71, total_attempts: 9, correct_attempts: 6, recovery_attempts: 1, mistake_count: 2 },
  { subject: "Mathematics", chapter: "Differentiation", concept: "Chain rule", mastery_score: 54, total_attempts: 8, correct_attempts: 4, recovery_attempts: 3, mistake_count: 3 },
  { subject: "Mathematics", chapter: "Integration", concept: "Substitution", mastery_score: 48, total_attempts: 7, correct_attempts: 3, recovery_attempts: 2, mistake_count: 4 },
  { subject: "Mathematics", chapter: "Vectors", concept: "Dot product", mastery_score: 82, total_attempts: 10, correct_attempts: 8, recovery_attempts: 0, mistake_count: 0 },
  { subject: "Physics", chapter: "Electrostatics", concept: "Coulomb's law", mastery_score: 79, total_attempts: 8, correct_attempts: 6, recovery_attempts: 1, mistake_count: 1 },
  { subject: "Physics", chapter: "Current", concept: "Kirchhoff", mastery_score: 62, total_attempts: 6, correct_attempts: 4, recovery_attempts: 2, mistake_count: 2 },
  { subject: "Physics", chapter: "Optics", concept: "Lens formula", mastery_score: 58, total_attempts: 5, correct_attempts: 3, recovery_attempts: 1, mistake_count: 2 },
  { subject: "Physics", chapter: "Modern Physics", concept: "Photoelectric", mastery_score: 85, total_attempts: 7, correct_attempts: 6, recovery_attempts: 0, mistake_count: 0 },
  { subject: "Chemistry", chapter: "Solutions", concept: "Raoult's law", mastery_score: 67, total_attempts: 5, correct_attempts: 3, recovery_attempts: 1, mistake_count: 1 },
  { subject: "Chemistry", chapter: "Electrochemistry", concept: "Nernst eq.", mastery_score: 41, total_attempts: 6, correct_attempts: 2, recovery_attempts: 2, mistake_count: 3 },
];

export const DEMO_TOPIC_GAPS: TopicGapInsight[] = [
  {
    topic: "Chain rule applications",
    chapter: "Continuity & Differentiability",
    subject: "Mathematics",
    concept: "Chain rule",
    severity: "critical",
    misconception: "Forgetting inner derivative when differentiating composite functions",
    why_weak: "Repeated slips on nested functions — outer derivative applied without inner factor.",
    root_cause: "Procedural gap: chain rule steps not automated under time pressure.",
    error_pattern: "Missing inner derivative",
    fix_hint: "Run 3 micro-drills: identify inner/outer, then differentiate layer by layer.",
    micro_drills: [
      "Differentiate sin(x²) — write u and du explicitly",
      "Find dy/dx for e^(3x+1) in two clear steps",
      "Apply chain rule to √(1 + tan x) without skipping layers",
    ],
    evidence: "Selected 2x instead of 2x·cos(x²) on a composite limit question",
    ncert_ref: "NCERT Ch. 5 · Ex. 5.5 Q12",
    mistake_count: 4,
  },
  {
    topic: "Definite integration by substitution",
    chapter: "Integrals",
    subject: "Mathematics",
    concept: "Substitution",
    severity: "moderate",
    misconception: "Limits not updated after substitution",
    why_weak: "Correct antiderivative found but evaluation at wrong bounds.",
    root_cause: "Conceptual: substitution changes the variable — limits must follow.",
    error_pattern: "Limit mismatch after u-sub",
    fix_hint: "Always rewrite limits in u before evaluating; pair with Recovery set.",
    micro_drills: [
      "∫₀¹ 2x·√(1+x²) dx — track u and new limits",
      "Spot-check bounds on one substitution per session",
    ],
    evidence: "Used original 0–1 limits after u = 1 + x²",
    ncert_ref: "NCERT Ch. 7 · Ex. 7.10",
    mistake_count: 3,
  },
  {
    topic: "Kirchhoff junction rule",
    chapter: "Current Electricity",
    subject: "Physics",
    concept: "Kirchhoff",
    severity: "mild",
    misconception: "Sign convention for current direction",
    why_weak: "Junction counts correct but branch signs flipped.",
    root_cause: "Careless diagram labelling under multi-loop circuits.",
    fix_hint: "Redraw circuit with assumed directions; verify KCL at one junction.",
    evidence: "I₃ counted as outflow when arrow pointed in",
    ncert_ref: "NCERT Ch. 3 · Ex. 3.15",
    mistake_count: 2,
  },
];

export const DEMO_AGGREGATES: MistakeTopicAggregate[] = [
  {
    topic: "Chain rule",
    chapter: "Differentiation",
    subject: "Mathematics",
    concept: "Chain rule",
    mistake_count: 4,
    total_wrong: 4,
    sample_question: "Find d/dx of sin(3x²)",
    sample_wrong: "cos(3x²)",
    sample_correct: "6x·cos(3x²)",
    last_seen: new Date(Date.now() - 86400000).toISOString(),
  },
  {
    topic: "Substitution",
    chapter: "Integrals",
    subject: "Mathematics",
    concept: "Substitution",
    mistake_count: 3,
    total_wrong: 3,
    sample_question: "∫ x·√(1+x²) dx from 0 to 1",
    sample_wrong: "Evaluated at 0–1 after u-sub",
    sample_correct: "Change limits to 1–2 in u",
    last_seen: new Date(Date.now() - 172800000).toISOString(),
  },
  {
    topic: "Kirchhoff",
    chapter: "Current Electricity",
    subject: "Physics",
    concept: "Kirchhoff",
    mistake_count: 2,
    total_wrong: 2,
    sample_question: "Junction at node B — find I₃",
    sample_wrong: "I₃ = 2 A (wrong sign)",
    sample_correct: "I₃ = −2 A",
    last_seen: new Date(Date.now() - 259200000).toISOString(),
  },
  {
    topic: "Nernst equation",
    chapter: "Electrochemistry",
    subject: "Chemistry",
    concept: "Nernst eq.",
    mistake_count: 2,
    total_wrong: 2,
    sample_question: "E°cell at non-standard conditions",
    sample_wrong: "Used E° without ln Q",
    sample_correct: "E = E° − (RT/nF) ln Q",
    last_seen: new Date(Date.now() - 345600000).toISOString(),
  },
];

export const DEMO_COACH_INSIGHTS: string[] = [
  "Chain rule slips cluster on nested trig — drill inner/outer identification first.",
  "Integration errors are mostly limit updates after substitution, not antiderivatives.",
  "Physics circuit mistakes are sign conventions — redraw before solving.",
  "Recovery completion is at 68% — finish pending drills to strengthen weak concepts.",
];

export const DEMO_WEEKLY_PLAN: StudyPlanItem[] = [
  { priority: 1, topic: "Chain rule", chapter: "Differentiation", subject: "Mathematics", time_minutes: 25, action: "3 micro-drills + 5 Recovery questions" },
  { priority: 2, topic: "Substitution", chapter: "Integrals", subject: "Mathematics", time_minutes: 20, action: "Limit-tracking worksheet + 4 practice items" },
  { priority: 3, topic: "Kirchhoff", chapter: "Current Electricity", subject: "Physics", time_minutes: 15, action: "Redraw 2 circuits; verify KCL at each junction" },
];

export const DEMO_MOMENTUM: MomentumSignal[] = [
  { topic: "Vectors", subject: "Mathematics", direction: "improving", note: "Accuracy up 12% over last 3 sessions" },
  { topic: "Chain rule", subject: "Mathematics", direction: "slipping", note: "2 new slips this week — Recovery recommended" },
  { topic: "Photoelectric effect", subject: "Physics", direction: "improving", note: "Consistent 90%+ on concept checks" },
];

export const DEMO_SESSIONS: PracticeSessionSummary[] = [
  { id: "demo-1", subject: "Mathematics", chapter: "Differentiation", question_count: 10, correct_count: 7, score: 70, created_at: new Date(Date.now() - 3600000).toISOString(), finished_at: new Date(Date.now() - 1800000).toISOString(), duration_minutes: 18, accuracy_pct: 70 },
  { id: "demo-2", subject: "Physics", chapter: "Current Electricity", question_count: 8, correct_count: 6, score: 75, created_at: new Date(Date.now() - 86400000).toISOString(), finished_at: new Date(Date.now() - 82800000).toISOString(), duration_minutes: 14, accuracy_pct: 75 },
  { id: "demo-3", subject: "Mathematics", chapter: "Integrals", question_count: 12, correct_count: 8, score: 67, created_at: new Date(Date.now() - 172800000).toISOString(), finished_at: new Date(Date.now() - 169200000).toISOString(), duration_minutes: 22, accuracy_pct: 67 },
  { id: "demo-4", subject: "Chemistry", chapter: "Electrochemistry", question_count: 6, correct_count: 4, score: 67, created_at: new Date(Date.now() - 259200000).toISOString(), finished_at: new Date(Date.now() - 255600000).toISOString(), duration_minutes: 11, accuracy_pct: 67 },
];

export const DEMO_LEADERBOARD: LeaderboardEntry[] = [
  { user_id: "peer-1", full_name: "Aanya Sharma", roll_number: "12A-04", score: 2840, rank: 1 },
  { user_id: "peer-2", full_name: "Rohan Mehta", roll_number: "12A-11", score: 2710, rank: 2 },
  { user_id: "peer-3", full_name: "Priya Nair", roll_number: "12A-07", score: 2590, rank: 3 },
  { user_id: "peer-4", full_name: "Vikram Das", roll_number: "12A-19", score: 2480, rank: 4 },
  { user_id: "peer-5", full_name: "Sneha Patel", roll_number: "12A-02", score: 2350, rank: 5 },
];

export const DEMO_INSIGHTS: AnalyticsInsights = {
  headline: "Chain rule is your highest-leverage fix this week",
  summary: "Differentiation slips are procedural, not conceptual — targeted drills should lift accuracy quickly.",
  diagnosis: "Most errors trace to missing inner derivatives and rushed substitution steps. Physics circuit signs are secondary.",
  today_focus: "15 min chain rule micro-drills, then 5 Recovery questions on Integration.",
  error_patterns: ["Missing inner derivative", "Limit mismatch after u-sub", "KCL sign convention"],
  recurring_errors: [
    { label: "Chain rule — inner derivative omitted", subjects: ["Mathematics"], explanation: "Composite functions need explicit u/du tracking." },
  ],
  weak_topics: DEMO_TOPIC_GAPS,
  weak_concepts: DEMO_TOPIC_GAPS,
  strong_concepts: [
    { concept: "Composition of functions", subject: "Mathematics", note: "92% accuracy over 14 attempts" },
    { concept: "Photoelectric effect", subject: "Physics", note: "Consistent mastery in last 3 sessions" },
  ],
  study_priority: ["Chain rule", "Substitution", "Kirchhoff"],
  weekly_plan: DEMO_WEEKLY_PLAN,
  momentum: DEMO_MOMENTUM,
  next_steps: ["Complete Recovery set", "Run Revision on Integrals"],
  source: "rule",
};

export function demoPracticeTrend(): { date: string; score_pct: number }[] {
  const days = 14;
  const base = 62;
  return Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    const bump = i > 8 ? (i - 8) * 2.5 : 0;
    const jitter = (i % 3) - 1;
    return {
      date: d.toISOString().slice(0, 10),
      score_pct: Math.min(92, Math.round(base + bump + jitter)),
    };
  });
}

export function demoConsistencyHeatmap(): { date: string; total: number; minutes: number }[] {
  return Array.from({ length: 84 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (83 - i));
    const day = d.getDay();
    const weekend = day === 0 || day === 6;
    const total = weekend ? (i % 4 === 0 ? 2 : 0) : Math.max(0, (i % 7) + (i % 3));
    return { date: d.toISOString().slice(0, 10), total, minutes: total * 12 };
  });
}
