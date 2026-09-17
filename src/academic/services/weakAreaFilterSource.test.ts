/**
 * Practice must filter in the DATABASE, not in the browser — and only on
 * columns question_bank actually has.
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
 * ── THE TAXONOMY IS topic_id -> topics.name (20261020000000/010000) ───────
 *
 * question_bank has no `topic`, `concept` or `topic_group` column. Naming one
 * fails the WHOLE PostgREST request with 42703, which the UI renders as
 * "Could not start practice" — measured 2026-09-15:
 *
 *   select=id,subject,chapter,topic,concept,...  -> 400 42703
 *   select=id,subject,chapter,...                -> 200
 *
 * Topics are per chapter (§10.22): the same name in two chapters is two
 * topics. So a topic ID is filtered exactly, a topic NAME is matched only
 * inside its chapter when the chapter is known, and a weak topic ("Journal
 * Entries" in one Accountancy chapter) never pulls another chapter's.
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
  // Anchored on the name and the first parameter, so the guard survives a
  // second parameter without going blind.
  const start = SOURCE.indexOf("const buildQuery = (applyActiveFilter: boolean,");
  expect(start, "buildQuery has been renamed or removed").toBeGreaterThan(-1);
  const end = SOURCE.indexOf("return query;", start);
  expect(end, "buildQuery no longer returns the query").toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

/** The client-side precision pass over the rows that came back. */
function precisionPass(): string {
  const start = SOURCE.indexOf("let rows = (data ?? [])");
  expect(start, "the precision pass has moved").toBeGreaterThan(-1);
  // SOURCE has its comments stripped, so the anchor is the shuffle's code.
  const end = SOURCE.indexOf("for (let i = rows.length - 1", start);
  expect(end, "the precision pass no longer ends at the shuffle").toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe("practice filters reach the database", () => {
  it("pushes weakTargets into the query, not just the client pass", () => {
    const build = buildQuerySection();
    expect(
      build.includes("opts.weakTargets"),
      "weakTargets must be consulted while BUILDING the query; matching it only after the rows come back is the bug",
    ).toBe(true);
  });

  it("narrows weak targets by chapter, and by topic name when no target has a chapter", () => {
    const build = buildQuerySection();
    // .in() rather than a hand-built in.() string: the client library quotes
    // values containing commas and parentheses ("Areas Related to Circles"),
    // which a hand-built list had to remember to do itself.
    expect(build).toContain('.in("chapter"');
    expect(build).toContain('.in("topics.name"');
  });

  it("never names a question_bank column that does not exist", () => {
    const build = buildQuerySection();
    for (const dead of [
      "topic.ilike.", "concept.ilike.", "topic.in.", "concept.in.",
      "topic_group",
    ]) {
      expect(build, `${dead} names a column question_bank does not have`).not.toContain(dead);
    }
    // The select list, specifically: bare `topic`/`concept` between commas.
    expect(build).not.toMatch(/select\([^)]*[ ,`"]topic[ ,`"]/);
    expect(build).not.toMatch(/select\([^)]*[ ,`"]concept[ ,`"]/);
  });

  it("reads the topic label from the embedded topics row", () => {
    const build = buildQuerySection();
    // A template, because the embed switches to !inner when a topic NAME is
    // being narrowed on.
    expect(build).toMatch(/topics\$\{[^}]*\}\(name\)/);
  });

  it("filters a topic id exactly, on topic_id", () => {
    // The picker hands out ids. An id is one chapter's topic; matching it by
    // name instead would pull a same-named topic from another chapter.
    const build = buildQuerySection();
    expect(build).toContain('.eq("topic_id", topicId)');
  });

  it("narrows a topic name in the database, not just in the browser", () => {
    // Topic practice can start with NO chapter, and the 400-row window is
    // smaller than several banks (Mathematics class 12: 695 approved questions
    // over 125 topics). A topic in the unfetched remainder returned nothing.
    const build = buildQuerySection();
    expect(build).toContain('"topics.name"');
    expect(build).toContain("!inner");
  });

  it("still runs the client-side precision pass afterwards, on the embedded name", () => {
    // The pushdown is a window guarantee, not a replacement: the client
    // matcher handles display-cleaned labels an exact SQL filter would miss.
    // Losing it would silently widen every weak session.
    const pass = precisionPass();
    expect(pass).toContain("academicLabelMatches(r.topics?.name ?? null, needle)");
    expect(pass).toContain("r.topic_id === topicId");
  });

  it("matches a weak topic by name only inside its own chapter", () => {
    // The precision pass must check the chapter BEFORE the topic name, or a
    // topic name shared by two chapters would match both.
    const pass = SOURCE.slice(SOURCE.indexOf("targets.some((w) => {"));
    const chapterCheck = pass.indexOf("academicLabelMatches(r.chapter, w.chapter)");
    const topicCheck = pass.indexOf("academicLabelMatches(r.topics?.name ?? null, w.concept)");
    expect(chapterCheck, "the precision pass no longer checks the chapter").toBeGreaterThan(-1);
    expect(topicCheck, "the precision pass no longer matches the topic name").toBeGreaterThan(-1);
    expect(chapterCheck).toBeLessThan(topicCheck);
  });
});
