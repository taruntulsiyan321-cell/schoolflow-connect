import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";

/**
 * NO MEMO MAY READ A BINDING DECLARED BELOW IT.
 *
 * `const` has a temporal dead zone, so a useMemo whose factory closes over a
 * const declared further down the component throws a ReferenceError the
 * moment it runs — and tsc does not see it, because from the type checker's
 * point of view the name is in scope for the whole function body.
 *
 * Not hypothetical: weekComparison was repointed onto activityWeeks on
 * 2026-09-21 while activityWeeks was still declared ~190 lines below it. The
 * page compiled and every source guard passed.
 *
 * RULE 29 — comments are stripped first. The `overview` memo explains, in
 * prose, that a tile "reads studyActivity.totalMinutes now", and matching
 * that sentence reported a correct page as broken.
 */
const RAW = readFileSync(join(__dirname, "Analysis.tsx"), "utf8");
const SOURCE = stripComments(RAW);

/** Only the component. Helpers below it have their own scopes and own consts. */
function componentBody(src: string): string {
  const start = src.indexOf("export default function Analysis()");
  if (start < 0) return "";
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return src.slice(start);
}

const BODY = componentBody(SOURCE);
const lineOf = (offset: number) => BODY.slice(0, offset).split("\n").length;

/** Every `const <name> =` at the component's own indentation, by line. */
function declarations(): Map<string, number> {
  const out = new Map<string, number>();
  const re = /^ {2}const (?:\{([^}]*)\}|(\w+))\s*=/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(BODY)) !== null) {
    const names = m[1]
      ? m[1].split(",").map((n) => n.split(":").pop()!.trim()).filter(Boolean)
      : [m[2]];
    for (const n of names) if (!out.has(n)) out.set(n, lineOf(m.index));
  }
  return out;
}

/** Each memo's body, by matching parentheses from the opening one. */
function memoBodies(): { name: string; line: number; body: string }[] {
  const out: { name: string; line: number; body: string }[] = [];
  const re = /^ {2}const (\w+) = (?:useMemo|useCallback)\(/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(BODY)) !== null) {
    const open = BODY.indexOf("(", m.index + m[0].length - 1);
    let depth = 0;
    let i = open;
    for (; i < BODY.length; i++) {
      if (BODY[i] === "(") depth++;
      else if (BODY[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }
    out.push({ name: m[1], line: lineOf(m.index), body: BODY.slice(open, i + 1) });
  }
  return out;
}

describe("Analysis — hook declaration order", () => {
  const decls = declarations();
  const memos = memoBodies();

  it("actually found the component and its memos", () => {
    // Without this the check below passes against an empty string.
    expect(BODY.length).toBeGreaterThan(1000);
    expect(memos.length).toBeGreaterThan(10);
    expect(decls.has("activityWeeks")).toBe(true);
    expect(decls.has("subjectData")).toBe(true);
  });

  it("can see the ordering it is meant to police", () => {
    // Positive control: weekComparison must come AFTER activityWeeks, and
    // the check must be able to tell.
    expect(decls.get("weekComparison")!).toBeGreaterThan(decls.get("activityWeeks")!);
  });

  it("has no memo reading a const declared below it", () => {
    const offences: string[] = [];
    for (const memo of memos) {
      for (const [name, declLine] of decls) {
        if (name === memo.name || declLine <= memo.line) continue;
        if (new RegExp(`\\b${name}\\b`).test(memo.body)) {
          offences.push(`${memo.name} (line ${memo.line}) reads ${name}, declared at line ${declLine}`);
        }
      }
    }
    expect(offences, offences.join("\n")).toEqual([]);
  });
});
