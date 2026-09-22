/**
 * Nova E2E mandate matrix — multi-phrase / multi-role checks (no live network).
 */
import { describe, expect, it } from "vitest";
import { resolveCoachCapability, NOVA_BLOCKED_SCHOOL_RECORD_FEATURES } from "./gatewayClient";
import { mapIntentToCapability } from "./intentMapper";
import { getBuiltinPrompt } from "./promptLibrary";
import { novaConversationsKey } from "@/lib/clientStorage";

const OFFICE = [
  "What is my attendance this month?",
  "Which homework is due tomorrow?",
  "Show my marks in Science",
  "Any upcoming school events or holidays?",
  "How am I doing?",
  "How am I doing — explain my performance",
  "What's on the calendar next week?",
  "When is the next holiday?",
];

const LEARNING = [
  { text: "Explain my weak topics", feature_id: "student.eie.mastery_summary" },
  { text: "Explain photosynthesis to me", feature_id: "student.concept.explain" },
  { text: "What should I revise next?", feature_id: "student.recommendation.next" },
  { text: "I got this question wrong — why?", feature_id: "student.concept.explain" },
  { text: "Write me a study tip for calculus", feature_id: "student.nova.chat" },
];

describe("Nova E2E mandate matrix", () => {
  it("blocks the five office feature ids for students", () => {
    expect([...NOVA_BLOCKED_SCHOOL_RECORD_FEATURES].sort()).toEqual(
      [
        "student.attendance.query",
        "student.calendar.upcoming",
        "student.homework.due",
        "student.marks.summary",
        "student.performance.explain",
      ].sort(),
    );
  });

  it("refuses office phrases for student and student_app without Class redirect", () => {
    for (const text of OFFICE) {
      for (const opts of [{ role: "student" as const }, { channel: "student_app" as const }]) {
        const r = resolveCoachCapability({ text, ...opts });
        expect("unsupported" in r, `${text} ${JSON.stringify(opts)}`).toBe(true);
        if ("unsupported" in r) {
          expect(r.message).not.toMatch(/\bClass\b/);
          expect(r.message).toMatch(/academic doubts|concepts|can't help|don't answer/i);
        }
      }
    }
  });

  it("routes learning phrases for student to tutoring capabilities", () => {
    for (const row of LEARNING) {
      const r = resolveCoachCapability({ text: row.text, role: "student" });
      expect(r, row.text).toEqual({ feature_id: row.feature_id });
    }
  });

  it("keeps office catalog mapping for non-student callers (parent still can map)", () => {
    expect(mapIntentToCapability("What is my attendance this month?")?.feature_id).toBe(
      "student.attendance.query",
    );
  });

  it("prompt forbids office answers and Class redirects", () => {
    const p = getBuiltinPrompt("student.nova.chat");
    expect(p?.system_template).toMatch(/Refuse attendance|academic doubts/i);
    expect(p?.system_template).not.toMatch(/students use Class for those/i);
  });

  it("isolates Nova conversation keys across two student accounts", () => {
    const a = novaConversationsKey({ userId: "stu-a", schoolId: "school-1" });
    const b = novaConversationsKey({ userId: "stu-b", schoolId: "school-1" });
    const c = novaConversationsKey({ userId: "stu-a", schoolId: "school-2" });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(a).toContain("stu-a");
    expect(b).toContain("stu-b");
  });
});
