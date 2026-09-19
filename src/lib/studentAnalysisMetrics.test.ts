import { describe, expect, it } from "vitest";
import {
  buildWeekComparison,
  halfWindowTrend,
  trendState,
  deriveSpeedStats,
  hourHistogram,
  busiestHour,
  formatHour,
  deriveMonthComparison,
  scoreAxisDomain,
  deriveImprovingTopics,
  deriveSubjectRows,
} from "@/lib/studentAnalysisMetrics";
import type { PracticeSessionSummary } from "@/hooks/useAnalysisPageData";
import { classifyMistakes, buildMilestones, peerBenchmarkSubjects } from "@/components/student/analytics/wisdom/analyticsDerived";
import type { MistakeTopicAggregate } from "@/lib/analyticsInsights";

function session(partial: Partial<PracticeSessionSummary> & Pick<PracticeSessionSummary, "id" | "subject">): PracticeSessionSummary {
  return {
    chapter: partial.chapter ?? "Ch",
    question_count: partial.question_count ?? 10,
    correct_count: partial.correct_count ?? 7,
    score: partial.score ?? 70,
    created_at: partial.created_at ?? "2026-07-01T10:00:00Z",
    finished_at: partial.finished_at ?? "2026-07-01T10:20:00Z",
    wrong_count: partial.wrong_count ?? 3,
    // Measured milliseconds, null when nothing timed the session. The fixture
    // default used to be `duration_minutes: 20`, which every speed assertion
    // below silently depended on — and which was exactly the shape of the
    // production defect: a constant standing in for a measurement.
    measured_ms: partial.measured_ms ?? 20 * 60_000,
    accuracy_pct: partial.accuracy_pct ?? 70,
    ...partial,
  };
}

