/**
 * The Analysis activity grid is a CALENDAR, and it has to behave like one.
 *
 * It did not. consistencyGrid mapped whatever rows academic_daily_activity
 * happened to hold — a row exists only for a day something happened — and
 * Analysis sliced that sparse array seven at a time and drew cell `i` under
 * the column headed DAY_LABELS[i]. Three active days were drawn under Mon,
 * Tue and Wed whatever days they really were, beneath a card that said "last
 * 4 weeks".
 *
 * The same sparseness broke the Consistency tile on the Practice tab, which
 * divided active days by the number of rows returned — activeDays/activeDays,
 * 100% for anyone who had ever practised and 0% for everyone else, with no
 * third answer possible.
 *
 * Each test below fails against that old shape.
 */
import { describe, it, expect } from "vitest";
import {
  consistencyWeeks,
  consistencyRatio,
} from "@/components/student/analytics/wisdom/analyticsDerived";

// A Wednesday, so the week-alignment assertions are not accidentally true of
// a Monday.
const TODAY = new Date(2026, 8, 16); // 2026-09-16
const row = (date: string, over: Partial<{ test: number; homework: number; battles: number; self_practice: number; minutes: number }> = {}) => ({
  date,
  test: over.test ?? 0,
  homework: over.homework ?? 0,
  battles: over.battles ?? 0,
  self_practice: over.self_practice ?? 0,
  minutes: over.minutes ?? 0,
});

describe("consistencyWeeks", () => {
  it("is always four full Mon–Sun weeks, however little data there is", () => {
    const weeks = consistencyWeeks([], 4, TODAY);
    expect(weeks).toHaveLength(4);
    expect(weeks.every((w) => w.days.length === 7)).toBe(true);
    expect(weeks.flatMap((w) => w.days).every((c) => c.total === 0)).toBe(true);
  });

  it("ends with the week containing today, and starts on a Monday", () => {
    const weeks = consistencyWeeks([], 4, TODAY);
    const last = weeks[weeks.length - 1];
    // 2026-09-16 is a Wednesday; its week runs Mon 14th to Sun 20th.
    expect(last.days[0].date).toBe("2026-09-14");
    expect(last.days[6].date).toBe("2026-09-20");
    expect(weeks[0].days[0].date).toBe("2026-08-24");
  });

  it("puts a day's activity under that day's OWN weekday, not its array index", () => {
    // One row, on a Friday. The old grid placed the first row under Monday.
    const weeks = consistencyWeeks([row("2026-09-18", { self_practice: 3, minutes: 12 })], 4, TODAY);
    const last = weeks[weeks.length - 1];
    expect(last.days[4].date).toBe("2026-09-18");
    expect(last.days[4].total).toBe(3);
    expect(last.days[4].minutes).toBe(12);
    // and every other cell in that week is a real zero
    expect(last.days.filter((c) => c.total > 0)).toHaveLength(1);
    expect(last.days[0].total).toBe(0);
  });

  it("counts all four activity kinds, because the grid is about activity", () => {
    const weeks = consistencyWeeks(
      [row("2026-09-15", { test: 1, homework: 2, battles: 1, self_practice: 4 })],
      4,
      TODAY,
    );
    expect(weeks[weeks.length - 1].days[1].total).toBe(8);
  });

  it("drops a day outside the window rather than folding it into the edge", () => {
    const weeks = consistencyWeeks([row("2026-01-01", { self_practice: 9 })], 4, TODAY);
    expect(weeks.flatMap((w) => w.days).some((c) => c.total > 0)).toBe(false);
  });
});

describe("consistencyRatio", () => {
  it("divides active days by the WINDOW, so it is not always 100%", () => {
    // The defect in one line: three active days used to be 3/3.
    const weeks = consistencyWeeks(
      [
        row("2026-09-14", { self_practice: 1 }),
        row("2026-09-15", { self_practice: 1 }),
        row("2026-09-16", { self_practice: 1 }),
      ],
      4,
      TODAY,
    );
    const r = consistencyRatio(weeks);
    expect(r.activeDays).toBe(3);
    expect(r.totalDays).toBe(28);
    expect(r.pct).toBe(11);
  });

  it("POSITIVE CONTROL: a student active every day really does reach 100%", () => {
    // Without this, a function that returned a constant low number would pass
    // the test above.
    const every = consistencyWeeks([], 4, TODAY).flatMap((w) => w.days)
      .map((c) => row(c.date, { self_practice: 1 }));
    const r = consistencyRatio(consistencyWeeks(every, 4, TODAY));
    expect(r.activeDays).toBe(28);
    expect(r.pct).toBe(100);
  });

  it("is 0% for a student with nothing, not NaN", () => {
    expect(consistencyRatio(consistencyWeeks([], 4, TODAY)).pct).toBe(0);
  });
});
