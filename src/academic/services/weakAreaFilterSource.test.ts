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
 * ── WHAT CHANGED 2026-09-15 ───────────────────────────────────────────────
 *
 * question_bank has no `concept` or `topic` column any more (20261020010000):
 * a question's topic is its topics row, and a topic is a name INSIDE a
 * chapter. So the window is narrowed by the targets' chapters, and the topic is
 * matched by name only within that chapter — "Journal Entries" weak in one
 * Accountancy chapter must not pull another chapter's Journal Entries.
 *
 * ── WHY A SOURCE ASSERTION ────────────────────────────────────────────────
 *
 * The bug was invisible to every unit test: the SQL was valid, the client
 * matcher was correct, and the mode returned an empty array rather than an
 * error. Only WHERE the filter runs distinguishes the two, and that is exactly
 * what was wrong. G11 — each assertion below fails against the code as it
 * stood before each fix.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";

const SOURCE = stripComments(readFileSync(join(__dirname, "practiceService.ts"), "utf8"));

/** The query-building closure, isolated from the client-side pass below it. */
function buildQuerySection(): string {
  const start = SOURCE.indexOf("const buildQuery = (applyActiveFilter: boolean,");
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

  it("narrows by the targets' chapters, and by topic name when no target has a chapter", () => {
    const build = buildQuerySection();
    // .in() rather than a hand-built or() string: the client library quotes
    // values containing commas and parentheses ("Areas Related to Circles"),
    // which a hand-built in.() list had to remember to do itself.
    expect(build).toContain('.in("chapter"');
    expect(build).toContain('.in("topics.name"');
  });

  it("never filters on the dropped label columns", () => {
    const build = buildQuerySection();
    expect(build).not.toMatch(/\bconcept\.(in|ilike|eq)\b/);
    expect(build).not.toMatch(/"topic"|\btopic\.(in|ilike|eq)\b/);
  });

  it("matches a weak topic by name only inside its own chapter", () => {
    // The pushdown is a window guarantee, not a replacement. The precision pass
    // must check the chapter BEFORE the topic name, or a topic name shared by
    // two chapters would match both.
    const pass = SOURCE.slice(SOURCE.indexOf("targets.some((w) => {"));
    const chapterCheck = pass.indexOf("academicLabelMatches(r.chapter, w.chapter)");
    const topicCheck = pass.indexOf("academicLabelMatches(r.topics?.name ?? null, w.concept)");
    expect(chapterCheck, "the precision pass no longer checks the chapter").toBeGreaterThan(-1);
    expect(topicCheck, "the precision pass no longer matches the topic name").toBeGreaterThan(-1);
    expect(chapterCheck).toBeLessThan(topicCheck);
  });
});
