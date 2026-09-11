import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One state, one design.
 *
 * Nine screens guarded against a missing student id and each rendered the
 * result its own way — a bare centred div at `py-16`, a bare div at `py-24`,
 * a `<GlassCard className="p-8">`, a `<p>` in a flex box, and a `sd-dashboard`
 * wrapper — all showing the identical grey sentence "No student profile linked
 * to this account.", with no icon and nothing telling the student what to do.
 *
 * They now all render `<NoStudentProfile />`. This guard is what stops the
 * tenth screen from inventing a fifth design, which is exactly how the first
 * four happened.
 */

/** Every .tsx/.ts under a directory, so the guard cannot miss a new file. */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const files = walk(join(process.cwd(), "src"));

describe("the no-student-profile state has exactly one design", () => {
  it("scans a real, non-empty set of files (control)", () => {
    // Without this a broken walk() makes every assertion below vacuous.
    expect(files.length).toBeGreaterThan(200);
  });

  it("no screen hand-rolls the sentence any more", () => {
    const offenders: string[] = [];
    for (const file of files) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const code = line.trim();
          // The component's own doc comment quotes the old string on purpose.
          if (code.startsWith("*") || code.startsWith("//")) return;
          if (code.includes("No student profile linked")) {
            offenders.push(`${file}:${i + 1}  ${code.slice(0, 90)}`);
          }
        });
    }
    expect(
      offenders,
      `render <NoStudentProfile /> instead of re-writing this state:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("and the component every one of them now depends on still exists and is used", () => {
    // Positive control: deleting NoStudentProfile, or letting the last caller
    // drift away, would otherwise leave the assertion above passing on an
    // empty codebase.
    const shared = readFileSync(
      join(process.cwd(), "src", "gurukul", "components", "shared.tsx"),
      "utf8",
    );
    expect(shared).toContain("export function NoStudentProfile()");

    const callers = files.filter((f) => readFileSync(f, "utf8").includes("<NoStudentProfile"));
    expect(callers.length, "every screen that had this state should render the component").toBe(9);
  });
});
