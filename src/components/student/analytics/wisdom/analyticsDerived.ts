import type { PracticeSessionSummary } from "@/hooks/useAnalysisPageData";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { SubjectChartPoint } from "@/hooks/useStudentPerformanceCharts";
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

/*
 * classifyMistakes, MistakeBucket and peerBenchmarkSubjects WERE HERE. Both
 * were dead — defined, tested, imported by nothing the student ever sees —
 * and both are gone rather than left "in case".
 *
 * peerBenchmarkSubjects still carried `_rank` and `_classSize` parameters it
 * deliberately ignored, the vestige of a percentile-against-the-class it was
 * corrected out of. The Analysis page shows one student their own record and
 * nothing about anybody else (§6.7), so a cohort-shaped function sitting in
 * its helper module is an invitation, not an asset.
 *
 * classifyMistakes bucketed student_mistakes by error_type, which is NULL on
 * every row in production — it had nothing to classify and no caller.
 * Reviving it means writing the classifier first; the reading is not lost by
 * deleting a function that never ran.
 */

export type Milestone = { title: string; when: string; detail?: string; badge?: string };

/**
 * `topicGaps: TopicGapInsight[]` WAS A THIRD PARAMETER AND IT IS GONE.
 *
 * Its only caller passed a literal `[]`, so masteryToOvercome() could only
 * ever return null and the "Working on: <topic>" milestone it fed was
 * unreachable code guarded by an empty array. A parameter that is always
 * empty is not a seam for a future feature, it is a branch nobody can read
 * the behaviour of. Recovery already has its own surface, and the Topics tab
 * names what needs attention from the live weak-topics source.
 */
export function buildMilestones(
  data: AcademicSnapshot,
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
      title: `Accuracy up ${improvement} points`,
      when: "Latest sessions",
      // THE CAPTION SAID "Compared to your previous practice session" AND
      // THAT STOPPED BEING TRUE. The caller now gates this on the §6.4
      // ladder — TREND_MIN_SESSIONS sittings and movement past
      // TREND_DELTA_POINTS — precisely because two sessions is one good
      // sitting after one bad one. The value was corrected and the sentence
      // describing it was not, so the page explained a trend as a comparison
      // it is not.
      //
      // The title said "%" for the same reason: a change of twelve
      // PERCENTAGE POINTS is not a twelve percent change, and this figure is
      // a delta in points.
      detail: "Across your recent practice sessions",
    });
  }
  return items.slice(0, 4);
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
    // PRACTICE ONLY. Analysis is rule-11 practice-fed; counting test /
    // homework / battle here put school work into "Practice today" and the
    // week-vs-week bars. Other surfaces that want all activity kinds still
    // read the raw heatmap components themselves.
    const total = d.self_practice ?? 0;
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
