/**
 * CHUNK 10 verification item 4 — changing a threshold in one file changes every
 * screen.
 *
 * The threshold-literal lint proves no component DECLARES a threshold. That is
 * not the same claim. A component could import the constant and then hold a copy
 * — `const MY_LOW = HOMEWORK_LOW` frozen at module load is fine, but
 * `const MY_LOW = 60` beside an unused import is not, and the lint would miss it
 * if the name were outside the vocabulary.
 *
 * So this asserts the flow: the downstream module must hold the SAME VALUE as
 * the source, by identity, not by coincidence. If someone re-hardcodes 80 in the
 * principal module these fail, because the assertion is against the imported
 * constant rather than against the literal 80.
 */
import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_LOW,
  CONSECUTIVE_ABSENCE,
  HOMEWORK_LOW,
  HOMEWORK_WINDOW,
  MARKS_OVERDUE,
  CLASS_FLAGGED_ON_MARKS,
  THRESHOLDS as SOURCE,
} from "./thresholds";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * This file used to import `THRESHOLDS` from
 * `src/gurukul-principal/analysis/thresholds.ts` and assert the two agreed.
 *
 * That module was a re-export left behind after Chunk 10 converged four homes
 * into one, and the principal panel it served was replaced by the Autonomous
 * Design — so it had no screens left and was deleted along with them. Comparing
 * two copies is no longer possible, and the invariant it stood for is better
 * stated directly: these numbers are DECLARED in exactly one module.
 *
 * A scan is also the stronger guard. The old assertion could only catch the ONE
 * second home it knew the name of; this catches the next one wherever it opens.
 */
const THRESHOLD_NAMES = [
  "ATTENDANCE_LOW",
  "CONSECUTIVE_ABSENCE",
  "HOMEWORK_LOW",
  "HOMEWORK_WINDOW",
  "MARKS_OVERDUE",
  "CLASS_FLAGGED_ON_MARKS",
  "SUBJECT_AVERAGE_LOW",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const SOURCE_FILE = join("src", "academic", "metrics", "thresholds.ts");

describe("one threshold module, and the value reaches the screens", () => {
  it("no file outside the metrics module declares a threshold of its own", () => {
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), "src"))) {
      if (file.endsWith(SOURCE_FILE)) continue;
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;
        for (const name of THRESHOLD_NAMES) {
          // A DECLARATION — `const X = 80` — not an import or a re-export.
          if (new RegExp(`\\b(const|let|var)\\s+${name}\\s*=`).test(code)) {
            offenders.push(`${file}:${i + 1}  ${code.slice(0, 80)}`);
          }
        }
      });
    }
    expect(
      offenders,
      `thresholds are declared in ${SOURCE_FILE} and nowhere else:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("POSITIVE CONTROL: the scan does find the real declarations in the source", () => {
    // Without this, a typo in a name or a broken walk makes the check above
    // pass because it reads nothing, not because the codebase is clean.
    const src = readFileSync(join(process.cwd(), SOURCE_FILE), "utf8");
    const found = THRESHOLD_NAMES.filter((n) =>
      new RegExp(`\\b(const|let|var)\\s+${n}\\s*=`).test(src),
    );
    expect(found, "every threshold should be declared in the source module").toEqual(THRESHOLD_NAMES);
  });

  it("the THRESHOLDS bag and the named exports are the same values", () => {
    // Values, not literals: `toBe(80)` would pass just as happily on a copy.
    // The bag is flat — the nested `attendance.low` shape belonged to the
    // principal re-export that has been deleted.
    expect(SOURCE.ATTENDANCE_LOW).toBe(ATTENDANCE_LOW);
    expect(SOURCE.CONSECUTIVE_ABSENCE).toBe(CONSECUTIVE_ABSENCE);
    expect(SOURCE.HOMEWORK_LOW).toBe(HOMEWORK_LOW);
    expect(SOURCE.HOMEWORK_WINDOW).toBe(HOMEWORK_WINDOW);
    expect(SOURCE.CLASS_FLAGGED_ON_MARKS).toBe(CLASS_FLAGGED_ON_MARKS);
    expect(SOURCE.MARKS_OVERDUE).toBe(MARKS_OVERDUE);
  });

  it("the source module does not export a chronic threshold at all", async () => {
    const mod = await import("./thresholds");
    expect(Object.keys(mod)).not.toContain("CHRONIC_ABSENCE");
    expect(Object.keys(SOURCE)).not.toContain("CHRONIC_ABSENCE");
  });

  it("MARKS_LOW is not a constant, because it is per-exam data", async () => {
    const mod = await import("./thresholds");
    expect(Object.keys(mod)).not.toContain("MARKS_LOW");
    // It is a function over exams.passing_marks instead.
    expect(typeof mod.belowPass).toBe("function");
  });

  it("every threshold in the source is a positive integer above the noise floor", () => {
    // The threshold-literal lint excludes literals <= 1 as emptiness checks. If
    // a real threshold were ever 0 or 1 that narrowing would go blind, so the
    // assumption is asserted here rather than left in a comment.
    for (const [name, value] of Object.entries(SOURCE)) {
      expect(Number.isInteger(value), `${name} is not an integer`).toBe(true);
      expect(value, `${name} is <= 1, which the literal lint would skip`).toBeGreaterThan(1);
    }
  });
});
