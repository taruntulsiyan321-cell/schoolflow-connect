import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Every grid names its columns, on a phone too (2026-10-03).
 *
 * A grid that names columns only from a breakpoint up — `grid sm:grid-cols-2` —
 * has, below it, one implicit column sized to its content. One unwrappable line
 * inside (a `truncate`d chapter name, a row of buttons) then sets that column's
 * width, and the page scrolls sideways: Recovery's cards were 432px wide on a
 * 320px phone, Practice's history 358px. `grid-cols-1` is
 * repeat(1, minmax(0, 1fr)): the column is the screen's width, and what is
 * inside wraps or truncates as it was written to.
 *
 * Grids that place one thing (`place-*`) or flow by rows or columns
 * (`grid-rows-*`, `grid-flow-col`) are not column layouts and are not read.
 */

const CLASS_LIST = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{cn\(([\s\S]*?)\)\})/g;

export function gridsWithoutColumns(source: string): number[] {
  const lines: number[] = [];
  let m: RegExpExecArray | null;
  CLASS_LIST.lastIndex = 0;
  while ((m = CLASS_LIST.exec(source))) {
    const tokens = (m[1] ?? m[2] ?? m[3] ?? "").split(/[\s"'`,]+/);
    if (!tokens.includes("grid")) continue;
    if (tokens.some((t) => /^(grid-cols-|grid-rows-|grid-flow-col|place-)/.test(t))) continue;
    lines.push(source.slice(0, m.index).split("\n").length);
  }
  return lines;
}

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

describe("every grid names its columns", () => {
  it("POSITIVE CONTROL: a grid with columns only from a breakpoint up is caught; one with a phone column is not", () => {
    expect(gridsWithoutColumns(`<div className="grid sm:grid-cols-2 gap-3">`)).toEqual([1]);
    expect(gridsWithoutColumns(`a\n<div className={\`grid gap-3 \${x}\`}>`)).toEqual([2]);
    expect(gridsWithoutColumns(`<div className={cn("grid", wide && "lg:grid-cols-3")}>`)).toEqual([1]);
    expect(gridsWithoutColumns(`<div className="grid grid-cols-1 sm:grid-cols-2">`)).toEqual([]);
    expect(gridsWithoutColumns(`<div className="grid place-items-center">`)).toEqual([]);
    expect(gridsWithoutColumns(`<div className="grid-cols-2 gridline">`)).toEqual([]);
  });

  it("in every screen and component", () => {
    const root = join(__dirname, "..");
    const files = tsxFiles(root);
    // The walk reached the screens: these hold grids, and must be read.
    for (const known of ["gurukul/pages/Recovery.tsx", "gurukul/pages/Analysis.tsx", "components/learn/ExplainPanel.tsx"]) {
      expect(files.map((f) => relative(root, f).split("\\").join("/"))).toContain(known);
    }
    const found = files.flatMap((f) =>
      gridsWithoutColumns(readFileSync(f, "utf8")).map((line) => `${relative(root, f)}:${line}`),
    );
    expect(found).toEqual([]);
  });
});
