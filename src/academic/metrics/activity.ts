/**
 * CHUNK 10 — activity metrics: what a teacher or section has actually done.
 *
 * These answer "is anyone doing the work", which is a different question from
 * "how are the students performing", and it is the question the principal's
 * teacher list was answering with invented numbers — every teacher showing
 * 18 homework, 6 tests, 0 marks pending and last active 2 days ago, decorating
 * REAL names with fabricated activity.
 *
 * ZERO IS A REAL ANSWER HERE and `no_data` is not. A teacher who has set no
 * homework has set no homework — that is a measured zero and it should show as
 * one. What must not happen is the reverse: a period nobody has looked at
 * reading as zero activity. So every function below takes an explicit window and
 * says so in `basis`; a count without a window is not interpretable.
 */

import { type Metric, ok, noData, notMarked, pct, count } from "./types";

export interface ActivityWindow {
  from: string;
  to: string;
}

export interface HomeworkSet {
  homeworkId: string;
  teacherId: string | null;
  sectionId: string | null;
  subject?: string | null;
  createdOn: string;
}

export interface TestConducted {
  testId: string;
  teacherId: string | null;
  sectionId: string | null;
  conductedOn: string | null;
}

/** One day's attendance submission for one section. */
export interface SubmissionDay {
  sectionId: string;
  date: string;
  submitted: boolean;
}

const inWindow = (d: string | null, w: ActivityWindow): boolean =>
  !!d && d >= w.from && d <= w.to;

/** Homework set in the window. Zero is a measured zero. */
export function homeworkAssigned(rows: HomeworkSet[], w: ActivityWindow): Metric<number> {
  const n = rows.filter((r) => inWindow(r.createdOn, w)).length;
  return count(n, `${n} task(s) set between ${w.from} and ${w.to}`);
}

/** Tests conducted in the window. */
export function testsConducted(rows: TestConducted[], w: ActivityWindow): Metric<number> {
  const dated = rows.filter((r) => r.conductedOn !== null);
  const n = dated.filter((r) => inWindow(r.conductedOn, w)).length;
  const undated = rows.length - dated.length;
  return ok(
    n,
    `${n} test(s) between ${w.from} and ${w.to}` +
      (undated ? `; ${undated} test(s) have no date and are not counted` : ""),
  );
}

/**
 * The attendance marking record: what share of expected days a section actually
 * submitted.
 *
 * `not_marked` when no day in the window was expected — a section with no
 * scheduled days has not failed to mark anything, and 0% would read as neglect.
 */
export function markingRecord(days: SubmissionDay[], w: ActivityWindow): Metric<number> {
  const expected = days.filter((d) => inWindow(d.date, w));
  if (days.length === 0) return noData("no scheduled days supplied");
  if (expected.length === 0) {
    return notMarked(`no scheduled day between ${w.from} and ${w.to}`);
  }
  const done = expected.filter((d) => d.submitted).length;
  return pct(done, expected.length, `${done} of ${expected.length} expected day(s) submitted`);
}

/**
 * Days since the last sign of activity — homework set or test conducted.
 *
 * `no_data` when there has been NO activity ever, because "days since never" is
 * not a number. A screen showing "last active: 0 days" for a teacher who has
 * never set anything is the same class of lie as 0% attendance for an unmarked
 * register.
 */
export function daysSinceLastActivity(
  homework: HomeworkSet[],
  tests: TestConducted[],
  today: string,
): Metric<number> {
  const dates = [
    ...homework.map((h) => h.createdOn),
    ...tests.map((t) => t.conductedOn),
  ].filter((d): d is string => !!d);

  if (dates.length === 0) return noData("no homework set and no test conducted, ever");

  const latest = dates.reduce((a, b) => (a > b ? a : b));
  const t = new Date(`${latest}T00:00:00Z`).getTime();
  const now = new Date(`${today}T00:00:00Z`).getTime();
  if (!Number.isFinite(t)) return noData(`last activity date "${latest}" is not parseable`);

  return ok(Math.max(0, Math.floor((now - t) / 86400000)), `last activity ${latest}`);
}

/** Distinct subjects a teacher has actually set work in. */
export function subjectsTaught(homework: HomeworkSet[]): Metric<string[]> {
  const subjects = [
    ...new Set(homework.map((h) => (h.subject ?? "").trim()).filter(Boolean)),
  ].sort();
  if (homework.length === 0) return noData("no homework set");
  if (subjects.length === 0) return notMarked(`${homework.length} task(s), none carrying a subject`);
  return ok(subjects, `${subjects.length} subject(s) across ${homework.length} task(s)`);
}

/** Distinct sections a teacher has set work for. */
export function sectionsTaught(
  homework: HomeworkSet[],
  tests: TestConducted[],
): Metric<number> {
  const ids = new Set(
    [...homework.map((h) => h.sectionId), ...tests.map((t) => t.sectionId)].filter(Boolean),
  );
  const total = homework.length + tests.length;
  if (total === 0) return noData("no homework or tests");
  return count(ids.size, `${ids.size} section(s) across ${total} item(s)`);
}
