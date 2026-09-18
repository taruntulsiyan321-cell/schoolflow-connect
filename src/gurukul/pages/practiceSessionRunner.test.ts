/**
 * What the Practice runner does can only be checked WHERE it is written.
 *
 * Every assertion below failed against Practice.tsx as it stood on
 * 2026-09-17, when the tab was driven end to end as a real student against the
 * live school. Each names the defect it guards:
 *
 *   · a timed session recorded 48 questions the student never saw as skipped
 *   · the clock finished the session through a closure from the first render,
 *     so the question actually on screen was recorded with no time at all
 *   · an empty mode created a session row and finished it — "Completed · 0
 *     questions" in history for every tap on a mode with no content
 *   · leaving mid-session left the row unfinished forever: 52 of them, holding
 *     answers that earned nothing and appeared nowhere
 *   · the "Hint" was the first 120 characters of the worked solution — the
 *     whole answer for 8,557 of 21,717 servable questions
 *   · the history date filter asked for a UTC day, so in India every session
 *     before 05:30 was filed under the day before
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";

const SOURCE = stripComments(readFileSync(join(__dirname, "Practice.tsx"), "utf8"));

function section(startNeedle: string, endNeedle: string): string {
  const start = SOURCE.indexOf(startNeedle);
  expect(start, `${startNeedle} has moved or been renamed`).toBeGreaterThan(-1);
  const end = SOURCE.indexOf(endNeedle, start);
  expect(end, `${endNeedle} no longer follows ${startNeedle}`).toBeGreaterThan(start);
  return SOURCE.slice(start, end);
}

describe("a practice session records what the student was shown", () => {
  it("records only the question on screen when the clock runs out", () => {
    const finish = section("async function finish(reason: EndReason)", "function answer(");
    expect(finish).toContain('reason === "timed_out"');
    // The question on screen, once — never a walk over the rest of the pool.
    expect(finish).toContain("qs[idx]");
    expect(finish, "the timeout must not loop over unshown questions").not.toMatch(/for \(let i = idx; i < qs\.length/);
    expect(finish, "the timeout must not iterate the question list at all").not.toMatch(/qs\.(forEach|map|slice)\(/);
  });

  it("reads the live question from a ref the clock cannot stale out", () => {
    const timer = section("if (!config.timeLimitSec", "const leave = () =>");
    expect(timer, "the clock must call the current finish, not the one it was created with")
      .toContain("finishRef.current(\"timed_out\")");
    // A deadline, so a throttled background tab cannot stretch the limit.
    expect(timer).toContain("deadlineRef.current");
    expect(timer, "the clock must not count down by decrementing").not.toMatch(/t - 1/);
  });

  it("starts the session row only once there are questions to sit", () => {
    const loader = section("const rows = await loadSessionQuestions(ctx, config);", "} catch (e) {");
    const start = loader.indexOf("PracticeService.start(");
    const mapped = loader.indexOf("const mapped");
    expect(mapped, "questions must be loaded before the row is created").toBeGreaterThan(-1);
    expect(start, "the session must still be started").toBeGreaterThan(mapped);
    expect(loader).toContain("if (mapped.length > 0)");
    // The patch that created a row for an empty mode and finished it at once.
    expect(SOURCE, "an empty mode must not finish a session it never started")
      .not.toContain("_attempts: [],");
  });

  it("ends a session the student walks away from, with what they answered", () => {
    const leave = section("const leave = () =>", "function snapshotOf(");
    expect(leave).toContain('window.addEventListener("pagehide"');
    expect(leave).toContain('finishRef.current("left")');
    // The unmount is the in-app half: the sidebar, the back button.
    expect(leave).toMatch(/return \(\) => \{[\s\S]*leave\(\);[\s\S]*\};/);
    const finish = section("async function finish(reason: EndReason)", "function answer(");
    expect(finish, "a leave with nothing answered must not finish anything")
      .toContain("attemptLog.current.length <= leftWithRef.current");
  });

  it("waits for answers still in flight before rolling the session up", () => {
    const finish = section("async function finish(reason: EndReason)", "function answer(");
    expect(finish).toContain("await Promise.allSettled([...pendingWrites.current])");
    const record = section("function record(snap: PracticeAttemptSnapshot)", "async function finish(");
    expect(record).toContain("pendingWrites.current.add(write)");
  });

  it("offers no hint, because the bank has no hint — only the solution", () => {
    for (const dead of ["hintPreview", "hintRevealed", "revealHint", "hintUsedRef"]) {
      expect(SOURCE, `${dead} is the hint that gave the answer away`).not.toContain(dead);
    }
    // The explanation still appears, after answering.
    expect(SOURCE).toContain('phase === "fb" && q.explanation');
  });

  it("asks history for the student's own day, not the UTC day", () => {
    expect(SOURCE, "a UTC day boundary files an IST evening under the wrong date")
      .not.toContain("T00:00:00.000Z");
    expect(SOURCE).toContain("localDayBounds(historyFilters.date)");
    const bounds = section("function localDayBounds(day: string)", "function formatSessionDate");
    expect(bounds).toContain("new Date(y, m - 1, d)");
    expect(bounds).toContain("toISOString()");
  });

  it("records a revision check and a recovery session as what they are", () => {
    expect(SOURCE, "a revision check used to be recorded as Chapter Practice")
      .toContain('mode: "revision"');
    expect(SOURCE).toContain('mode: "recovery"');
    expect(SOURCE).toContain("HANDED_OVER_LABELS");
  });

  it("does not build a saved snapshot of its own", () => {
    // One builder, in PracticeService.saveSession, from the row and its attempts.
    expect(SOURCE).not.toContain("buildPracticeAnalysisSnapshot");
    expect(SOURCE).toContain("PracticeService.saveSession(ctx, latest.id)");
  });

  it("offers a failed save the one thing that helps: sending it again", () => {
    const failed = section("function SaveFailed(", "export default function Practice(");
    expect(failed).toContain("Try saving again");
    expect(failed, "history lists finished sessions, so it cannot be finished from there")
      .not.toMatch(/practice history/i);
    expect(failed, "starting a new session would drop these answers").not.toContain("Retry Same Mode");
  });
});
