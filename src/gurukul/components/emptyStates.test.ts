import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, sep } from "node:path";
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

/** `src/gurukul/` — the student panel, NOT the `gurukul-*` sibling panels. */
const STUDENT_PANEL = join("src", "gurukul") + sep;

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

/**
 * The panel drew empty states five ways: the EmptyState component (used by
 * nothing), a `.premium-empty` CSS class defined three times across two files,
 * a `PremiumEmpty` component in Practice.tsx that was never called, hand-rolled
 * `GlassCard p-10` blocks, and bare `<div className="text-center py-8">`s.
 *
 * These pin the two that were deleted outright, so neither can come back as a
 * sixth way of doing the same thing.
 */
describe("the deleted empty-state conventions stay deleted", () => {
  const cssFiles = [
    join(process.cwd(), "src", "index.css"),
    join(process.cwd(), "src", "gurukul", "theme.css"),
  ];

  it("no CSS rule defines .premium-empty again", () => {
    const offenders: string[] = [];
    for (const file of cssFiles) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // The removal notes name the class on purpose; a rule declares it.
          if (/^\s*[^/*]*\.premium-empty(-icon)?\s*(,|\{)/.test(line)) {
            offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 80)}`);
          }
        });
    }
    expect(
      offenders,
      `empty states are the EmptyState component, not a CSS class:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("reads CSS files that really do contain rules (control)", () => {
    // Without this, a bad path would make the assertion above vacuous.
    const declarations = cssFiles
      .map((f) => (readFileSync(f, "utf8").match(/\{/g) ?? []).length)
      .reduce((a, b) => a + b, 0);
    expect(declarations).toBeGreaterThan(100);
  });

  it("no component re-implements EmptyState under another name", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (/(const|function)\s+PremiumEmpty\b/.test(src)) offenders.push(file);
    }
    expect(offenders, `use EmptyState:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("no screen hand-rolls a spinner-and-label loading block", () => {
    // Eighteen screens each wrote their own: three spinner sizes, four
    // paddings, two text sizes, two spacing mechanisms, and not one of them
    // announced itself to a screen reader.
    const offenders: string[] = [];
    for (const file of files) {
      // The STUDENT panel only. `gurukul-admin`, `gurukul-parent`,
      // `gurukul-principal` and `gurukul-teacher` carry the identical defect
      // — 20+ hand-rolled spinner blocks between them — but they are a
      // separate pass, and widening this guard would fail the build on work
      // that has not been done yet.
      if (!file.includes(STUDENT_PANEL)) continue;
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("*") || code.startsWith("//")) return;
        // A spinner sitting directly beside a "Loading …" label is the shape
        // LoadingState replaced. An inline spinner inside a button (Saving…,
        // Signing in…) is a different thing and stays allowed.
        if (/animate-spin/.test(code) && /Loading\s/.test(code)) {
          offenders.push(`${file}:${i + 1}  ${code.slice(0, 90)}`);
        }
      });
    }
    expect(
      offenders,
      `use <LoadingState label="…" /> from components/shared:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("and LoadingState still announces itself to a screen reader", () => {
    // The reason the component exists at all beyond consistency. If this
    // regresses, 19 screens go silent again at once.
    const shared = readFileSync(
      join(process.cwd(), "src", "gurukul", "components", "shared.tsx"),
      "utf8",
    );
    const body = shared.slice(shared.indexOf("export function LoadingState"));
    expect(body).toContain('role="status"');
    expect(body).toContain('aria-live="polite"');

    const callers = files.filter((f) => readFileSync(f, "utf8").includes("<LoadingState"));
    expect(callers.length, "every screen that had a loading block should use it").toBeGreaterThan(12);
  });

  it("and EmptyState carries both variants the panel now depends on", () => {
    const shared = readFileSync(
      join(process.cwd(), "src", "gurukul", "components", "shared.tsx"),
      "utf8",
    );
    expect(shared).toMatch(/variant\?: "page" \| "section"/);
    const sectionUses = files.filter((f) => readFileSync(f, "utf8").includes('variant="section"'));
    expect(sectionUses.length, "section-level empty states should use the variant").toBeGreaterThan(5);
  });
});
