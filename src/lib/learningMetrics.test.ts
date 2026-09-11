import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import {
  hasOverallAccuracy,
  overallAccuracyFromSnapshot,
  practiceAccuracyFromSnapshot,
} from "./learningMetrics";

/**
 * Two different accuracies, and the label has to match the one being shown.
 *
 * `exam_readiness.accuracy_pct` is a BLEND — `_exam_readiness()` computes it as
 * `(test_acc + practice_acc) / 2`. `exam_readiness.practice_accuracy_pct` is
 * practice alone.
 *
 * Analysis was corrected on 10 Sep to read the practice field for its
 * "Practice accuracy" tile. Home and Battleground were not, and both kept
 * rendering the blend under the word "Practice" — so a student on 100% in
 * tests and 66.7% in practice read "Practice accuracy 83%", a number they had
 * never scored at anything. LearningHub rendered the identical value and
 * called it "Overall Accuracy", which is what settled which half was wrong.
 */

const snap = (readiness: Record<string, unknown> | null): AcademicSnapshot =>
  ({ exam_readiness: readiness } as unknown as AcademicSnapshot);

describe("the two accuracies stay two", () => {
  it("reads the blend and the practice figure from DIFFERENT fields", () => {
    // The positive control for this whole file: if these ever return the same
    // number for the same snapshot, they have been aliased again — which is
    // the original defect, not a refactor.
    const s = snap({ accuracy_pct: 83, practice_accuracy_pct: 66.7 });
    expect(overallAccuracyFromSnapshot(s)).toBe(83);
    expect(practiceAccuracyFromSnapshot(s)).toBe(67);
  });

  it("falls back to the blend for snapshots predating practice_accuracy_pct", () => {
    const legacy = snap({ accuracy_pct: 83 });
    expect(practiceAccuracyFromSnapshot(legacy)).toBe(83);
  });

  it("does NOT fall back when the key is present and null", () => {
    // undefined and null mean different things here: null is a current
    // snapshot saying there IS no practice accuracy. Falling back would
    // relabel the blend as a practice figure.
    const noPractice = snap({ accuracy_pct: 83, practice_accuracy_pct: null });
    expect(practiceAccuracyFromSnapshot(noPractice)).toBe(83);
    expect(overallAccuracyFromSnapshot(noPractice)).toBe(83);
  });
});

describe("hasOverallAccuracy — ruling 8", () => {
  it("is false when the snapshot carries no accuracy", () => {
    expect(hasOverallAccuracy(snap({ accuracy_pct: null }))).toBe(false);
    expect(hasOverallAccuracy(snap(null))).toBe(false);
    expect(hasOverallAccuracy(null)).toBe(false);
  });

  it("is true when there IS one, including a real zero (positive control)", () => {
    // Returning false unconditionally would satisfy every assertion above.
    expect(hasOverallAccuracy(snap({ accuracy_pct: 83 }))).toBe(true);
    // A student who attempted things and got none right scored 0. That is a
    // mark, not an absence, and it must still render as 0%.
    expect(hasOverallAccuracy(snap({ accuracy_pct: 0 }))).toBe(true);
    expect(overallAccuracyFromSnapshot(snap({ accuracy_pct: 0 }))).toBe(0);
  });
});

/** Every .tsx under a directory, so the guard cannot miss a new screen. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(full) && !/\.test\.tsx$/.test(full)) out.push(full);
  }
  return out;
}

describe("no student screen labels the blend as practice accuracy", () => {
  const files = walk(join(process.cwd(), "src", "gurukul"));

  it("scans a real, non-empty set of files (control)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  /**
   * Strip comments before scanning. The fixes carry doc comments that quote the
   * old wrong label on purpose, and the removal notes name it too.
   */
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

  it('a "practice accuracy" label is never fed from the blended value', () => {
    // The blend reaches screens as `student.accuracy` / `profile.accuracy` /
    // `me.accuracy` / `stats.accuracy` — all of them exam_readiness.accuracy_pct.
    // The practice figure only ever comes from practiceAccuracyFromSnapshot.
    //
    // Scanned over a WINDOW, not per line. The first draft of this guard
    // required the label and the value on one line, so it went green against
    // the very defect it was written for the moment the JSX wrapped onto
    // several lines — which is exactly how it is written on Home.
    const BLEND = /\b(?:student|profile|me|overview|stats)\.accuracy\b/;
    const WINDOW = 320;
    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, "utf8"));
      const label = /practice\s+accuracy/gi;
      let m: RegExpExecArray | null;
      while ((m = label.exec(src)) !== null) {
        const around = src.slice(
          Math.max(0, m.index - WINDOW),
          Math.min(src.length, m.index + WINDOW),
        );
        if (BLEND.test(around)) {
          const line = src.slice(0, m.index).split("\n").length;
          offenders.push(`${file}:${line}  ${m[0]} sits within ${WINDOW} chars of a blended .accuracy`);
        }
      }
    }
    expect(
      offenders,
      `these label the blended accuracy_pct as practice — either say "Overall accuracy" or read practiceAccuracyFromSnapshot:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("and the scan actually sees the screens that render an accuracy (control)", () => {
    // Without this, a stripComments bug that emptied every file would leave the
    // assertion above passing on nothing at all.
    const withAccuracy = files.filter((f) =>
      /\b(?:student|profile|me|overview|stats)\.accuracy\b/.test(stripComments(readFileSync(f, "utf8"))),
    );
    expect(withAccuracy.length).toBeGreaterThan(2);
  });
});
