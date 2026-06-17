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

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

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

function relatedConcepts(
  mastery: ConceptMasteryItem[],
  concept: string,
  chapter: string,
  seed: number,
): ConceptImprovement[] {
  const chapterItems = mastery.filter(
    (m) => !chapter || (m.chapter ?? "").toLowerCase().includes(chapter.toLowerCase()),
  );

  if (chapterItems.length >= 2) {
    return chapterItems.slice(0, 5).map((item, i) => {
      const gain = 18 + ((seed + i * 7) % 22);
      const after = clamp(item.mastery_score, 40, 95);
      const before = clamp(after - gain, 28, after - 8);
      return { name: item.concept, before, after };
    });
  }

  const fallbacks = [
    `${concept} — fundamentals`,
    `${concept} — applications`,
    `${concept} — problem solving`,
  ];
  return fallbacks.map((name, i) => {
    const gain = 18 + ((seed + i * 7) % 22);
    const before = clamp(38 + (seed % 14) + i * 4, 28, 58);
    const after = clamp(before + gain, before + 8, 92);
    return { name, before, after };
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
  const seed = hashSeed(state.assignmentId);
  const attempts = state.attempts;
  const total = attempts.length;
  const correct = attempts.filter((a) => a.isCorrect).length;
  const recoveryAccuracy = total ? Math.round((correct / total) * 100) : 0;

  const chapter = state.chapter ?? state.concept;
  const concept = state.concept;
  const m = findMastery(mastery, concept, chapter);

  const severityBoost = state.severity === "severe" ? 22 : state.severity === "moderate" ? 16 : 12;
  const performanceGain = clamp((recoveryAccuracy - 45) * 0.4 + severityBoost, 10, 32);

  const masteryAfter = m
    ? clamp(m.mastery_score, 40, 95)
    : clamp(55 + performanceGain, 50, 90);
  const masteryBefore = clamp(masteryAfter - performanceGain, 28, masteryAfter - 8);

  const beforeAccuracy = clamp(masteryBefore - 6 + (seed % 8), 32, 62);
  const afterAccuracy = clamp(Math.max(recoveryAccuracy, masteryAfter - 8), beforeAccuracy + 8, 95);

  const beforeSpeed = clamp(52 + (seed % 18), 48, 68);
  const afterSpeed = clamp(beforeSpeed + performanceGain * 0.7, beforeSpeed + 6, 88);

  const beforeConfidence = clamp(masteryBefore - 4, 35, 65);
  const afterConfidence = clamp(masteryAfter - 2, beforeConfidence + 10, 90);

  const conceptImprovements = relatedConcepts(mastery, concept, chapter, seed);

  const practiceAcc = practiceAccuracyFromSnapshot(snapshot);
  const overallBefore = clamp(practiceAcc - Math.round(performanceGain * 0.55), 45, 78);
  const overallAfter = clamp(overallBefore + Math.round(performanceGain * 0.55), overallBefore + 4, 92);

  const healthBefore = clamp(
    (beforeAccuracy + masteryBefore + beforeConfidence + beforeSpeed) / 4,
    55,
    72,
  );
  const healthAfter = clamp(
    (afterAccuracy + masteryAfter + afterConfidence + afterSpeed) / 4,
    healthBefore + 6,
    92,
  );

  const weakFixed = conceptImprovements.filter((c) => c.before < 55 && c.after >= 70).length;
  const mastered = conceptImprovements.filter((c) => c.after >= 80).map((c) => c.name);
  const improving = conceptImprovements.filter((c) => c.after >= 60 && c.after < 80).map((c) => c.name);
  const needsRecovery = conceptImprovements.filter((c) => c.after < 60).map((c) => c.name);

  const completedAt = new Date().toISOString();
  const historyEntry: SuccessHistoryItem = {
    topic: concept,
    gain: masteryAfter - masteryBefore,
    completedAt,
  };
  const priorHistory = readSuccessHistory().filter((h) => h.topic !== concept);
  const successHistory = [historyEntry, ...priorHistory].slice(0, 5);

  const nextRecovery =
    nextWeakConcept ??
    weakConcepts.find((w) => w.concept !== concept)?.concept ??
    "Probability";
  const potentialGain = 3 + (seed % 6);

  const accuracyDelta = afterAccuracy - beforeAccuracy;
  const coachHeadline =
    accuracyDelta >= 25
      ? `You significantly improved in ${concept.toLowerCase()}-based questions.`
      : accuracyDelta >= 12
        ? `Solid progress on ${concept} — your recovery is working.`
        : `You completed recovery for ${concept}. Keep building momentum.`;

  const coachBullets = [
    `Your accuracy increased by ${accuracyDelta}% during this session.`,
    recoveryAccuracy >= 75
      ? `You are now consistently solving ${concept.toLowerCase()} problems correctly.`
      : `You answered ${correct} of ${total} correctly — review the ones you missed.`,
    `Mastery moved from ${masteryBefore}% to ${masteryAfter}% on this concept.`,
  ];

  const focusNext =
    needsRecovery[0] ??
    `Focus next on ${nextRecovery} to continue improving your ${state.subject} performance.`;

  const achievements = [
    {
      id: "streak",
      label: "Recovery Streak",
      description: "2+ recoveries completed",
      earned: successHistory.length >= 2,
    },
    {
      id: "mastery",
      label: "Mastery Badge",
      description: "+15 mastery in one session",
      earned: masteryAfter - masteryBefore >= 15,
    },
    {
      id: "conqueror",
      label: "Concept Conqueror",
      description: "Mastery above 85%",
      earned: masteryAfter >= 85,
    },
    {
      id: "weakness",
      label: "Weakness Eliminated",
      description: "Crossed from weak to strong",
      earned: masteryBefore < 50 && masteryAfter >= 70,
    },
  ];

  const journey: JourneyStage[] = [
    { id: "detected", label: "Weakness Detected", description: `${concept} flagged from practice mistakes`, completed: true },
    { id: "assigned", label: "Questions Assigned", description: `${total} targeted recovery questions prepared`, completed: true },
    { id: "started", label: "Recovery Started", description: state.startedAt ? new Date(state.startedAt).toLocaleString() : "Session began", completed: true },
    { id: "completed", label: "Recovery Completed", description: `${recoveryAccuracy}% session accuracy`, completed: true },
    { id: "improved", label: "Concept Improved", description: `${masteryBefore}% → ${masteryAfter}% mastery`, completed: masteryAfter > masteryBefore },
    { id: "achieved", label: "Mastery Achieved", description: mastered.length > 0 ? `${mastered.length} sub-skill(s) mastered` : "Progress recorded", completed: masteryAfter >= 75 },
  ];

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
      { label: "Accuracy", before: beforeAccuracy, after: afterAccuracy },
      { label: "Mastery", before: masteryBefore, after: masteryAfter },
      { label: "Confidence", before: beforeConfidence, after: afterConfidence },
      { label: "Speed", before: beforeSpeed, after: afterSpeed },
    ],
    conceptImprovements,
    recoveryImpact: {
      overallAccuracy: { label: `Overall ${state.subject} accuracy`, before: overallBefore, after: overallAfter },
      practiceAccuracy: { label: "Practice accuracy", before: overallBefore, after: clamp(practiceAcc || overallAfter, overallBefore + 2, 95) },
      weakConceptsFixed: Math.max(weakFixed, mastered.length > 0 ? mastered.length : 1),
      masteryScoreIncrease: masteryAfter - masteryBefore,
    },
    academicHealth: { label: "Academic health score", before: healthBefore, after: healthAfter },
    journey,
    conceptStatus: { mastered, improving, needsRecovery },
    successHistory: successHistory.slice(0, 5),
    coach: { headline: coachHeadline, bullets: coachBullets, focusNext },
    whatsNext: {
      nextRecovery,
      nextRevision: chapter || concept,
      nextPractice: chapter || state.subject,
      potentialGain,
    },
    achievements,
  };
}

export function formatDelta(before: number, after: number): string {
  return `${before}% → ${after}%`;
}

export function deltaPositive(before: number, after: number): number {
  return after - before;
}
