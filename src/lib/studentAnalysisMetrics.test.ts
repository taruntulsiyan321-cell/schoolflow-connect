import { describe, expect, it } from "vitest";
import {
  buildWeekComparison,
  halfWindowTrend,
  trendState,
  deriveSpeedStats,
  deriveMonthComparison,
  scoreAxisDomain,
  deriveImprovingTopics,
  deriveChapterRows,
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

  it("gives every derived chapter row a trend state", () => {
    // The fallback path builds rows with no session list behind them. It used
    // to emit `trend: null` and nothing else, and a `r is DerivedChapterRow`
    // filter predicate hid the missing field from the typechecker.
    const rows = deriveChapterRows([], [], {
      weak_topics: [{ subject: "Mathematics", chapter: "Integrals", topic: "Integrals", accuracy: 40 }],
    } as never);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.trendState).toBe("not_enough_data");
    }
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

  it("chapter accuracy uses correct/total attempts, not mastery as completion", () => {
    const rows = deriveChapterRows(
      [
        {
          subject: "Math",
          chapter: "Limits",
          concept: "Limits",
          mastery_score: 90,
          total_attempts: 10,
          correct_attempts: 5,
          recovery_attempts: 0,
          mistake_count: 2,
        },
      ],
      [],
    );
    expect(rows[0].accuracy).toBe(50);
    expect(rows[0].practiceDepth).toBe(100);
    expect(rows[0].subject).toBe("Mathematics");
  });

  it("deriveChapterRows gives one card per chapter, not one per concept", () => {
    // THE PRODUCTION DEFECT, IN MINIATURE. concept_mastery holds a row per
    // concept; this mapped them one-to-one onto cards headed "Chapter by
    // chapter". Measured for one student: 20 concept rows over 6 chapters
    // produced 12 cards, Polynomials six of them with six different
    // accuracies, and three whole chapters cut off by the slice.
    const concept = (chapter: string, name: string, attempts: number, correct: number) => ({
      subject: "Math",
      chapter,
      concept: name,
      mastery_score: 50,
      total_attempts: attempts,
      correct_attempts: correct,
      recovery_attempts: 0,
      mistake_count: 0,
    });
    const rows = deriveChapterRows(
      [
        concept("Polynomials", "Zeroes of polynomial", 14, 5),
        concept("Polynomials", "Degree and Value", 5, 1),
        concept("Polynomials", "Algebraic Identities", 3, 1),
        concept("Arithmetic Progressions", "nth Term of an AP", 19, 4),
        concept("Arithmetic Progressions", "Word Problems on AP", 5, 0),
      ],
      [],
    );

    expect(rows).toHaveLength(2);
    const poly = rows.find((r) => r.chapter === "Polynomials");
    const ap = rows.find((r) => r.chapter === "Arithmetic Progressions");
    // Pooled over the chapter: 7 correct of 22, not the mean of 36/20/33.
    expect(poly).toMatchObject({ questions: 22, accuracy: 32 });
    // 4 of 24.
    expect(ap).toMatchObject({ questions: 24, accuracy: 17 });
  });

  it("deriveChapterRows keeps the weakest chapters when it has to cap the grid", () => {
    // The cap used to cut in whatever order the concept rows arrived, which
    // is how a student's three best-known chapters vanished from the grid
    // while their weakest appeared six times. §10.8 forbids a list filtered
    // to the strongest; surviving a cap weakest-first is the opposite.
    //
    // STRONGEST FIRST on the way in — 70% down to 0% — because that ordering
    // is what lets this test fail. Fed weakest-first, an unsorted
    // `.slice(0, 12)` would keep the weakest by accident and these assertions
    // would pass against the defect they exist to catch.
    const rows = deriveChapterRows(
      Array.from({ length: 15 }, (_, i) => ({
        subject: "Math",
        chapter: `Chapter ${String.fromCharCode(65 + i)}`,
        concept: `Concept ${i}`,
        mastery_score: 50,
        total_attempts: 20,
        correct_attempts: 14 - i,
        recovery_attempts: 0,
        mistake_count: 0,
      })),
      [],
    );
    expect(rows).toHaveLength(12);
    expect(rows[0].accuracy).toBe(0);
    // The three strongest — 70%, 65%, 60% — are the ones dropped.
    for (const dropped of [70, 65, 60]) {
      expect(rows.map((r) => r.accuracy)).not.toContain(dropped);
    }
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

  it("deriveChapterRows omits generic Topic/Daily/Subject cards", () => {
    const rows = deriveChapterRows(
      [
        {
          subject: "Subject",
          chapter: "Topic",
          concept: "Daily",
          mastery_score: 10,
          total_attempts: 4,
          correct_attempts: 1,
          recovery_attempts: 0,
          mistake_count: 3,
        },
        {
          subject: "Accountancy",
          chapter: "Cash Book",
          concept: "Cash Book",
          mastery_score: 70,
          total_attempts: 5,
          correct_attempts: 4,
          recovery_attempts: 0,
          mistake_count: 1,
        },
      ],
      [],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].chapter).toMatch(/Cash Book/i);
    expect(rows[0].subject).toBe("Accountancy");
  });
});

describe("analyticsDerived honesty", () => {
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
