/**
 * Analysis reads the 7C engine, not the retired tables.
 *
 * ── THE DEFECT THIS GUARDS ────────────────────────────────────────────────
 *
 * The Revision and Recovery SCREENS were moved onto chapter_state and
 * rpc_student_recovery_queue. Analysis was not, so the same student got two
 * different answers depending on which page they opened. Measured live,
 * 2026-09-13, for one student:
 *
 *   Analysis "Revision status"   17 pending, 0 done   (snapshot.revision_queue,
 *                                                      every row due CURRENT_DATE
 *                                                      because nothing applied
 *                                                      the §5.3 intervals)
 *   Revision screen              the real ladder off chapter_state
 *
 *   Analysis "still pending"     14   (open recovery_assignments — stubs the old
 *                                     engine made on the FIRST wrong answer,
 *                                     all with questions_completed = 0)
 *   Recovery screen              1 chapter actually ready
 *
 * `completed` was additionally hardcoded to 0, so the "Done" tile could never
 * read anything else.
 */
import { describe, expect, it } from "vitest";
import { deriveRevisionData, deriveRecoveryProgress, deriveRecoveryChapters } from "@/lib/studentAnalysisMetrics";
import type { ChapterStateRow, RecoveryQueueRow } from "@/academic";

function state(p: Partial<ChapterStateRow>): ChapterStateRow {
  return {
    chapter_id: p.chapter_id ?? "c1",
    chapter: "chapter" in p ? (p.chapter ?? null) : "Circles",
    subject: "subject" in p ? (p.subject ?? null) : "Mathematics",
    state: p.state ?? "has_mistakes",
    revision_stage: p.revision_stage ?? 0,
    consecutive_passes: p.consecutive_passes ?? 0,
    next_revision_at: p.next_revision_at ?? null,
    revision_due: p.revision_due ?? false,
    recovered_at: p.recovered_at ?? null,
    last_recovery_readiness: p.last_recovery_readiness ?? null,
    open_mistakes: p.open_mistakes ?? 0,
    revision_fresh_available: p.revision_fresh_available ?? 0,
  };
}

function queued(p: Partial<RecoveryQueueRow>): RecoveryQueueRow {
  return {
    chapter_id: p.chapter_id ?? "c1",
    // `in`, not `??`: the null-label case below passes chapter: null
    // deliberately, and a ?? default would quietly turn it back into a real
    // name — the test would then pass while asserting nothing.
    chapter: "chapter" in p ? (p.chapter ?? null) : "Circles",
    subject: "subject" in p ? (p.subject ?? null) : "Mathematics",
    open_mistakes: p.open_mistakes ?? 1,
    // One, not five. The trigger stopped being a quality bar and became an off
    // switch: one student in production had ever reached five, and zero
    // recovery sessions existed.
    trigger_count: p.trigger_count ?? 1,
    ready: p.ready ?? false,
    mode: p.mode ?? "deep",
    planned_size: p.planned_size ?? 4,
    startable: p.startable ?? true,
    blocked_reason: p.blocked_reason ?? null,
    relearn_above: p.relearn_above ?? 8,
    state: p.state ?? "has_mistakes",
    in_recovery: p.in_recovery ?? false,
    last_recovery_readiness: p.last_recovery_readiness ?? null,
    recovered_at: p.recovered_at ?? null,
    rounds_taken: p.rounds_taken ?? 0,
  };
}

