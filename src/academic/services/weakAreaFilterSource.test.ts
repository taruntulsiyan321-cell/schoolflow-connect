/**
 * Weak Areas Practice must filter in the DATABASE, not in the browser.
 *
 * ── THE DEFECT THIS GUARDS ────────────────────────────────────────────────
 *
 * listBankQuestions built a query with no chapter or concept predicate —
 * "every approved active question for this class and board" — capped at 400
 * rows, and then matched weakTargets against whatever came back. With 21,681
 * approved questions the window almost never held the handful matching a given
 * student's weak concepts, so the mode loaded nothing and the session was
 * auto-finished as a 0-attempt shell at 0%.
 *
 * Measured on production, 2026-09-13:
 *
 *   matches inside the 400-row window, for the busiest student:    0
 *   candidates once chapter/concept reach the query:             377
 *   that student's finished sessions:  16, of which 14 were empty weak shells
 *
 * ── WHY A SOURCE ASSERTION ────────────────────────────────────────────────
 *
 * The bug was invisible to every unit test: the SQL was valid, the client
 * matcher was correct, and the mode returned an empty array rather than an
 * error. Only WHERE the filter runs distinguishes the two, and that is exactly
 * what was wrong. G11 — each assertion below fails against the code as it
 * stood.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";

const SOURCE = stripComments(readFileSync(join(__dirname, "practiceService.ts"), "utf8"));

/** The query-building closure, isolated from the client-side pass below it. */
function buildQuerySection(): string {
  const start = SOURCE.indexOf("const buildQuery = (applyActiveFilter: boolean)");
  expect(start, "buildQuery has been renamed or removed").toBeGreaterThan(-1);
  const end = SOURCE.indexOf("return query;", start);
  expect(end, "buildQuery no longer returns the query").toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe("weak areas filter reaches the database", () => {
  it("pushes weakTargets into the query, not just the client pass", () => {
    const build = buildQuerySection();
    expect(
      build.includes("opts.weakTargets"),
      "weakTargets must be consulted while BUILDING the query; matching it only after the rows come back is the bug",
    ).toBe(true);
  });

  it("constrains on chapter and concept, the columns the targets name", () => {
    const build = buildQuerySection();
    expect(build).toContain("concept.in.");
    expect(build).toContain("chapter.in.");
  });

  it("still runs the client-side precision pass afterwards", () => {
    // The pushdown is a window guarantee, not a replacement: the client
    // matcher handles display-cleaned and mojibake labels that an exact SQL
    // `in` would miss. Losing it would silently widen every weak session.
    expect(SOURCE).toContain("academicLabelMatches(r.concept, needle)");
  });

  it("quotes the values it interpolates into the or() clause", () => {
    // Chapter names carry spaces and commas ("Areas Related to Circles"), and
    // an unquoted PostgREST in.() list would split on them and match nothing —
    // reintroducing the empty-session bug through a different door.
    const build = buildQuerySection();
    expect(build).toMatch(/const quote = /);
  });
});
