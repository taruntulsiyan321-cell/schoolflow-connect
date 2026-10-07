import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { practiceAccuracyFromSnapshot } from "./learningMetrics";

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

describe("practice accuracy is practice alone, or absent", () => {
  it("reads the practice field, not the blend beside it", () => {
    // The positive control for this whole file: the two fields hold different
    // numbers, so reading the wrong one cannot pass.
    const s = snap({ accuracy_pct: 83, practice_accuracy_pct: 66.7 });
    expect(practiceAccuracyFromSnapshot(s)).toBe(67);
  });

  it("falls back to the blend only for snapshots predating practice_accuracy_pct", () => {
    expect(practiceAccuracyFromSnapshot(snap({ accuracy_pct: 83 }))).toBe(83);
  });

  it("does NOT fall back when the key is present and null — there is none (ruling 8)", () => {
    // null is a current snapshot saying there IS no practice accuracy. Falling
    // back would relabel the blend as a practice figure.
    expect(practiceAccuracyFromSnapshot(snap({ accuracy_pct: 83, practice_accuracy_pct: null }))).toBeNull();
    expect(practiceAccuracyFromSnapshot(snap(null))).toBeNull();
    expect(practiceAccuracyFromSnapshot(null)).toBeNull();
  });

  it("keeps a real zero — attempted and got none right is a mark, not an absence", () => {
    expect(practiceAccuracyFromSnapshot(snap({ practice_accuracy_pct: 0 }))).toBe(0);
  });
});

/**
 * Strip comments before scanning. Every fix here carries a doc comment that
 * quotes the old wrong label on purpose, and the removal notes name the deleted
 * fields — so an uncommented scan matches the explanation, not the code.
 */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Every .tsx under a directory, so the guard cannot miss a new screen. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(full) && !/\.test\.tsx$/.test(full)) out.push(full);
  }
  return out;
}

const BLEND = /\baccuracy_pct\b|\bstats\??\.accuracy\b/;
const WINDOW = 320;

/**
 * Lines where a "practice accuracy" label sits within WINDOW chars of a
 * blended accuracy. Scanned over a WINDOW, not per line: the first draft of
 * this guard required the label and the value on one line, so it went green
 * against the very defect it was written for the moment the JSX wrapped.
 */
function blendNextToPracticeLabel(src: string): number[] {
  const lines: number[] = [];
  const label = /practice\s+accuracy/gi;
  let m: RegExpExecArray | null;
  while ((m = label.exec(src)) !== null) {
    const around = src.slice(Math.max(0, m.index - WINDOW), Math.min(src.length, m.index + WINDOW));
    if (BLEND.test(around)) lines.push(src.slice(0, m.index).split("\n").length);
  }
  return lines;
}

describe("no student screen labels the blend as practice accuracy", () => {
  const files = walk(join(process.cwd(), "src", "gurukul"));

  it("scans a real, non-empty set of files (control)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('a "practice accuracy" label is never fed from the blended value', () => {
    // The blend can reach a screen only as the snapshot's `accuracy_pct` or as
    // the hook's `stats.accuracy`. The shell profile carries `practiceAccuracy`,
    // which is named for what it holds and cannot be mistaken for the blend.
    // (The WINDOW is explained on blendNextToPracticeLabel.)
    const offenders = files.flatMap((file) =>
      blendNextToPracticeLabel(stripComments(readFileSync(file, "utf8"))).map(
        (line) => `${file}:${line}  "practice accuracy" sits within ${WINDOW} chars of a blended accuracy`,
      ),
    );
    expect(
      offenders,
      `these label a blended accuracy as practice — say "Overall accuracy", or read profile.practiceAccuracy:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("and the scan actually sees the screens that label a practice accuracy (control)", () => {
    // Without this, a stripComments bug that emptied every file would leave the
    // assertion above passing on nothing at all. Named, not counted: the
    // Battleground and Learning hub screens it used to count went with the
    // organisation side (2026-10-01).
    const labelled = files
      .filter((f) => /practice\s+accuracy/i.test(stripComments(readFileSync(f, "utf8"))))
      .map((f) => f.split(sep).join("/").replace(/^.*\/src\//, "src/"))
      .sort();
    expect(labelled).toEqual(["src/gurukul/pages/Analysis.tsx", "src/gurukul/pages/Dashboard.tsx"]);
  });

  it("and the detector fires on a planted blend (mutant)", () => {
    // Home's tile, with the blend put back where the defect had it. If this
    // stops failing the scan above, the scan can no longer see the defect.
    const home = stripComments(
      readFileSync(join(process.cwd(), "src", "gurukul", "pages", "Dashboard.tsx"), "utf8"),
    );
    expect(blendNextToPracticeLabel(home)).toEqual([]);
    const planted = home.replace(
      'label="Practice accuracy"',
      'label="Practice accuracy" value={snapshot.exam_readiness.accuracy_pct}',
    );
    expect(planted).not.toBe(home);
    expect(blendNextToPracticeLabel(planted).length).toBe(1);
  });
});

/**
 * The shape itself, because this defect lived in a TYPE, not in a screen.
 *
 * A field called `accuracy` said nothing about WHICH accuracy, so the docstring
 * claimed the blend, the code set practice, and three screens each guessed
 * differently. Renaming it was the fix; these stop it being undone.
 */
describe("the shell profile cannot go ambiguous again", () => {
  const emptyStudent = stripComments(
    readFileSync(join(process.cwd(), "src", "gurukul", "emptyStudent.ts"), "utf8"),
  );

  it("names the field for the metric it holds", () => {
    expect(emptyStudent).toMatch(/practiceAccuracy: number \| null/);
  });

  it("has no bare `accuracy` field for a screen to guess at", () => {
    // `practiceAccuracy:` must not match, hence the word boundary.
    expect(emptyStudent).not.toMatch(/\baccuracy\s*:/);
  });

  it("defaults absence to null, not 0 (ruling 8)", () => {
    expect(emptyStudent).toMatch(/practiceAccuracy: null/);
  });

  it("and the merge that fills it does not strip a genuine null", () => {
    // The root cause: StudentDashboard filtered null out of the real profile,
    // so EMPTY_STUDENT's default won and every absent metric arrived at every
    // screen as 0 — ruling 8 broken before any screen could honour it.
    const dash = readFileSync(
      join(process.cwd(), "src", "pages", "StudentDashboard.tsx"),
      "utf8",
    );
    expect(dash).toContain('v !== undefined && v !== ""');
    expect(dash).not.toContain("v !== undefined && v !== null");
  });
});
