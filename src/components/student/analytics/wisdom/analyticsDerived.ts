import type { PracticeSessionSummary } from "@/hooks/useAnalysisPageData";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { SubjectChartPoint } from "@/hooks/useStudentPerformanceCharts";
import type { MistakeTopicAggregate, TopicGapInsight } from "@/lib/analyticsInsights";
import { displayChapter, displaySubject } from "@/lib/academicDisplay";
import { accuracyBand, ACCURACY_LABEL, ACCURACY_CONCEPTUAL, STREAK_ESTABLISHED } from "@/academic/metrics/bands";

// RULING 1 — `masteryLevel` is deleted, not converged.
//
// It graded every concept on a mastery_score ladder at 45 / 62 / 78 and
// returned a "high" rung, which `MasterySection` counted and printed as
// "N at 78%+" beside the words "Your strongest concepts". Renaming the rungs
// had already been tried here — the comment that stood in this place explained
// that "high" and "steady" describe the figure rather than the child — and it
// did not help, because the violation was never the rung name. It was that
// something computed which concepts were the best ones and a screen counted
// them.
//
// §10.8: "nothing may compute a strength value and discard it. A value
// assembled upstream and silenced at the consumer is one refactor from being
// rendered again. Close it at the source." So it is closed at the source, along
// with `pyramidStage`, which computed `mastered / total >= 0.5` for a screen
// that no longer exists either. Both were exported and imported nowhere.
//
// What replaced them is the open-mistakes count, which is the same rows read
// from the side the product is allowed to look at: `mistake_count` per concept,
// already on every ConceptMasteryItem.

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
    const label = (a.subject ?? "").trim();
    if (!label || /^(subject|topic|daily|general|mixed|concept|chapter)$/i.test(label)) continue;
    bySubject.set(label, (bySubject.get(label) ?? 0) + a.mistake_count);
  }
  if (bySubject.size === 0) return [];
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
  if (bestSession && bestSession.accuracy_pct >= ACCURACY_CONCEPTUAL) {
    items.push({
      kind: "RECORD",
      title: `${bestSession.accuracy_pct}% in ${displayChapter(bestSession.chapter) || displaySubject(bestSession.subject) || "practice"}`,
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
  const streak = data.xp?.study_streak ?? 0;
  if (streak >= STREAK_ESTABLISHED) {
    items.push({
      kind: "STREAK",
      title: `${streak}-day practice streak`,
      icon: "flame",
    });
  }
  // RULING 2 — the accuracy milestone is REMOVED, and it is the celebration the
  // ruling went looking for. The three `accuracy < 100` sites turned out to be
  // suppression gates for corrective advice, not perfect-score praise; this was
  // the real thing, one boundary lower. A milestone that appears only when the
  // figure is high, titled with the figure, is "presenting a figure as an
  // achievement" and "filtering a list to the best of them" at once — both
  // sides of the §10.8 table.
  //
  // The number itself is not forbidden and has not gone anywhere: overall
  // accuracy is still shown, for every subject, high and low alike, banded by
  // `accuracyBand`. What is gone is the version that only appears when it
  // flatters.
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
    // CHUNK 10.5 — §10.8. The ladder used to top out at "Strong" and "Solid",
    // which tell a student what they are good at. It now uses the one band
    // module, whose top rung is "On track" — a statement about the figure, not
    // about the child. The boundaries come with it, so this screen can no longer
    // disagree with the one beside it.
    const label = ACCURACY_LABEL[accuracyBand(pct)];
    return { name: s.name, pct, label };
  });
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
    const total = (d.test ?? 0) + (d.homework ?? 0) + (d.battles ?? 0) + (d.self_practice ?? 0);
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
