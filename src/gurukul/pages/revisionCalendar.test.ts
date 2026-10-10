import { describe, expect, it } from "vitest";
import { REVISION_CALENDAR_DAYS, daysUntil, isRevisionDue, revisionCalendar, type RevItem } from "./useRevisionQueueV2";

/**
 * The revision calendar (C6): every scheduled check on the day it falls, in
 * the student's own calendar, for the next two weeks; overdue apart; the rest
 * counted. Dates are built in local time, as the student's day is.
 */
const TODAY = new Date(2026, 9, 10, 15, 30); // 10 Oct, mid-afternoon
const at = (dayOffset: number, hour = 9) => new Date(2026, 9, 10 + dayOffset, hour).toISOString();

const item = (id: string, dueDate: string | null): RevItem => ({
  id, chapter: `Chapter ${id}`, subject: "Accountancy", dueIn: "", dueDate,
  passes: 0, stagesToSolid: 3, openMistakes: 0, freshAvailable: 5, state: "untouched",
});

describe("days until a check", () => {
  it("counts whole days in the student's calendar, whatever the hour", () => {
    expect(daysUntil(at(0, 23), TODAY)).toBe(0);
    expect(daysUntil(at(0, 1), TODAY)).toBe(0);
    expect(daysUntil(at(1, 0), TODAY)).toBe(1);
    expect(daysUntil(at(-1, 23), TODAY)).toBe(-1);
    expect(daysUntil("not a date", TODAY)).toBeNull();
  });
});

describe("the next two weeks (C6)", () => {
  it("puts each check on its day, overdue apart, and counts the ones after", () => {
    const cal = revisionCalendar([
      item("a", at(0)), item("b", at(0, 22)),       // today
      item("c", at(3)),                               // in three days
      item("d", at(-2)),                              // overdue
      item("e", at(REVISION_CALENDAR_DAYS - 1)),      // the last day shown
      item("f", at(REVISION_CALENDAR_DAYS)),          // the first day after
      item("g", null),                                // never scheduled
    ], TODAY);
    expect(cal.days).toHaveLength(REVISION_CALENDAR_DAYS);
    expect(cal.days[0].items.map((r) => r.id)).toEqual(["a", "b"]);
    expect(cal.days[3].items.map((r) => r.id)).toEqual(["c"]);
    expect(cal.days[REVISION_CALENDAR_DAYS - 1].items.map((r) => r.id)).toEqual(["e"]);
    expect(cal.overdue.map((r) => r.id)).toEqual(["d"]);
    expect(cal.later).toBe(1);
    // Every scheduled check is somewhere: 6 of the 7, the unscheduled one nowhere.
    const placed = cal.overdue.length + cal.later + cal.days.reduce((n, d) => n + d.items.length, 0);
    expect(placed).toBe(6);
  });

  it("labels each day with its own date, starting today", () => {
    const cal = revisionCalendar([], TODAY);
    expect(cal.days[0].date.getDate()).toBe(10);
    expect(cal.days[1].date.getDate()).toBe(11);
    // Across the month's end: 10 Oct + 13 = 23 Oct; and 30 days on from 25 Oct would wrap.
    expect(cal.days[13].date.getDate()).toBe(23);
    expect(cal.days[13].date.getMonth()).toBe(9);
  });

  it("agrees with the cards on what is due now", () => {
    // isRevisionDue reads the card's label; the calendar's overdue and today are
    // the same two groups, counted from the same day arithmetic.
    const cal = revisionCalendar([item("d", at(-1)), item("a", at(0))], TODAY);
    expect(cal.overdue.length + cal.days[0].items.length).toBe(2);
    expect(isRevisionDue({ dueIn: "Now" }) && isRevisionDue({ dueIn: "Today" })).toBe(true);
    expect(isRevisionDue({ dueIn: "Tomorrow" })).toBe(false);
  });
});
