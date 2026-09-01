/**
 * CHUNK 10 — homework metrics. One function per metric. Pure.
 *
 * §10: "Homework counts only PAST-DUE work." That is the load-bearing rule here
 * and it is enforced in one place — `pastDue()` — rather than remembered at
 * every call site. Counting work that is not yet due as incomplete is the
 * homework version of counting an unmarked register as absent: it manufactures a
 * failure out of the absence of a deadline.
 *
 * HOMEWORK_WINDOW is the rolling window of DUE DATES that "current homework"
 * covers. It is not a filter on when the work was set.
 */

import { type Metric, noData, notMarked, pct, count, flag } from "./types";
import { HOMEWORK_LOW, HOMEWORK_WINDOW } from "./thresholds";

/** One homework task as it bears on one student. */
export interface HomeworkTask {
  homeworkId: string;
  studentId: string;
  /** ISO date. Work with no due date can never be past due. */
  dueOn: string | null;
  submitted: boolean;
  subject?: string | null;
  /** True when the student was marked absent on the due date. */
  absentOnDueDate?: boolean;
}

/**
 * Past due as of `today`, inclusive of nothing: work due TODAY is not yet late.
 * A task with no due date is never past due — there is no deadline to have
 * missed, and treating null as "overdue since the epoch" would flag every
 * open-ended task in the school.
 */
export function pastDue(t: HomeworkTask, today: string): boolean {
  if (!t.dueOn) return false;
  return t.dueOn < today;
}

/** Within the rolling window of due dates ending today. */
export function inWindow(t: HomeworkTask, today: string, days = HOMEWORK_WINDOW): boolean {
  if (!t.dueOn) return false;
  const end = new Date(`${today}T00:00:00Z`).getTime();
  const start = end - days * 86400000;
  const due = new Date(`${t.dueOn}T00:00:00Z`).getTime();
  return Number.isFinite(due) && due <= end && due > start;
}

// ── Completion ─────────────────────────────────────────────────────────────

/**
 * Completion rate over past-due work.
 *
 * `no_data` when there are no tasks at all; `not_marked` when tasks exist but
 * none is past due yet — that is "nothing is late", not "0% complete", and the
 * two must not render the same.
 */
export function completionRate(tasks: HomeworkTask[], today: string): Metric<number> {
  if (tasks.length === 0) return noData("no homework tasks");

  const due = tasks.filter((t) => pastDue(t, today));
  if (due.length === 0) {
    return notMarked(`${tasks.length} task(s), none past due yet`);
  }
  const done = due.filter((t) => t.submitted).length;
  return pct(done, due.length, `${done} of ${due.length} past-due task(s)`);
}

/** One student's completion. Same rule, narrower input. */
export function studentCompletion(
  tasks: HomeworkTask[],
  studentId: string,
  today: string,
): Metric<number> {
  return completionRate(
    tasks.filter((t) => t.studentId === studentId),
    today,
  );
}

/** Completion within the rolling window — what "current homework" means. */
export function currentCompletion(
  tasks: HomeworkTask[],
  today: string,
  days = HOMEWORK_WINDOW,
): Metric<number> {
  const windowed = tasks.filter((t) => inWindow(t, today, days));
  if (windowed.length === 0) {
    return noData(`no homework due in the last ${days} day(s)`);
  }
  const m = completionRate(windowed, today);
  return m.state === "ok"
    ? { ...m, basis: `${m.basis}, due in the last ${days} day(s)` }
    : m;
}

/** Completion per subject, worst first. Subjects with nothing due are omitted. */
export function completionBySubject(
  tasks: HomeworkTask[],
  today: string,
): Metric<{ subject: string; pct: number; due: number }[]> {
  if (tasks.length === 0) return noData("no homework tasks");

  const bySubject = new Map<string, HomeworkTask[]>();
  for (const t of tasks) {
    const s = (t.subject ?? "").trim();
    if (!s) continue;
    bySubject.set(s, [...(bySubject.get(s) ?? []), t]);
  }
  if (bySubject.size === 0) return noData("no homework task carries a subject");

  const out: { subject: string; pct: number; due: number }[] = [];
  for (const [subject, ts] of bySubject) {
    const m = completionRate(ts, today);
    if (m.state !== "ok") continue; // nothing past due in that subject yet
    out.push({ subject, pct: m.value, due: ts.filter((t) => pastDue(t, today)).length });
  }
  if (out.length === 0) {
    return notMarked(`${bySubject.size} subject(s), none with past-due work`);
  }
  out.sort((a, b) => a.pct - b.pct);
  return { state: "ok", value: out, basis: `${out.length} subject(s) with past-due work` };
}

/**
 * Work missed while the student was absent.
 *
 * Kept separate from the completion rate on purpose. A student who was away when
 * the work fell due has a different problem from one who was present and did not
 * do it, and a single "incomplete" number cannot tell a teacher which. This does
 * not adjust the rate — it says what part of the gap is explained.
 */
export function missedWhileAbsent(
  tasks: HomeworkTask[],
  today: string,
): Metric<{ missed: number; ofIncomplete: number }> {
  const due = tasks.filter((t) => pastDue(t, today));
  if (due.length === 0) return notMarked("no past-due homework");

  const incomplete = due.filter((t) => !t.submitted);
  if (incomplete.length === 0) {
    return {
      state: "ok",
      value: { missed: 0, ofIncomplete: 0 },
      basis: `all ${due.length} past-due task(s) submitted`,
    };
  }
  // absentOnDueDate is optional. Where it was never supplied the question cannot
  // be answered, and answering 0 would read as "none of it was absence".
  if (incomplete.every((t) => t.absentOnDueDate === undefined)) {
    return noData(`${incomplete.length} incomplete task(s), absence on the due date not supplied`);
  }
  const missed = incomplete.filter((t) => t.absentOnDueDate === true).length;
  return {
    state: "ok",
    value: { missed, ofIncomplete: incomplete.length },
    basis: `${missed} of ${incomplete.length} incomplete task(s) fell due while the student was absent`,
  };
}

/** How much work a section has been set — an activity figure, not a rate. */
export function tasksAssigned(tasks: HomeworkTask[]): Metric<number> {
  const ids = new Set(tasks.map((t) => t.homeworkId));
  return count(ids.size, `${ids.size} distinct task(s)`);
}

export function homeworkFlag(metric: Metric<number>): Metric<boolean> {
  return flag(metric, HOMEWORK_LOW, "below");
}
