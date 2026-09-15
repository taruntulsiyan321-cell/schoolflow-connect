/**
 * A session with no attempts is not a session scored zero.
 *
 * ── THE DEFECT THIS GUARDS ────────────────────────────────────────────────
 *
 * Two bugs compounded on production and Analysis showed the result as fact.
 *
 * 1. Weak Areas Practice loaded nothing. listBankQuestions matched weakTargets
 *    ONLY client-side, over a 400-row window of 21,681 approved questions with
 *    no chapter or concept predicate pushed to the database. Measured: 0 of
 *    that window matched the busiest student's weak concepts, against 377
 *    candidates once the filter reaches the query.
 *
 * 2. A session the loader cannot fill is auto-finished (so Resume is not
 *    polluted with shells). That stores correct_count 0 and accuracy 0 while
 *    question_count keeps the REQUESTED count, because
 *    rpc_finish_practice_session only overwrites it when the attempt total is
 *    above zero. So a shell reads as a full 20-question session scored 0%.
 *
 * Analysis averaged those zeros. Measured for the busiest student: 16 finished
 * sessions, 14 of them 0-attempt weak shells, average accuracy reported as
 * 5.3% against a true 42.5% over the 2 sessions they actually sat.
 *
 * G11 — every assertion below fails against the old behaviour, which counted
 * a shell as a session.
 */
import { describe, expect, it } from "vitest";
import { sessionWasAttempted } from "@/hooks/useAnalysisPageData";

describe("sessionWasAttempted", () => {
  it("rejects the shell shape that was being averaged in", () => {
    // Exactly what production holds for those 14 rows: a requested count of
    // 20, nothing attempted, stored accuracy 0.
    expect(
      sessionWasAttempted({ correct_count: 0, wrong_count: 0, skipped_count: 0 }),
    ).toBe(false);
  });

  it("counts a session where everything was answered wrong", () => {
    // The case the filter must NOT swallow. Getting 20 wrong is a real 0%,
    // and it has to keep counting — otherwise this fix would hide exactly the
    // students the product exists to help.
    expect(
      sessionWasAttempted({ correct_count: 0, wrong_count: 20, skipped_count: 0 }),
    ).toBe(true);
  });

  it("counts a session that was only skipped through", () => {
    // §6.6: skipping is a distinct signal, not an absence. The student saw
    // the questions.
    expect(
      sessionWasAttempted({ correct_count: 0, wrong_count: 0, skipped_count: 8 }),
    ).toBe(true);
  });

  it("treats missing counters as zero rather than throwing", () => {
    // wrong_count and skipped_count are nullable on practice_sessions.
    expect(sessionWasAttempted({})).toBe(false);
    expect(sessionWasAttempted({ correct_count: null, wrong_count: null, skipped_count: null })).toBe(false);
    expect(sessionWasAttempted({ correct_count: 3, wrong_count: null })).toBe(true);
  });

  it("does not read question_count, which is what made shells look full", () => {
    // A shell carries question_count 20. If the predicate ever consults it,
    // the shells come straight back.
    expect(
      sessionWasAttempted({
        correct_count: 0,
        wrong_count: 0,
        skipped_count: 0,
        // @ts-expect-error deliberately passing the field the predicate must ignore
        question_count: 20,
      }),
    ).toBe(false);
  });
});