describe("studentAnalysisMetrics", () => {
  it("builds this-week vs last-week comparison from activity dates", () => {
    const now = new Date("2026-08-02T12:00:00Z"); // Sunday
    const rows = [
      { date: "2026-08-01", total: 5, test: 0, battles: 0 }, // Sat this week
      { date: "2026-07-31", total: 3, test: 0, battles: 0 }, // Fri this week
      { date: "2026-07-25", total: 8, test: 0, battles: 0 }, // Sat last week
      { date: "2026-07-24", total: 2, test: 0, battles: 0 }, // Fri last week
    ];
    const cmp = buildWeekComparison(rows, now);
    const sat = cmp.find((d) => d.day === "Sat");
    const fri = cmp.find((d) => d.day === "Fri");
    expect(sat?.thisWeek).toBe(5);
    expect(sat?.lastWeek).toBe(8);
    expect(fri?.thisWeek).toBe(3);
    expect(fri?.lastWeek).toBe(2);
  });

  it("computes half-window accuracy trend", () => {
    expect(halfWindowTrend([50, 50, 80, 80])).toBe(30);
    expect(halfWindowTrend([90])).toBeNull();
  });

  // ── §6.4, the trend floor and the three states ──────────────────────────
  //
  // These replace a computation that declared a trend from TWO sessions and
  // handed the screen a number it drew a coloured arrow on. Each assertion
  // below fails against that old behaviour, which is the control: the first
  // two returned a number where they now require null, and the "steady" case
  // returned +2 (an up-arrow, "2%") where it now reports movement too small
  // to call.

  it("refuses a trend below TREND_MIN_SESSIONS sessions", () => {
    // Three sessions moving 40 points is still not a trend — the floor is a
    // count of sessions, not a size of movement.
    expect(halfWindowTrend([50, 90, 90])).toBeNull();
    expect(trendState([50, 90, 90])).toEqual({ state: "not_enough_data", deltaPoints: null });
    // And the boundary itself is inclusive: four sessions IS enough.
    expect(halfWindowTrend([50, 50, 90, 90])).toBe(40);
  });

  it("calls small movement stuck, not improving", () => {
    // +2 points across four sessions. The old code returned 2 and the screen
    // drew a green up-arrow reading "2%".
    const t = trendState([50, 50, 52, 52]);
    expect(t.state).toBe("stuck");
    expect(t.deltaPoints).toBe(2);
  });

  it("separates not_enough_data from stuck", () => {
    // The distinction §6.4 exists for: both used to render as the same dash.
    expect(trendState([50, 51]).state).toBe("not_enough_data");
    expect(trendState([50, 50, 51, 51]).state).toBe("stuck");
  });

  it("names direction only once movement clears TREND_DELTA_POINTS", () => {
    expect(trendState([40, 40, 60, 60]).state).toBe("improving");
    expect(trendState([60, 60, 40, 40]).state).toBe("worsening");
    // Exactly at the threshold counts as movement, not as stuck.
    expect(trendState([40, 40, 50, 50]).state).toBe("improving");
  });

  it("derives per-subject speed from sessions", () => {
    const sessions = [
      session({ id: "1", subject: "Math", question_count: 10, measured_ms: 10 * 60_000, accuracy_pct: 60, finished_at: "2026-07-01T10:00:00Z" }),
      session({ id: "2", subject: "Physics", question_count: 10, measured_ms: 20 * 60_000, accuracy_pct: 70, finished_at: "2026-07-02T10:00:00Z" }),
    ];
    const { stats, bySubject } = deriveSpeedStats(sessions);
    expect(bySubject).toHaveLength(2);
    expect(stats.fastestSubject).toBe("Mathematics");
    expect(stats.fastestSec).toBe(60);
    expect(stats.slowestSubject).toBe("Physics");
  });

  it("month comparison pools accuracy and reports activities and minutes as they are", () => {
    const now = new Date("2026-08-15T12:00:00Z");
    const rows = deriveMonthComparison(
      [
        { date: "2026-08-10", total: 4, test: 0, battles: 0 },
        { date: "2026-07-10", total: 2, test: 0, battles: 0 },
      ],
      [
        // This month: 8 of 10 answered correctly ACROSS the two sessions.
        // The mean of the two session rates is (100 + 60)/2 = 80; pooled is
        // 8/10 = 80 as well, so the sessions are deliberately uneven below —
        // otherwise this test would pass against the defect it exists for.
        session({ id: "a", subject: "Math", correct_count: 1, wrong_count: 0, finished_at: "2026-08-10T10:00:00Z" }),
        session({ id: "b", subject: "Math", correct_count: 3, wrong_count: 6, finished_at: "2026-08-12T10:00:00Z" }),
        session({ id: "c", subject: "Math", correct_count: 3, wrong_count: 2, finished_at: "2026-07-10T10:00:00Z" }),
      ],
      [
        { date: "2026-08-10", test: 0, homework: 0, battles: 0, minutes: 120 },
        { date: "2026-07-10", test: 0, homework: 0, battles: 0, minutes: 60 },
      ],
      now,
    );
    expect(rows[0]).toMatchObject({ label: "Activities", thisM: 4, lastM: 2 });
    // Pooled: 4 correct of 10 answered = 40%. The mean of the session rates
    // would be (100 + 33)/2 = 67, which is what this used to report.
    expect(rows[1]).toMatchObject({ label: "Accuracy", thisM: 40, lastM: 60 });
    // MINUTES, not hours. Rounding to hours here is what printed "0h" for
    // every real total under thirty minutes.
    expect(rows[2]).toMatchObject({ label: "Study time", thisM: 120, lastM: 60 });
  });

  it("month comparison reports a month with no answered questions as null, not 0%", () => {
    const rows = deriveMonthComparison([], [], [], new Date("2026-08-15T12:00:00Z"));
    expect(rows[1]).toMatchObject({ label: "Accuracy", thisM: null, lastM: null });
  });

  it("buckets attempts by the hour of the viewer's own clock", () => {
    // Built from a local Date, so the expectation holds wherever this runs.
    //
    // WHAT THIS DOES NOT PROVE, stated rather than implied: swapping
    // getHours() for getUTCHours() in the implementation does NOT fail this
    // test, because CI and this container both run in UTC, where the two are
    // the same function. No test written here can separate them under a UTC
    // clock. The local-hours choice is argued in hourHistogram's own comment
    // and verified by reading it; what this test covers is the bucketing and
    // the handling of unusable entries.
    const at = (h: number) => new Date(2026, 8, 18, h, 30).toISOString();
    const hours = hourHistogram([at(17), at(17), at(5), null, undefined, "not a date"]);

    expect(hours).toHaveLength(24);
    expect(hours[17]).toBe(2);
    expect(hours[5]).toBe(1);
    // Everything else, including the three unusable entries, contributes zero.
    expect(hours.reduce((a, b) => a + b, 0)).toBe(3);
  });

  it("names the busiest hour, and says nothing when there is nothing to say", () => {
    const empty = new Array<number>(24).fill(0);
    // NULL, not 0. `indexOf(Math.max(...))` over an empty histogram returns 0,
    // which would render "12 AM" as a claim about a student who has never
    // practised — the same invented-from-absence defect as "0% accuracy".
    expect(busiestHour(empty)).toBeNull();
    expect(formatHour(busiestHour(empty))).toBe("—");

    const hours = [...empty];
    hours[17] = 9;
    hours[5] = 4;
    expect(busiestHour(hours)).toBe(17);
    expect(formatHour(17)).toBe("5 PM");
  });

  it("formats midnight and noon the way a clock does", () => {
    // 0 and 12 are where a naive `h % 12` prints "0 AM" and "0 PM".
    expect(formatHour(0)).toBe("12 AM");
    expect(formatHour(12)).toBe("12 PM");
    expect(formatHour(23)).toBe("11 PM");
  });

  it("score axis domain includes scores below 50", () => {
    expect(scoreAxisDomain([40, 55, 70])[0]).toBeLessThanOrEqual(40);
  });

  it("improving topics require real half-window lift", () => {
    // A chapter present in practiceTrend is scored from THOSE points — the
    // session path is skipped for it — so the lift has to be expressed there.
    const improving = deriveImprovingTopics(
      [
        { date: "2026-07-01", score_pct: 40, chapter: "Integration" },
        { date: "2026-07-05", score_pct: 40, chapter: "Integration" },
        { date: "2026-07-10", score_pct: 70, chapter: "Integration" },
        { date: "2026-07-15", score_pct: 70, chapter: "Integration" },
      ],
      [
        session({ id: "1", subject: "Math", chapter: "Integration", accuracy_pct: 40, finished_at: "2026-07-01T10:00:00Z" }),
      ],
    );
    expect(improving.some((t) => t.topic === "Integration" && t.improvement >= 5)).toBe(true);
  });

  it("drops a topic that lifted by less than TREND_DELTA_POINTS", () => {
    // The control for the assertion above: same shape, movement of 4 points.
    // This list used to run on its own `< 5` threshold, so a 6-point lift was
    // "improving" here while the chapter grid beside it read "steady".
    const improving = deriveImprovingTopics(
      [
        { date: "2026-07-01", score_pct: 40, chapter: "Integration" },
        { date: "2026-07-05", score_pct: 40, chapter: "Integration" },
        { date: "2026-07-10", score_pct: 46, chapter: "Integration" },
        { date: "2026-07-15", score_pct: 46, chapter: "Integration" },
      ],
      [
        session({ id: "1", subject: "Math", chapter: "Integration", accuracy_pct: 40, finished_at: "2026-07-01T10:00:00Z" }),
      ],
    );
    expect(improving.some((t) => t.topic === "Integration")).toBe(false);
  });

  it("deriveSubjectRows collapses Maths aliases and drops Subject/Daily", () => {
    const rows = deriveSubjectRows(
      [
        { name: "Maths", accuracy: 80, attempts: 10 },
        { name: "Mathematics", accuracy: 40, attempts: 10 },
        { name: "Subject", accuracy: 99, attempts: 50 },
        { name: "Daily", accuracy: 10, attempts: 10 },
      ],
      // Four sessions, not two. This test is about alias collapsing, but it
      // also asserted a trend — and two sessions is below TREND_MIN_SESSIONS,
      // so under §6.4 there is no trend to assert. The aliases still collapse
      // across all four, which is what the test is named for.
      [
        session({ id: "1", subject: "Math", accuracy_pct: 50, finished_at: "2026-07-01T10:00:00Z" }),
        session({ id: "2", subject: "Mathematics", accuracy_pct: 50, finished_at: "2026-07-05T10:00:00Z" }),
        session({ id: "3", subject: "Math", accuracy_pct: 90, finished_at: "2026-07-10T10:00:00Z" }),
        session({ id: "4", subject: "Mathematics", accuracy_pct: 90, finished_at: "2026-07-15T10:00:00Z" }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Mathematics");
    expect(rows[0].questions).toBe(20);
    expect(rows[0].trend).toBe(40);
    expect(rows[0].trendState).toBe("improving");
  });

  it("classifyMistakes does not invent calc/rushed percentages", () => {
    const aggregates: MistakeTopicAggregate[] = [
      {
        topic: "A",
        chapter: null,
        subject: "Math",
        concept: null,
        mistake_count: 3,
        total_wrong: 6,
        sample_question: "q",
        last_seen: null,
      },
      {
        topic: "B",
        chapter: null,
        subject: "Math",
        concept: null,
        mistake_count: 1,
        total_wrong: 1,
        sample_question: "q",
        last_seen: null,
      },
    ];
    const buckets = classifyMistakes(aggregates);
    expect(buckets.every((b) => b.key !== "calc" && b.key !== "time")).toBe(true);
    expect(buckets.reduce((s, b) => s + b.count, 0)).toBe(4);
  });

  it("buildMilestones skips fake Level 1 at 0 XP", () => {
    expect(buildMilestones({}, [], null)).toEqual([]);
    expect(buildMilestones({ xp: { xp: 0, level: 1 } }, [], null)).toEqual([]);
    expect(buildMilestones({ xp: { xp: 120, level: 3 } }, [], null)[0].title).toContain("Level 3");
  });

  it("peerBenchmarkSubjects never claims Top X% from class XP rank", () => {
    const labels = peerBenchmarkSubjects([{ name: "Math", accuracy: 90, attempts: 10 }], 1, 40);
    expect(labels[0].label.includes("Top")).toBe(false);
  });

  /**
   * This assertion used to read `expect(labels[0].label).toBe("Strong")`.
   *
   * It was pinning the §10.8 violation in place: "Strong areas are never shown
   * anywhere in the app." A test that asserts the exact wording of a label is
   * only as right as the label, and this one made the wrong label load-bearing —
   * changing it broke a test named for something else entirely.
   *
   * Replaced with the rule rather than the string. The label may be reworded
   * again; it may never name a strength.
   */
  it("peerBenchmarkSubjects never tells a student what they are good at (§10.8)", () => {
    const labels = peerBenchmarkSubjects(
      [
        { name: "Math", accuracy: 95, attempts: 10 },
        { name: "Physics", accuracy: 80, attempts: 10 },
        { name: "Chemistry", accuracy: 50, attempts: 10 },
        { name: "Biology", accuracy: 10, attempts: 10 },
      ],
      1,
      40,
    );
    expect(labels).toHaveLength(4);
    for (const l of labels) {
      expect(/strong|master|proficient|excellent|strength/i.test(l.label), l.label).toBe(false);
      expect(l.label.length).toBeGreaterThan(0);
    }
    // And the top of the range still says something — silence would be its own
    // defect, and would let an empty label pass the check above.
    expect(labels[0].label).toBe("On track");
  });
});
