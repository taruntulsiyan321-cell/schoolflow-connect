import type { ConceptMasteryItem } from "@/hooks/useConceptMastery";
import type { RecoverySessionResultState } from "@/lib/recoverySessionSnapshot";
import { practiceAccuracyFromSnapshot } from "@/lib/learningMetrics";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";

export type MetricPair = { before: number; after: number; label: string };

export type ConceptImprovement = { name: string; before: number; after: number };

export type JourneyStage = {
  id: string;
  label: string;
  description: string;
  completed: boolean;
};

export type SuccessHistoryItem = { topic: string; gain: number; completedAt: string };

export type RecoveryCompletionReport = {
  assignmentId: string;
  subject: string;
  chapter: string;
  concept: string;
  completedAt: string;
  hero: {
    questionsCompleted: number;
    recoveryAccuracy: number;
    masteryBefore: number;
    masteryAfter: number;
  };
  beforeAfter: MetricPair[];
  conceptImprovements: ConceptImprovement[];
  recoveryImpact: {
    overallAccuracy: MetricPair;
    practiceAccuracy: MetricPair;
    weakConceptsFixed: number;
    masteryScoreIncrease: number;
  };
  academicHealth: MetricPair;
  journey: JourneyStage[];
  conceptStatus: {
    mastered: string[];
    improving: string[];
    needsRecovery: string[];
  };
  successHistory: SuccessHistoryItem[];
  coach: {
    headline: string;
    bullets: string[];
    focusNext: string;
  };
  whatsNext: {
    nextRecovery: string;
    nextRevision: string;
    nextPractice: string;
    potentialGain: number;
  };
  achievements: { id: string; label: string; description: string; earned: boolean }[];
};

const SUCCESS_HISTORY_KEY = "recovery-success-history";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function findMastery(
  mastery: ConceptMasteryItem[],
  concept: string,
  chapter?: string,
): ConceptMasteryItem | undefined {
  const c = concept.toLowerCase();
  return (
    mastery.find((m) => m.concept.toLowerCase() === c) ??
    mastery.find((m) => m.concept.toLowerCase().includes(c) || c.includes(m.concept.toLowerCase())) ??
    mastery.find((m) => chapter && m.chapter?.toLowerCase() === chapter.toLowerCase())
  );
}

/** Related concepts from real mastery rows only — current scores, no invented gains. */
function relatedConcepts(
  mastery: ConceptMasteryItem[],
  concept: string,
  chapter: string,
): ConceptImprovement[] {
  const chapterItems = mastery.filter((m) => {
    if (chapter && (m.chapter ?? "").toLowerCase().includes(chapter.toLowerCase())) return true;
    const c = concept.toLowerCase();
    return m.concept.toLowerCase() !== c && (
      m.concept.toLowerCase().includes(c) || c.includes(m.concept.toLowerCase())
    );
  });

  return chapterItems.slice(0, 5).map((item) => {
    const score = clamp(item.mastery_score, 0, 100);
    return { name: item.concept, before: score, after: score };
  });
}

export function appendSuccessHistory(entry: SuccessHistoryItem): void {
  try {
    const raw = localStorage.getItem(SUCCESS_HISTORY_KEY);
    const list: SuccessHistoryItem[] = raw ? JSON.parse(raw) : [];
    const filtered = list.filter((e) => e.topic !== entry.topic);
    filtered.unshift(entry);
    localStorage.setItem(SUCCESS_HISTORY_KEY, JSON.stringify(filtered.slice(0, 8)));
  } catch {
    /* ignore */
  }
}

export function readSuccessHistory(): SuccessHistoryItem[] {
  try {
    const raw = localStorage.getItem(SUCCESS_HISTORY_KEY);
    return raw ? (JSON.parse(raw) as SuccessHistoryItem[]) : [];
  } catch {
    return [];
  }
}