describe("deriveRevisionData", () => {
  it("counts a solid chapter as done, by its passes", () => {
    // §5.3: REVISION_STAGES_TO_SOLID consecutive passes and the chapter is
    // solid.
    //
    // THIS TEST USED TO ASSERT `next_revision_at === null`, and it passed for
    // as long as the database nulled that column on the third pass. The
    // database stopped: "SOLID IS NOT FINISHED — the chapter keeps a check, at
    // REVISION_INTERVAL_SOLID, for ever." The condition became unreachable,
    // "Done" became structurally 0 for every student, and this test went on
    // passing against a fixture that production could no longer produce.
    //
    // So the solid chapter below keeps its date, exactly as a real one does.
    const d = deriveRevisionData([
      state({ chapter_id: "a", consecutive_passes: 3, next_revision_at: "2026-10-17T00:00:00Z" }),
      state({ chapter_id: "b", consecutive_passes: 0, next_revision_at: "2026-09-20T00:00:00Z" }),
    ]);
    expect(d.completed).toBe(1);
    // Both are still SCHEDULED — solid does not leave the queue — but the
    // tiles that render these two numbers sit side by side, so they are
    // reported disjointly: counting the solid chapter in both made two
    // scheduled chapters read as "1 Done, 2 Pending", which sums to three.
    // The database fact this test was written to protect is unchanged and
    // asserted directly below.
    expect(d.pending).toBe(1);
    expect(d.completed + d.pending).toBe(2);
  });

  it("leaves a solid chapter on the schedule, whatever the tiles report", () => {
    // The fact the assertion above used to carry: solid is not finished, the
    // chapter keeps a check at REVISION_INTERVAL_SOLID for ever. If it ever
    // stops carrying a date, `completed` is the figure that must still work
    // — and it is driven by passes, not by that column.
    const solid = state({ chapter_id: "a", consecutive_passes: 3, next_revision_at: "2026-10-17T00:00:00Z" });
    expect(solid.next_revision_at).not.toBeNull();
    expect(deriveRevisionData([solid]).completed).toBe(1);
  });

  it("does not count a chapter one pass short of solid", () => {
    // The control for the assertion above. Two passes is not three, and a
    // rule that counted "has passed at all" would report this as done.
    const d = deriveRevisionData([
      state({ consecutive_passes: 2, next_revision_at: "2026-09-24T00:00:00Z" }),
    ]);
    expect(d.completed).toBe(0);
  });

  it("does not count an untouched chapter as done", () => {
    // A chapter that was never scheduled has no passes either, so it is not
    // finished. Counting it would inflate "Done" with chapters the student has
    // never revised.
    const d = deriveRevisionData([
      state({ consecutive_passes: 0, next_revision_at: null, recovered_at: null }),
    ]);
    expect(d.completed).toBe(0);
  });

  it("takes due-today from the server flag, not its own clock", () => {
    // revision_due is computed against now() in the database. Recomputing the
    // comparison in the browser would drift on any timezone difference.
    const d = deriveRevisionData([
      state({ chapter: "Circles", next_revision_at: "2026-09-01T00:00:00Z", revision_due: true }),
      state({ chapter_id: "b", chapter: "Polynomials", next_revision_at: "2026-12-01T00:00:00Z", revision_due: false }),
    ]);
    expect(d.dueToday).toEqual(["Circles"]);
  });

  it("is empty, not broken, with nothing to revise", () => {
    expect(deriveRevisionData([])).toEqual({ totalRevised: 0, completed: 0, pending: 0, dueToday: [] });
    expect(deriveRevisionData(null).pending).toBe(0);
  });
});

describe("deriveRecoveryProgress", () => {
  it("counts only chapters at the trigger as ready", () => {
    // The distinction the old count could not make: a chapter three mistakes
    // in is a chapter the student is working in, not one pending recovery.
    const p = deriveRecoveryProgress([
      queued({ chapter_id: "a", open_mistakes: 6, ready: true }),
      queued({ chapter_id: "b", open_mistakes: 2, ready: false }),
      queued({ chapter_id: "c", open_mistakes: 1, ready: false }),
    ], []);
    expect(p.stillPending).toBe(1);
    expect(p.totalToRevisit).toBe(3);
  });

  it("reports recovered from the engine's own state word", () => {
    const p = deriveRecoveryProgress(
      [queued({ chapter_id: "a", state: "recovered" }), queued({ chapter_id: "b", state: "has_mistakes" })],
      [state({ chapter_id: "a", state: "recovered" }), state({ chapter_id: "b", state: "has_mistakes" })],
    );
    expect(p.completed).toBe(1);
  });

  it("counts a recovered chapter that has left the queue", () => {
    // A passing recovery clears the chapter's open mistakes (§4.5), so the
    // chapter drops out of the queue. Counted from the queue, the tile read
    // 0 for a student with a chapter recovered and nothing open in it.
    const p = deriveRecoveryProgress(
      [queued({ chapter_id: "b", state: "has_mistakes" })],
      [state({ chapter_id: "a", state: "recovered" }), state({ chapter_id: "b", state: "has_mistakes" })],
    );
    expect(p.completed).toBe(1);
    expect(p.totalToRevisit).toBe(1);
  });
});

/**
 * Renamed from deriveRecoveryTopics on 2026-09-22. The recovery queue is
 * keyed by chapter_id and every row is a chapter; the old name, its `topic`
 * field and the displayTopic() it was rendered through all asked the topic
 * dictionary for a chapter's name.
 */
describe("deriveRecoveryChapters", () => {
  it("separates ready, building and recovered", () => {
    const rows = deriveRecoveryChapters([
      queued({ chapter_id: "a", chapter: "Circles", ready: true, open_mistakes: 6 }),
      queued({ chapter_id: "b", chapter: "Polynomials", ready: false, open_mistakes: 2 }),
      queued({ chapter_id: "c", chapter: "Trigonometry", state: "recovered" }),
    ]);
    expect(rows.map((r) => r.status)).toEqual(["ready", "building", "recovered"]);
  });

  it("carries the counts the card shows instead of an invented percentage", () => {
    // The old card rendered "+N%" built by comparing a mastery score against a
    // weak-topic accuracy from a different table. These are the numbers the
    // engine actually turns on.
    const [row] = deriveRecoveryChapters([queued({ open_mistakes: 2, trigger_count: 5 })]);
    expect(row.openMistakes).toBe(2);
    expect(row.triggerCount).toBe(5);
  });

  it("drops a row with no real chapter label", () => {
    // weak_topics on the snapshot can carry a null topic AND a null chapter —
    // measured live. A nameless card is not information.
    expect(deriveRecoveryChapters([queued({ chapter: null })])).toEqual([]);
  });
});
