/**
 * CHUNK 10 — the metric primitive.
 *
 * Every metric returns value plus state plus basis. Not a number.
 *
 * WHY value IS `null` UNLESS state IS 'ok'
 *
 * §10 requires that `no_data` be distinguishable from a zero value. A shape like
 * `{ value: 0, state: 'no_data' }` satisfies that on paper and fails in practice:
 * every call site that reads `.value` and forgets `.state` renders 0%, and the
 * screen says a school had nobody present rather than that nobody marked the
 * register. That is the defect this chunk exists to remove — `foundation.ts`
 * carried a never-marked student as `attendance_pct = 0.00` and averaged it in
 * as 0% present.
 *
 * So the type makes it structural. `value` is `T | null`, and it is non-null
 * only when `state === 'ok'`. A component that ignores the state gets `null`,
 * which renders as nothing rather than as a confident wrong number. The
 * discriminated union means TypeScript refuses to let `.value` be read as `T`
 * without narrowing.
 *
 * THE THREE STATES, AND WHY 'not_marked' IS NOT 'no_data'
 *
 *   ok           there was something to compute from, and this is the answer
 *   no_data      nothing exists to compute from — no students, no exams
 *                recorded, no current academic year
 *   not_marked   the thing exists and nobody has filled it in — a section that
 *                has not submitted attendance, an exam whose marks are not
 *                entered
 *
 * They read the same to a naive consumer and mean opposite things to a
 * principal: `no_data` is "there is nothing here", `not_marked` is "somebody
 * owes you this". Collapsing them would hide the second, which is the more
 * actionable of the two.
 */

export type MetricState = "ok" | "no_data" | "not_marked";

export type Metric<T = number> =
  | { state: "ok"; value: T; basis: string }
  | { state: "no_data"; value: null; basis: string }
  | { state: "not_marked"; value: null; basis: string };

/** A computed answer. `basis` says what it was computed FROM, never what it means. */
export function ok<T>(value: T, basis: string): Metric<T> {
  return { state: "ok", value, basis };
}

/** Nothing exists to compute from. */
export function noData<T = number>(basis: string): Metric<T> {
  return { state: "no_data", value: null, basis };
}

/** It exists and nobody has filled it in. */
export function notMarked<T = number>(basis: string): Metric<T> {
  return { state: "not_marked", value: null, basis };
}

/**
 * A percentage from two totals — the only way a percentage is produced in this
 * layer.
 *
 * The denominator is the count of records that EXIST, never the count that
 * could have existed. §10: "Unmarked sections excluded from the denominator,
 * never counted absent." A zero denominator is `not_marked`, never 0%.
 *
 * Rounded to one decimal place: `Math.round(x * 10) / 10`. Percentages are
 * compared against integer thresholds, and a figure that renders as 80.0% must
 * not fail an `>= 80` test because it is really 79.95.
 */
export function pct(numerator: number, denominator: number, basis: string): Metric<number> {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return noData(`${basis} (non-finite input)`);
  }
  if (denominator <= 0) return notMarked(basis);
  return ok(Math.round((numerator / denominator) * 1000) / 10, basis);
}

/**
 * A count. Zero is a real answer here — zero homework assigned IS zero, not
 * missing — so this returns `ok(0)` rather than a state. Callers that need to
 * distinguish "no rows examined" pass `hasSource: false`.
 */
export function count(n: number, basis: string, hasSource = true): Metric<number> {
  if (!hasSource) return noData(basis);
  return ok(n, basis);
}

/**
 * Apply a threshold to a metric.
 *
 * §10: "No threshold fires where record count or student count is zero." A
 * threshold applied to `no_data` or `not_marked` must not produce `false` — that
 * reads as "checked, and fine", which is how an unmarked section becomes an
 * unflagged one. It stays unknown.
 *
 * `direction` is explicit because both are used and neither is a safe default:
 * attendance and homework flag when BELOW, overdue counts flag when ABOVE.
 */
export function flag(
  metric: Metric<number>,
  threshold: number,
  direction: "below" | "at_or_above",
  basis?: string,
): Metric<boolean> {
  if (metric.state !== "ok") {
    return { state: metric.state, value: null, basis: basis ?? metric.basis };
  }
  const fired = direction === "below" ? metric.value < threshold : metric.value >= threshold;
  return ok(fired, basis ?? `${metric.basis}, threshold ${threshold}`);
}

/** Read a metric for display. Returns the fallback for every non-ok state. */
export function valueOr<T, F>(metric: Metric<T>, fallback: F): T | F {
  return metric.state === "ok" ? metric.value : fallback;
}

/** True only when the metric actually carries an answer. */
export function isOk<T>(metric: Metric<T>): metric is { state: "ok"; value: T; basis: string } {
  return metric.state === "ok";
}