export function buildRecoveryCompletionReport(opts: {
  state: RecoverySessionResultState;
  mastery: ConceptMasteryItem[];
  snapshot: AcademicSnapshot | null;
  weakConcepts?: { concept: string; mastery_score?: number }[];
  nextWeakConcept?: string;
}): RecoveryCompletionReport {
  const { state, mastery, snapshot, weakConcepts = [], nextWeakConcept } = opts;
  const attempts = state.attempts;
  const total = attempts.length;
  const correct = attempts.filter((a) => a.isCorrect).length;
  const recoveryAccuracy = total ? Math.round((correct / total) * 100) : 0;

  const chapter = state.chapter ?? state.concept;
  const concept = state.concept;
  const m = findMastery(mastery, concept, chapter);

  // Honest mastery: current DB score only (no seed-based invented before/after).
  const masteryAfter = m ? clamp(m.mastery_score, 0, 100) : 0;
  const masteryBefore = masteryAfter;

  const practiceAcc = practiceAccuracyFromSnapshot(snapshot);
  const conceptImprovements = relatedConcepts(mastery, concept, chapter);

  const mastered = conceptImprovements.filter((c) => c.after >= 80).map((c) => c.name);
  const improving = conceptImprovements.filter((c) => c.after >= 60 && c.after < 80).map((c) => c.name);
  const needsRecovery = [
    ...conceptImprovements.filter((c) => c.after < 60).map((c) => c.name),
    ...weakConcepts
      .filter((w) => w.concept !== concept && (w.mastery_score ?? 0) < 60)
      .map((w) => w.concept),
  ].filter((v, i, arr) => arr.indexOf(v) === i);

  const completedAt = new Date().toISOString();
  const historyEntry: SuccessHistoryItem = {
    topic: concept,
    gain: 0,
    completedAt,
  };
  const priorHistory = readSuccessHistory().filter((h) => h.topic !== concept);
  const successHistory = [historyEntry, ...priorHistory].slice(0, 5);

  const nextRecovery =
    nextWeakConcept ??
    weakConcepts.find((w) => w.concept !== concept)?.concept ??
    "";

  const coachHeadline =
    recoveryAccuracy >= 75
      ? `Strong recovery session on ${concept} — ${recoveryAccuracy}% accuracy.`
      : recoveryAccuracy >= 50
        ? `You completed recovery for ${concept} at ${recoveryAccuracy}% accuracy.`
        : `Recovery for ${concept} finished — review misses and keep practicing.`;

  const coachBullets = [
    `You answered ${correct} of ${total} correctly this session (${recoveryAccuracy}%).`,
    m
      ? `Current mastery on this concept is ${masteryAfter}% (from your academic profile).`
      : `Mastery for this concept will update as more graded attempts are recorded.`,
    needsRecovery[0]
      ? `Still weak nearby: ${needsRecovery[0]}.`
      : nextRecovery
        ? `Next weak area in your queue: ${nextRecovery}.`
        : `No other weak concepts currently flagged.`,
  ];

  const focusNext = needsRecovery[0]
    ? `Focus next on ${needsRecovery[0]}.`
    : nextRecovery
      ? `Focus next on ${nextRecovery}.`
      : `Continue practice in ${chapter || state.subject} or open Nova for a targeted review.`;

  // Session milestones from real attempt counts — not student_badges unlocks.
  const achievements = [
    {
      id: "streak",
      label: "Recovery streak",
      description: "2+ recovery sessions logged on this device",
      earned: successHistory.length >= 2,
    },
    {
      id: "mastery",
      label: "Accurate session",
      description: "75%+ on this recovery session",
      earned: recoveryAccuracy >= 75,
    },
    {
      id: "conqueror",
      label: "Strong mastery",
      description: "Concept mastery at or above 85%",
      earned: masteryAfter >= 85,
    },
    {
      id: "weakness",
      label: "Session complete",
      description: "Finished every assigned recovery question",
      earned: total > 0,
    },
  ];

  const journey: JourneyStage[] = [
    { id: "detected", label: "Weakness Detected", description: `${concept} flagged from practice mistakes`, completed: true },
    { id: "assigned", label: "Questions Assigned", description: `${total} recovery questions in this session`, completed: true },
    { id: "started", label: "Recovery Started", description: state.startedAt ? new Date(state.startedAt).toLocaleString() : "Session began", completed: true },
    { id: "completed", label: "Recovery Completed", description: `${recoveryAccuracy}% session accuracy`, completed: true },
    { id: "improved", label: "Profile mastery", description: m ? `Current mastery ${masteryAfter}%` : "Mastery pending more graded attempts", completed: !!m },
    { id: "achieved", label: "Session goal", description: recoveryAccuracy >= 70 ? "Hit 70%+ session accuracy" : "Keep practicing to raise session accuracy", completed: recoveryAccuracy >= 70 },
  ];

  const healthScore = clamp(
    (recoveryAccuracy + (m ? masteryAfter : practiceAcc || recoveryAccuracy) + (practiceAcc || recoveryAccuracy)) / 3,
    0,
    100,
  );

  return {
    assignmentId: state.assignmentId,
    subject: state.subject,
    chapter,
    concept,
    completedAt,
    hero: {
      questionsCompleted: total,
      recoveryAccuracy,
      masteryBefore,
      masteryAfter,
    },
    beforeAfter: [
      { label: "Session accuracy", before: 0, after: recoveryAccuracy },
      { label: "Concept mastery", before: masteryBefore, after: masteryAfter },
      { label: "Practice accuracy", before: practiceAcc, after: practiceAcc },
    ],
    conceptImprovements,
    recoveryImpact: {
      overallAccuracy: {
        label: `Overall ${state.subject} practice accuracy`,
        before: practiceAcc,
        after: practiceAcc,
      },
      practiceAccuracy: {
        label: "Practice accuracy",
        before: practiceAcc,
        after: practiceAcc,
      },
      weakConceptsFixed: masteryAfter >= 60 ? 1 : 0,
      masteryScoreIncrease: 0,
    },
    academicHealth: { label: "Session health (accuracy + mastery)", before: healthScore, after: healthScore },
    journey,
    conceptStatus: { mastered, improving, needsRecovery },
    successHistory: successHistory.slice(0, 5),
    coach: { headline: coachHeadline, bullets: coachBullets, focusNext },
    whatsNext: {
      nextRecovery: nextRecovery || "None queued",
      nextRevision: chapter || concept,
      nextPractice: chapter || state.subject,
      potentialGain: 0,
    },
    achievements,
  };
}

export function formatDelta(before: number, after: number): string {
  if (before === after) return `${after}%`;
  return `${before}% → ${after}%`;
}

export function deltaPositive(before: number, after: number): number {
  return after - before;
}
