/**
 * weekdayLabel is a KEY, not display text.
 *
 * It returned `toLocaleDateString(undefined, { weekday: "short" })` and both
 * its callers then looked the answer up in DAY_LABELS, which is English. On a
 * browser set to any other language nothing ever matched: buildWeekComparison
 * bucketed zero and the Analysis "this week vs last week" chart drew seven
 * empty bars for a student who had practised all week.
 *
 * It also parsed "2026-09-14" as UTC midnight — the spec's rule for date-only
 * strings — while every comparison beside it used local midnight, so west of
 * Greenwich a day's activity landed on the day before.
 */
import { describe, it, expect } from "vitest";
import { DAY_LABELS, weekdayLabel, buildWeekComparison } from "@/lib/studentAnalysisMetrics";

describe("weekdayLabel", () => {
  it("answers in DAY_LABELS' own vocabulary", () => {
    // 2026-09-14 is a Monday, 2026-09-20 a Sunday.
    expect(weekdayLabel("2026-09-14")).toBe("Mon");
    expect(weekdayLabel("2026-09-20")).toBe("Sun");
    expect(DAY_LABELS).toContain(weekdayLabel("2026-09-17"));
  });

  it("POSITIVE CONTROL: it distinguishes all seven days", () => {
    // A stub returning "Mon" would satisfy the first assertion above.
    const labels = new Set(
      ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"]
        .map(weekdayLabel),
    );
    expect(labels.size).toBe(7);
    expect([...labels]).toEqual(expect.arrayContaining([...DAY_LABELS]));
  });

  it("reads a date-only string as that calendar day, not as a UTC instant", () => {
    // The whole point: no timezone may move 2026-09-14 off Monday.
    expect(weekdayLabel("2026-09-14")).toBe("Mon");
    expect(weekdayLabel("2026-09-14T00:00:00Z")).toBe("Mon");
  });
});

describe("buildWeekComparison", () => {
  it("buckets a day into the weekday it actually falls on", () => {
    const now = new Date(2026, 8, 16); // Wednesday 2026-09-16
    const rows = buildWeekComparison(
      [
        { date: "2026-09-15", total: 4 } as never, // Tuesday, this week
        { date: "2026-09-08", total: 7 } as never, // Tuesday, last week
      ],
      now,
    );
    const tue = rows.find((r) => r.day === "Tue");
    expect(tue?.thisWeek).toBe(4);
    expect(tue?.lastWeek).toBe(7);
    // and nothing leaked into the other six days
    expect(rows.filter((r) => r.thisWeek > 0 || r.lastWeek > 0)).toHaveLength(1);
  });
});
