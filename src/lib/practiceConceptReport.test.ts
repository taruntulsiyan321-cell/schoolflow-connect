/**
 * The concept report on a practice result is not a second opinion on the
 * session.
 *
 * The screen reports a session from its finished row: accuracy over ANSWERED
 * questions, the time its questions took, and an em dash where there is
 * nothing to report. The concept card inside it computed its own — every
 * attempt counted, a skip as a wrong answer, the wall clock as the duration —
 * and the two contradicted each other in front of the student.
 *
 * Measured 2026-09-19, as the Class 10 student over his 40 latest finished
 * sessions:
 *
 *     accuracy disagreed on 24 of 40      "—" vs "0%",  100% vs 50%
 *     23 sessions with no wrong answer still listed a weak concept at 0%
 *     a session with no timing at all was reported as "1m"
 *
 * The server half is 20261043000000; this is the client half.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";
import { buildPracticeRecoveryReport, type PracticeAttemptSnapshot } from "@/lib/practiceSessionSnapshot";

const attempt = (over: Partial<PracticeAttemptSnapshot> = {}): PracticeAttemptSnapshot => ({
  question: "q", options: ["a", "b"], correctIndex: 0, selectedIndex: 0, isCorrect: true, ...over,
});

describe("the practice concept report reports only what was answered", () => {
  it("has no accuracy, and no weak chapter, when every question was skipped", () => {
    const report = buildPracticeRecoveryReport("s1", "Mathematics", "Triangles", [
      attempt({ skipped: true, isCorrect: false }),
      attempt({ skipped: true, isCorrect: false }),
    ]);
    expect(report.accuracy_pct, "a skipped session has no accuracy — 0% is a verdict it cannot make").toBeNull();
    expect(report.total_count).toBe(0);
    expect(report.weak_concepts, "a chapter nobody answered is not a weak chapter").toEqual([]);
  });

  it("POSITIVE CONTROL: it does report an accuracy, and a weak chapter, when questions were answered", () => {
    const report = buildPracticeRecoveryReport("s2", "Mathematics", "Triangles", [
      attempt({ isCorrect: true }),
      attempt({ isCorrect: false }),
      attempt({ skipped: true, isCorrect: false }),
    ]);
    // Over the two ANSWERED, not the three shown.
    expect(report.accuracy_pct).toBe(50);
    expect(report.correct_count).toBe(1);
    expect(report.total_count).toBe(2);
    expect(report.weak_concepts.map((w) => w.chapter)).toEqual(["Triangles"]);
  });

  it("gives no duration unless one was measured", () => {
    const attempts = [attempt()];
    expect(buildPracticeRecoveryReport("s3", "Maths", "Ch", attempts).time_minutes,
      "a floor of one minute reported a seven-second session as a minute").toBeNull();
    expect(buildPracticeRecoveryReport("s4", "Maths", "Ch", attempts, 4).time_minutes).toBe(4);
  });
});

describe("the concept card does not restate the session's figures", () => {
  const CARD = stripComments(
    readFileSync(join(__dirname, "../components/student/ConceptRecoveryReport.tsx"), "utf8"),
  );
  const RESULT = stripComments(
    readFileSync(join(__dirname, "../pages/student/PracticeSessionResult.tsx"), "utf8"),
  );

  it("renders no accuracy, score or time of its own", () => {
    for (const restated of ["accuracy_pct}", "time_minutes}", "correct_count}/", "report.accuracy_pct", "fb.accuracy_pct"]) {
      expect(CARD, `${restated} is the session's figure, and the page above already shows it`)
        .not.toContain(restated);
    }
    // What the card is for is still there.
    expect(CARD).toContain("weak_concepts");
    expect(CARD).toContain("buildRuleConceptReport");
  });

  it("POSITIVE CONTROL: the result page itself still shows them, from the session", () => {
    expect(RESULT).toContain("formatSessionAccuracy(accuracy)");
    expect(RESULT).toContain("{durationLabel}");
    expect(RESULT).toContain("{correct}/{total}");
  });

  it("passes the concept report no invented duration", () => {
    const call = RESULT.slice(RESULT.indexOf("const minutes ="), RESULT.indexOf("buildPracticeRecoveryReport("));
    expect(call, "a floor of one minute is a duration the session did not take")
      .not.toContain("Math.max(1");
    expect(call).toContain(": null");
  });
});
