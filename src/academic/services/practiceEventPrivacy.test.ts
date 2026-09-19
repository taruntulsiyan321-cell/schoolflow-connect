/**
 * A finished practice session tells the school NOTHING about how it went.
 *
 * §10.8: practice is private to the student — no teacher, parent, principal or
 * aggregate. The practice.session.completed event is not private: admin and
 * principal read academic_events, and process_academic_event copied every
 * event's payload into school_activity_feed, which the whole school reads.
 *
 * PracticeService.finish sent its own arguments as that payload — every
 * question, the option the student chose and whether it was right. Measured
 * 2026-09-18 as the real signed-in people: the principal, the admin, a
 * teacher, a parent and a Class 12 student each read three of a Class 10
 * student's sessions, question by question, from the feed.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";

const emitted: Array<Record<string, unknown>> = [];

vi.mock("./context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./context")>();
  return { ...actual, assertCanOwn: () => {}, assertCanConsume: () => {} };
});
vi.mock("../repository/base", () => ({
  getClient: () => ({ rpc: () => Promise.resolve({ data: { question_count: 1 }, error: null }) }),
  throwIfError: (error: unknown, message: string) => { if (error) throw new Error(message); },
}));
vi.mock("../repository/eventsRepository", () => ({
  emitEvent: (_ctx: unknown, input: Record<string, unknown>) => { emitted.push(input); return Promise.resolve("e"); },
  emitEventBestEffort: () => Promise.resolve(null),
}));
vi.mock("../live", () => ({ broadcastAcademicWrite: () => {} }));
vi.mock("@/lib/studentXpNotify", () => ({ notifyStudentXpUpdated: () => {} }));

const { PracticeService } = await import("./practiceService");

const ctx = { schoolId: "00000000-0000-4000-8000-000000000001", userId: "u", studentId: "s", role: "student" as const };

describe("a finished practice session is private to the student", () => {
  it("emits who finished which session, and nothing about the answers", async () => {
    emitted.length = 0;
    await PracticeService.finish(ctx, {
      _session_id: "session-1",
      _attempts: [{
        bank_question_id: "q1",
        generated_question: { question: "The degree of 5x² − 3x + 1 is:", options: ["0", "1", "2"] },
        selected_answer: { index: 1, text: "1" },
        is_correct: false,
      }],
    });
    expect(emitted).toHaveLength(1);
    const [event] = emitted;
    // Positive control: the event still fires, for the profile refresh.
    expect(event).toMatchObject({ eventType: "practice.session.completed", entityId: "session-1", studentId: "s" });
    expect(JSON.stringify(event.payload ?? {}), "the event must carry no practice content").toBe("{}");
  });

  it("the offline fallback emitter sends no tallies either", () => {
    const source = stripComments(readFileSync(join(__dirname, "../../lib/practiceSessionPersistence.ts"), "utf8"));
    const start = source.indexOf('_event_type: "practice.session.completed"');
    expect(start, "the fallback emitter has moved").toBeGreaterThan(-1);
    const call = source.slice(start, source.indexOf("} as never)", start));
    expect(call).toContain("_payload: {}");
    for (const leaked of ["correct", "wrong", "skipped", "accuracy", "total_time_ms"]) {
      expect(call, `${leaked} is how the session went`).not.toContain(leaked);
    }
  });
});
