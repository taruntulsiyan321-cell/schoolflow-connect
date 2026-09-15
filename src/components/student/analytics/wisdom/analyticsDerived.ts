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

export type ConsistencyCell = {
  /** Calendar date, yyyy-mm-dd. Present for every cell, including empty ones. */
  date: string;
  /** Activities that day: tests + homework + battles + practice sessions. */
  total: number;
  minutes: number;
};

export type ConsistencyWeek = {
  label: string;
  /** Mon..Sun. Always seven, always in weekday order. */
  days: ConsistencyCell[];
};

/**
 * The last `weeks` calendar weeks, Monday to Sunday, ending with the week that
 * contains `today`. Every cell exists; a day with no activity is a zero.
 *
 * ── WHY THIS IS NOT A `.map()` OVER THE SNAPSHOT ──────────────────────────
 *
 * It used to be. consistencyGrid mapped whatever rows the snapshot happened to
 * carry, and Analysis then sliced that array seven at a time and printed cell
 * `i` under the column headed DAY_LABELS[i]. academic_daily_activity only has
 * a row for a day something HAPPENED, so the array is sparse: a student active
 * on three days got three cells drawn under Mon, Tue and Wed whatever days
 * those actually were, and the card above them said "last 4 weeks" while
 * showing an unknown span.
 *
 * A calendar grid has to be built from the calendar. The rows are looked up by
 * date; the grid decides the shape.
 */
export function consistencyWeeks(
  heatmap: AcademicSnapshot["activity_heatmap"],
  weeks = 4,
  today = new Date(),
): ConsistencyWeek[] {
  const byDate = new Map<string, { total: number; minutes: number }>();
  for (const d of heatmap ?? []) {
    const key = String(d.date).slice(0, 10);
    const total = (d.test ?? 0) + (d.homework ?? 0) + (d.battles ?? 0) + (d.self_practice ?? 0);
    const prev = byDate.get(key);
    // Summed rather than overwritten: one date should appear once, and if it
    // ever appears twice, losing one of them silently is the worse failure.
    byDate.set(key, {
      total: (prev?.total ?? 0) + total,
      minutes: (prev?.minutes ?? 0) + (d.minutes ?? 0),
    });
  }

  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Monday of the week containing today, in local time — the same frame the
  // dates in academic_daily_activity are written in.
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));

  const out: ConsistencyWeek[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = new Date(monday);
    start.setDate(start.getDate() - w * 7);
    const days: ConsistencyCell[] = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(start);
      day.setDate(day.getDate() + i);
      const k = key(day);
      const hit = byDate.get(k);
      days.push({ date: k, total: hit?.total ?? 0, minutes: hit?.minutes ?? 0 });
    }
    out.push({ label: `W${weeks - w}`, days });
  }
  return out;
}

/** Days in the window that had any activity, and the window itself. */
export function consistencyRatio(
  weeks: ConsistencyWeek[],
): { activeDays: number; totalDays: number; pct: number } {
  const cells = weeks.flatMap((w) => w.days);
  const activeDays = cells.filter((c) => c.total > 0).length;
  const totalDays = cells.length;
  return {
    activeDays,
    totalDays,
    // Active days over the WINDOW. It used to be active days over the number
    // of rows the snapshot returned — and a row only exists for an active day,
    // so the ratio was activeDays/activeDays and the tile read 100% for
    // everyone who had ever practised once.
    pct: totalDays > 0 ? Math.round((activeDays / totalDays) * 100) : 0,
  };
}
