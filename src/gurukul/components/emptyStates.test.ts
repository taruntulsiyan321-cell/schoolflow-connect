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

  /**
   * The guard above could not fail on the worst case it was written for.
   *
   * It required `animate-spin` and the word "Loading" ON THE SAME LINE, so it
   * found every spinner that had a label — and was blind to a spinner with no
   * label at all. Three screens had exactly that: MistakeBook returned a
   * spinning `AlertCircle` (the ERROR icon, rotating, in the error colour),
   * Recovery a spinning `RefreshCw`, Revision a spinning `RotateCcw`. No text,
   * nothing for a screen reader, and on MistakeBook a rotating warning icon as
   * the way a student is told their page is loading. All three sat there while
   * the guard reported the panel clean.
   *
   * The rule that catches them: a spinner in a component's RETURN is a loading
   * *state* and belongs to the design system. A spinner inside a button
   * ("Saving…", "Signing in…") is a different thing and stays allowed — those
   * never sit within a few lines of a `return (`.
   */
  const LOADING_RETURN_LOOKBACK = 6;

  function spinnerReturns(src: string): number[] {
    const lines = src.split("\n");
    const hits: number[] = [];
    lines.forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith("*") || code.startsWith("//")) return;
      if (!/animate-spin/.test(code)) return;
      for (let back = 1; back <= LOADING_RETURN_LOOKBACK && i - back >= 0; back++) {
        if (/\breturn\s*\(/.test(lines[i - back])) {
          hits.push(i + 1);
          return;
        }
      }
    });
    return hits;
  }

  it("catches a BARE spinner too — the shape the label rule could not see", () => {
    // Positive control FIRST. A guard that reports nothing is only evidence if
    // it is shown able to report something, and this exact detector replaced
    // one that silently passed over three live defects.
    const known_bad = [
      "  if (loading) {",
      "    return (",
      '      <div className="flex items-center justify-center py-24">',
      '        <AlertCircle className="w-6 h-6 text-rose-400 animate-spin"/>',
      "      </div>",
      "    );",
      "  }",
    ].join("\n");
    expect(
      spinnerReturns(known_bad),
      "the detector must flag the unlabelled-spinner shape it exists to catch",
    ).toEqual([4]);

    // And it must NOT flag an in-button spinner, or it would be unusable.
    const known_good = [
      "        <button type=\"button\" disabled={saving}>",
      '          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}',
      "        </button>",
    ].join("\n");
    expect(spinnerReturns(known_good), "an in-button spinner is not a page state").toEqual([]);

    const offenders: string[] = [];
    for (const file of files) {
      if (!file.includes(STUDENT_PANEL)) continue;
      // shared.tsx is where LoadingState legitimately lives.
      if (file.endsWith(join("components", "shared.tsx"))) continue;
      for (const lineNo of spinnerReturns(readFileSync(file, "utf8"))) {
        offenders.push(`${file}:${lineNo}`);
      }
    }
    expect(
      offenders,
      `a spinner returned as a screen's loading state must be <LoadingState /> or a skeleton:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("and every loading state still announces itself to a screen reader", () => {
    // The reason these components exist at all beyond consistency. A spinner
    // that says nothing and a grey box that says nothing are the same silence:
    // the screen goes quiet, and some seconds later simply has different
    // content. Both announce.
    const shared = readFileSync(
      join(process.cwd(), "src", "gurukul", "components", "shared.tsx"),
      "utf8",
    );

    const spinner = shared.slice(shared.indexOf("export function LoadingState"));
    expect(spinner).toContain('role="status"');
    expect(spinner).toContain('aria-live="polite"');

    const skeleton = shared.slice(shared.indexOf("export function PageSkeleton"));
    expect(skeleton).toContain('role="status"');
    expect(skeleton).toContain('aria-busy="true"');
    expect(skeleton, "the label is what a screen reader reads out").toContain("aria-label={label}");

    // And the bars themselves must stay hidden — without this a skeleton reads
    // out as a run of empty elements over the top of its own label.
    const bar = shared.slice(shared.indexOf("export function Skeleton"));
    expect(bar.slice(0, 300)).toContain('aria-hidden="true"');
  });

  it("and the skeletons are actually adopted, not another unused primitive", () => {
    // Both of the panel's previous skeleton implementations had ZERO callers
    // while sixteen screens rendered a spinner — an unused `Skeleton` export
    // and a `.skeleton-shimmer` CSS class. This is the assertion that would
    // have caught that, so it is the one worth keeping.
    const adopters = files.filter(
      (f) => f.includes(STUDENT_PANEL) && readFileSync(f, "utf8").includes("<PageSkeleton"),
    );
    expect(
      adopters.length,
      "screens that used to spin should now draw the shape that is arriving",
    ).toBeGreaterThan(15);

    const theme = readFileSync(
      join(process.cwd(), "src", "gurukul", "theme.css"),
      "utf8",
    );
    // Match the RULE, not the name: the removal record in theme.css names the
    // class on purpose, and a guard that trips on its own deletion note is a
    // guard nobody can keep.
    expect(
      theme.match(/\.skeleton-shimmer\s*\{|@keyframes\s+skeleton-shimmer/g) ?? [],
      "the dead shimmer class must not come back",
    ).toEqual([]);
    // Control: the same matcher does find a rule that IS there.
    expect(theme.match(/@keyframes\s+\w+/g)?.length ?? 0).toBeGreaterThan(0);
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
