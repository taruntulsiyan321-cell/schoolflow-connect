import type { ConceptMasteryItem } from "@/hooks/useConceptMastery";
import type { PracticeSessionSummary } from "@/hooks/useAnalysisPageData";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { SubjectChartPoint } from "@/hooks/useStudentPerformanceCharts";
import type { MistakeTopicAggregate, TopicGapInsight } from "@/lib/analyticsInsights";

export type HeatmapLevel = "mastered" | "proficient" | "learning" | "review";

export function masteryLevel(item: ConceptMasteryItem): HeatmapLevel {
  if (item.mistake_count >= 3 || (item.mastery_score < 45 && item.total_attempts >= 2)) return "review";
  if (item.mastery_score >= 78 && item.mistake_count <= 1) return "mastered";
  if (item.mastery_score >= 62) return "proficient";
  return "learning";
}

export function shortLabel(text: string, max = 8): string {
  const words = text.trim().split(/\s+/);
  if (words.length === 1) return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  return words.map((w) => w[0]?.toUpperCase() ?? "").join("").slice(0, 4);
}

export type MistakeBucket = {
  key: string;
  label: string;
  count: number;
  pct: number;
  color: string;
};

/** Honest recurrence buckets from mistake counts — never invent calc/careless/rushed splits. */
export function classifyMistakes(aggregates: MistakeTopicAggregate[]): MistakeBucket[] {
  const total = aggregates.reduce((s, a) => s + a.mistake_count, 0);
  if (total === 0) return [];

  let recurring = 0;
  let oneOff = 0;
  let heavy = 0;

  for (const a of aggregates) {
    if (a.total_wrong >= 5 || a.mistake_count >= 4) heavy += a.mistake_count;
    else if (a.mistake_count >= 2) recurring += a.mistake_count;
    else oneOff += a.mistake_count;
  }

  const raw = [
    { key: "heavy", label: "Repeated weak topics", count: heavy, color: "#ba1a1a" },
    { key: "concept", label: "Recurring topic gaps", count: recurring, color: "#003324" },
    { key: "careless", label: "One-off mistakes", count: oneOff, color: "#7ebaa0" },
  ];

  return raw
    .filter((b) => b.count > 0)
    .map((b) => ({ ...b, pct: Math.round((100 * b.count) / total) }))
    .sort((a, b) => b.count - a.count);
}

export function subjectVulnerability(aggregates: MistakeTopicAggregate[]): { subject: string; count: number; pct: number }[] {
  const bySubject = new Map<string, number>();
  for (const a of aggregates) {
    bySubject.set(a.subject, (bySubject.get(a.subject) ?? 0) + a.mistake_count);
  }
  const max = Math.max(1, ...bySubject.values());
  return [...bySubject.entries()]
    .map(([subject, count]) => ({ subject, count, pct: Math.round((100 * count) / max) }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
}

export type PersonalBest = {
  kind: string;
  title: string;
  icon: "target" | "timer" | "flame";
};

export function buildPersonalBests(
  data: AcademicSnapshot,
  sessions: PracticeSessionSummary[],
  accuracy: number,
): PersonalBest[] {
  const items: PersonalBest[] = [];
  const bestSession = [...sessions].sort((a, b) => b.accuracy_pct - a.accuracy_pct)[0];
  if (bestSession && bestSession.accuracy_pct >= 70) {
    items.push({
      kind: "RECORD",
      title: `${bestSession.accuracy_pct}% in ${bestSession.chapter || bestSession.subject}`,
      icon: "target",
    });
  }
  const fastest = [...sessions]
    .filter((s) => s.question_count >= 5)
    .sort((a, b) => a.duration_minutes - b.duration_minutes)[0];
  if (fastest) {
    items.push({
      kind: "PACE",
      title: `Fastest session: ${fastest.duration_minutes} min (${fastest.correct_count}/${fastest.question_count})`,
      icon: "timer",
    });
  }
  const streak = data.xp?.current_streak ?? 0;
  if (streak >= 3) {
    items.push({
      kind: "STREAK",
      title: `${streak}-day practice streak`,
      icon: "flame",
    });
  }
  if (accuracy >= 80 && items.length < 3) {
    items.push({
      kind: "ACCURACY",
      title: `${accuracy}% overall accuracy`,
      icon: "target",
    });
  }
  return items.slice(0, 3);
}

/** Labels from the student's own subject accuracy only — never invent peer percentile from XP rank. */
export function peerBenchmarkSubjects(
  subjects: SubjectChartPoint[],
  _rank: number | null,
  _classSize: number,
): { name: string; pct: number; label: string }[] {
  return subjects.slice(0, 4).map((s) => {
    const pct = Math.round(s.accuracy);
    let label = "On track";
    if (pct >= 85) label = "Strong";
    else if (pct < 60) label = "Needs focus";
    else if (pct >= 75) label = "Solid";
    return { name: s.name, pct, label };
  });
}

export function pyramidStage(mastery: ConceptMasteryItem[], topicGaps: TopicGapInsight[]) {
  const mastered = mastery.filter((m) => m.mastery_score >= 75).length;
  const total = mastery.length || 1;
  const foundationalDone = mastered / total >= 0.5;
  const coreTopic = topicGaps[0]?.topic ?? mastery.find((m) => m.mastery_score < 65)?.concept ?? "Core topics";
  return { foundationalDone, coreTopic, mastered, total };
}

export type Milestone = { title: string; when: string; detail?: string; badge?: string };

export function buildMilestones(
  data: AcademicSnapshot,
  topicGaps: TopicGapInsight[],
  improvement: number | null,
): Milestone[] {
  const items: Milestone[] = [];
  const xp = data.xp?.xp ?? 0;
  const level = data.xp?.level ?? 1;
  // Only celebrate a level when the student has real XP progress (not Level 1 / 0 XP default).
  if (xp > 0 && level >= 2) {
    items.push({
      title: `Level ${level} reached`,
      when: "Recent",
      detail: `${xp.toLocaleString()} XP earned so far`,
      badge: level >= 10 ? "Dedicated learner" : undefined,
    });
  } else if (xp > 0) {
    items.push({
      title: `${xp.toLocaleString()} XP earned`,
      when: "Recent",
      detail: `Currently level ${level}`,
    });
  }
  if (improvement != null && improvement > 0) {
    items.push({
      title: `Accuracy up ${improvement}%`,
      when: "Latest sessions",
      detail: "Compared to your previous practice session",
    });
  }
  const overcome = masteryToOvercome(topicGaps);
  if (overcome) {
    items.push({
      title: `Working on: ${overcome}`,
      when: "This week",
      detail: "Recovery and NCERT revision recommended",
    });
  }
  return items.slice(0, 4);
}

function masteryToOvercome(gaps: TopicGapInsight[]): string | null {
  const mild = gaps.find((g) => g.severity === "mild" && g.mistake_count >= 2);
  return mild?.topic ?? gaps[0]?.topic ?? null;
}

export function consistencyGrid(heatmap: AcademicSnapshot["activity_heatmap"]) {
  const days = heatmap ?? [];
  const cells = days.slice(-84).map((d) => {
    const total = (d.dpp ?? 0) + (d.homework ?? 0) + (d.battles ?? 0) + (d.self_practice ?? 0);
    return { date: d.date, total, minutes: d.minutes ?? 0 };
  });
  return cells;
}

export function consistencyLevel(total: number): number {
  if (total === 0) return 0;
  if (total >= 8) return 4;
  if (total >= 5) return 3;
  if (total >= 2) return 2;
  return 1;
}
