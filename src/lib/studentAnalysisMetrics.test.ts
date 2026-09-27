import { describe, expect, it } from "vitest";
import {
  buildWeekComparison,
  latestVersusPrevious,
  trendState,
  deriveSubjectPace,
  formatSeconds,
  busiestHour,
  deriveStudyTime,
  paceOverAnswers,
  formatHour,
  deriveMonthComparison,
  scoreAxisDomain,
  deriveRevisionData,
} from "@/lib/studentAnalysisMetrics";
import { REVISION_STAGES_TO_SOLID } from "@/academic/recovery/constants";
import type { PracticeSessionSummary } from "@/hooks/useAnalysisPageData";
import { buildMilestones } from "@/components/student/analytics/wisdom/analyticsDerived";

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

  it("compares the latest 3 sessions with the 3 before them (§6.4)", () => {
    // Four sessions: latest three [50, 80, 80] against the one before [50].
    expect(latestVersusPrevious([50, 50, 80, 80])).toBe(20);
    expect(latestVersusPrevious([90])).toBeNull();
  });

  it("ignores sessions older than the two windows — the old half-split did not", () => {
    // Improved long ago (20 -> 80), then flat for six sessions. The half-split
    // compared [20,20,20,80] with [80,80,80,80] and called it +45, improving.
    // Latest 3 vs previous 3 are both 80: stuck.
    const history = [20, 20, 20, 80, 80, 80, 80, 80, 80, 80];
    expect(latestVersusPrevious(history)).toBe(0);
    expect(trendState(history).state).toBe("stuck");
  });

  it("uses only the 3 before the latest 3, not everything before", () => {
    expect(latestVersusPrevious([0, 0, 0, 0, 60, 60, 60, 90, 90, 90])).toBe(30);
  });

  it("uses what there is when fewer than six sessions exist", () => {
    // Four sessions: the latest three against the one before them.
    expect(latestVersusPrevious([40, 70, 70, 70])).toBe(30);
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
    expect(latestVersusPrevious([50, 90, 90])).toBeNull();
    expect(trendState([50, 90, 90])).toEqual({ state: "not_enough_data", deltaPoints: null });
    // And the boundary itself is inclusive: four sessions IS enough — the
    // latest three (50, 90, 90) against the one before them.
    expect(latestVersusPrevious([50, 50, 90, 90])).toBe(26.7);
  });

  it("calls small movement stuck, not improving", () => {
    // +2 points across six sessions. The old code returned 2 and the screen
    // drew a green up-arrow reading "2%".
    const t = trendState([50, 50, 50, 52, 52, 52]);
    expect(t.state).toBe("stuck");
    expect(t.deltaPoints).toBe(2);
  });

  it("separates not_enough_data from stuck", () => {
    // The distinction §6.4 exists for: both used to render as the same dash.
    expect(trendState([50, 51]).state).toBe("not_enough_data");
    expect(trendState([50, 50, 51, 51]).state).toBe("stuck");
  });

  it("names direction only once movement clears TREND_DELTA_POINTS", () => {
    expect(trendState([40, 40, 40, 60, 60, 60]).state).toBe("improving");
    expect(trendState([60, 60, 60, 40, 40, 40]).state).toBe("worsening");
    // Exactly at the threshold counts as movement, not as stuck.
    expect(trendState([40, 40, 40, 50, 50, 50]).state).toBe("improving");
  });

  it("ranks subjects by time only once enough questions were timed", () => {
    // The defect this replaces: fastest/slowest were bySubject[0] and
    // bySubject[last] of an UNFILTERED sort, so "Hindi" below — one timed
    // question at 300s — would have been named the subject that takes this
    // student longest.
    const pace = deriveSubjectPace([
      { name: "Mathematics", color: "#1", avgSec: 30, timed: 400 },
      { name: "Science", color: "#2", avgSec: 45, timed: 20 },
      { name: "Hindi", color: "#3", avgSec: 300, timed: 1 },
      { name: "English", color: "#4", avgSec: null, timed: 50 },
    ]);
    expect(pace.rows.map((r) => r.name)).toEqual(["Mathematics", "Science"]);
    expect(pace.fastest?.name).toBe("Mathematics");
    expect(pace.slowest?.name).toBe("Science");
  });

  it("will not call a subject fast when nothing in it was answered", () => {
    // MEASURED: 79 Social Science attempts, every one of them SKIPPED at
    // about a third of a second, rendered as "Fastest subject: Social
    // Science, 0s avg". Since 20261115000000 avg_sec and `timed` count
    // answers only, so such a subject arrives with no pace and nothing timed.
    const pace = deriveSubjectPace([
      { name: "Mathematics", color: "#1", avgSec: 6.8, timed: 220 },
      { name: "Social Science", color: "#2", avgSec: null, timed: 0 },
      { name: "English", color: "#3", avgSec: null, timed: 0 },
    ]);
    expect(pace.rows.map((r) => r.name)).toEqual(["Mathematics"]);
    expect(pace.fastest?.name).toBe("Mathematics");
    expect(pace.slowest).toBeNull();
    expect(formatSeconds(pace.avgSec)).toBe("6.8s");
  });

  it("pools on the unrounded value, so a sub-second subject is not free", () => {
    // Rounding each subject to a whole second before pooling made 79
    // questions at 0.3s contribute exactly ZERO seconds to the overall pace.
    const pace = deriveSubjectPace([
      { name: "Mathematics", color: "#1", avgSec: 6.8, timed: 400 },
      { name: "Social Science", color: "#2", avgSec: 0.4, timed: 100 },
    ]);
    // (6.8*400 + 0.4*100) / 500 = 5.52
    expect(Math.round(pace.avgSec * 100) / 100).toBe(5.52);
    // Rounding first would have given (7*400 + 0*100)/500 = 5.6.
    expect(pace.avgSec).not.toBe(5.6);
  });

  it("pools the overall pace instead of averaging the averages", () => {
    // 400 questions at 30s and 20 at 45s is 12,900s over 420 = 30.7s.
    // The mean of the two averages is 37.5s — the figure the page would
    // print if it treated a 20-question subject as equal to a 400-question
    // one.
    const pace = deriveSubjectPace([
      { name: "Mathematics", color: "#1", avgSec: 30, timed: 400 },
      { name: "Science", color: "#2", avgSec: 45, timed: 20 },
    ]);
    expect(Math.round(pace.avgSec * 10) / 10).toBe(30.7);
    expect(pace.avgSec).not.toBe(37.5);
  });

  it("names no slowest subject when only one can be ranked", () => {
    const pace = deriveSubjectPace([
      { name: "Mathematics", color: "#1", avgSec: 30, timed: 400 },
      { name: "Hindi", color: "#3", avgSec: 300, timed: 1 },
    ]);
    expect(pace.fastest?.name).toBe("Mathematics");
    expect(pace.slowest).toBeNull();
    expect(pace.avgSec).toBe(30);
  });

  it("reports nothing rather than zero when no subject qualifies", () => {
    const pace = deriveSubjectPace([
      { name: "Hindi", color: "#3", avgSec: 300, timed: 1 },
    ]);
    expect(pace.rows).toEqual([]);
    expect(pace.fastest).toBeNull();
    expect(pace.avgSec).toBe(0);
  });

  it("never prints a question as having taken no time", () => {
    expect(formatSeconds(0.3)).toBe("0.3s");
    expect(formatSeconds(0.04)).toBe("0s"); // genuinely below a tenth
    expect(formatSeconds(6.8)).toBe("6.8s");
    expect(formatSeconds(67.14)).toBe("67s");
  });

  it("month comparison reads whole months of the student's own days", () => {
    const rows = deriveMonthComparison({
      today: "2026-09-27",
      days: [
        // This month: 4 of 10 answered right, pooled across days.
        { date: "2026-09-10", ms: 90_000, answered: 1, correct: 1, sessions: 1 },
        { date: "2026-09-12", ms: 30_000, answered: 9, correct: 3, sessions: 1 },
        // Last month, from its FIRST day. The 28-day heat-map this read
        // before ended on 30 August, so none of this would have been in it.
        { date: "2026-08-02", ms: 600_000, answered: 5, correct: 3, sessions: 3 },
        // Earlier than last month: ignored.
        { date: "2026-07-31", ms: 999_000, answered: 50, correct: 50, sessions: 9 },
      ],
    });
    expect(rows[0]).toMatchObject({ label: "Practice", thisM: 2, lastM: 3 });
    // Pooled 4/10 = 40%; the mean of the daily rates would be (100 + 33)/2.
    expect(rows[1]).toMatchObject({ label: "Accuracy", thisM: 40, lastM: 60 });
    // Milliseconds; the renderer picks the unit.
    expect(rows[2]).toMatchObject({ label: "Study time", thisM: 120_000, lastM: 600_000, unit: "time" });
  });

  it("month comparison crosses the year, and a month with nothing in it is null", () => {
    const rows = deriveMonthComparison({
      today: "2027-01-05",
      days: [{ date: "2026-12-31", ms: 60_000, answered: 2, correct: 1, sessions: 1 }],
    });
    expect(rows.map((r) => [r.thisM, r.lastM])).toEqual([[null, 1], [null, 50], [null, 60_000]]);
    expect(deriveMonthComparison(null).every((r) => r.thisM == null && r.lastM == null)).toBe(true);
  });

  it("study time sums the window's days, and names the weekday the chart highlights", () => {
    const window = ["2026-09-14", "2026-09-15", "2026-09-21", "2026-09-22", "2026-09-28"];
    const study = deriveStudyTime(
      window,
      [
        // Two Mondays of 50 minutes against one Tuesday of 80: Monday is the
        // most active DAY OF THE WEEK. The single busiest date is a Tuesday,
        // which is what the tile named before — beside a chart whose tallest
        // bar was Monday.
        { date: "2026-09-14", ms: 3_000_000, answered: 1, correct: 1, sessions: 1 },
        { date: "2026-09-21", ms: 3_000_000, answered: 1, correct: 1, sessions: 1 },
        { date: "2026-09-15", ms: 4_800_000, answered: 1, correct: 1, sessions: 1 },
        // Outside the window: not counted.
        { date: "2026-09-01", ms: 9_999_999, answered: 1, correct: 1, sessions: 1 },
      ],
      (() => { const h = new Array<number>(24).fill(0); h[17] = 9; return h; })(),
    );
    expect(study.totalMs).toBe(10_800_000);
    expect(study.bestDay).toBe("Mon");
    expect(study.weeklyHrs.slice(0, 2)).toEqual([1.7, 1.3]);
    // Over the three days practised, not the window's five dates.
    expect(study.avgDailyMs).toBe(3_600_000);
    expect(study.bestHour).toBe("5 PM");
    expect(study.msByDate.get("2026-09-15")).toBe(4_800_000);
    expect(study.msByDate.has("2026-09-01")).toBe(false);
  });

  it("study time is absent, not zero, before it loads and when nothing was timed", () => {
    for (const days of [null, [], [{ date: "2026-09-14", ms: 0, answered: 0, correct: 0, sessions: 1 }]]) {
      const study = deriveStudyTime(["2026-09-14"], days, null);
      expect(study.totalMs).toBeNull();
      expect(study.avgDailyMs).toBeNull();
      expect(study.bestDay).toBe("—");
      expect(study.bestHour).toBe("—");
    }
  });

  it("paces over answers only, and says how many answers it rests on", () => {
    const pace = paceOverAnswers([
      { timeMs: 40_000, skipped: false },
      { timeMs: 40_000, skipped: false },
      { timeMs: 1_000, skipped: true },   // time spent, not solving
      { timeMs: null, skipped: false },   // untimed: left out, never zero
      { timeMs: 0, skipped: false },
    ]);
    expect(pace).toEqual({ avgSec: 40, timed: 2 });
    // POSITIVE CONTROL: counting the skip would give 27s.
    expect(pace.avgSec).not.toBeCloseTo(27, 0);
    expect(paceOverAnswers([{ timeMs: 1_000, skipped: true }])).toEqual({ avgSec: null, timed: 0 });
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

  /*
   * "deriveImprovingChapters" WAS HERE. It fed the Topics-tab "Chapters
   * getting better" panel, which §6.1 / §10.8 forbid (weaknesses only).
   * Trend on chapters that still need work lives on the §6.3 list and the
   * subject/chapter grids — not as a strengths celebration.
   */

  /*
   * "deriveSubjectRows collapses Maths aliases and drops Subject/Daily" WAS
   * HERE, and it went with the function it tested.
   *
   * The behaviour did not go: it moved into SQL. by_subject groups on
   * public._normalize_subject_label(qa.subject), which is what now collapses
   * Maths/Mathematics into one row, and the same function returns NULL for
   * the generic buckets so "Subject" and "Daily" never reach the client at
   * all. One row per real subject is a property of the query, not of a
   * client-side reducer, and a duplicate cannot arrive for the page to fold.
   *
   * That is not covered by any test in this repository, because it is a
   * database function; supabase/migrations/verification is where a check for
   * it belongs.
   */


  it("buildMilestones skips fake Level 1 at 0 XP", () => {
    expect(buildMilestones({}, null)).toEqual([]);
    expect(buildMilestones({ xp: { xp: 0, level: 1 } }, null)).toEqual([]);
    expect(buildMilestones({ xp: { xp: 120, level: 3 } }, null)[0].title).toContain("Level 3");
  });

  it("buildMilestones reports a rise in POINTS and does not call it a session comparison", () => {
    // The caller gates this on the §6.4 ladder, so the milestone describes a
    // run of sessions. It used to read "Compared to your previous practice
    // session", which is a different — and much weaker — claim, and it
    // labelled a delta in percentage points as a percent change.
    const [m] = buildMilestones({ xp: { xp: 120, level: 3 } }, 12).filter((x) =>
      x.title.startsWith("Accuracy up"),
    );
    expect(m.title).toBe("Accuracy up 12 points");
    expect(m.detail).toBe("Across your recent practice sessions");
    expect(m.detail).not.toContain("previous practice session");
  });

  it("buildMilestones stays silent when the trend did not qualify", () => {
    const titles = buildMilestones({ xp: { xp: 120, level: 3 } }, null).map((m) => m.title);
    expect(titles.some((t) => t.startsWith("Accuracy up"))).toBe(false);
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
});

describe("revision status tiles", () => {
  const st = (over: Record<string, unknown> = {}) => ({
    chapter_id: "c", chapter: "Algebra", subject: "Mathematics", state: "recovered" as const,
    revision_stage: 3, consecutive_passes: 0, next_revision_at: "2026-10-01T00:00:00Z",
    revision_due: false, recovered_at: null, last_recovery_readiness: null,
    open_mistakes: 0, revision_fresh_available: 8, ...over,
  });

  it("does not count one chapter as both done and pending", () => {
    // A solid chapter does not leave the schedule, it drops to the much
    // longer interval — so it carries a next_revision_at and was counted in
    // BOTH tiles. Three chapters rendered as "1 Done, 2 Pending", which
    // reads as three when one of them is the same chapter twice.
    const rows = [
      st({ chapter_id: "solid", consecutive_passes: REVISION_STAGES_TO_SOLID }),
      st({ chapter_id: "climbing", consecutive_passes: 1 }),
    ];
    const d = deriveRevisionData(rows);
    expect(d.completed).toBe(1);
    expect(d.pending).toBe(1);
    expect(d.completed + d.pending).toBe(rows.length);
  });

  it("still reports a solid chapter that has come due", () => {
    // The narrowing above must not reach dueToday: a solid chapter is on a
    // longer rung of the same ladder and comes due like any other.
    const d = deriveRevisionData([
      st({ chapter: "Algebra", consecutive_passes: REVISION_STAGES_TO_SOLID, revision_due: true }),
    ]);
    expect(d.completed).toBe(1);
    expect(d.pending).toBe(0);
    expect(d.dueToday).toEqual(["Algebra"]);
  });

  it("keeps due today a subset of what is outstanding", () => {
    const d = deriveRevisionData([
      st({ chapter: "Triangles", consecutive_passes: 1, revision_due: true }),
      st({ chapter: "Circles", consecutive_passes: 1, revision_due: false }),
    ]);
    expect(d.pending).toBe(2);
    expect(d.dueToday).toEqual(["Triangles"]);
  });
});
