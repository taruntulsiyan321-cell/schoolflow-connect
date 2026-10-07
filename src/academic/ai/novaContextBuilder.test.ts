/**
 * Nova Context Builder — subject dedupe + placeholder hygiene, in the one
 * module both the app and ai-gateway import.
 */
import { describe, expect, it } from "vitest";
import {
  dedupeSubjects,
  isPlaceholderLabel,
} from "../../../supabase/functions/_shared/novaContextBuilder.ts";
import { buildContextPack, packForModel } from "../../../supabase/functions/_shared/contextBuilder.ts";

describe("Nova Context Builder", () => {
  it("merges Math/Maths/Mathematics aliases", () => {
    expect(dedupeSubjects(["Math", "Maths", "Mathematics", "Physics"])).toEqual([
      "Mathematics",
      "Physics",
    ]);
  });

  it("deduplicates subjects case-insensitively", () => {
    expect(dedupeSubjects(["Mathematics", "mathematics", " Physics ", "Mathematics"])).toEqual([
      "Mathematics",
      "Physics",
    ]);
  });

  it("rejects placeholder labels", () => {
    expect(isPlaceholderLabel("General")).toBe(true);
    expect(isPlaceholderLabel("Subject")).toBe(true);
    expect(isPlaceholderLabel("Topic")).toBe(true);
    expect(isPlaceholderLabel("—")).toBe(true);
    expect(isPlaceholderLabel("Trigonometry")).toBe(false);
  });

  it("Ask Nova handoff is one-shot via sessionStorage", async () => {
    const { setNovaQuestionContext, consumeNovaQuestionContext } = await import(
      "@/gurukul/novaQuestionContext"
    );
    sessionStorage.clear();
    setNovaQuestionContext({
      question: "What is 2+2?",
      options: ["3", "4"],
      correctIndex: 1,
      studentAnswer: "3",
      studentAnswerIndex: 0,
      subject: "Mathematics",
    });
    const ctx = consumeNovaQuestionContext();
    expect(ctx?.question).toBe("What is 2+2?");
    expect(ctx?.studentAnswer).toBe("3");
    expect(consumeNovaQuestionContext()).toBeNull();
  });

  it("packs enriched AE facts for Nova without inventing metrics", () => {
    const pack = buildContextPack({
      capability: "student.nova.chat",
      request_text: "How am I doing?",
      ae: {
        student_profile: {
          projection: "StudentProfileContext",
          class_label: "11-A",
          subjects: ["Mathematics", "Physics"],
          completeness: 1,
          data_version: "profilectx:1",
        },
        practice: {
          projection: "StudentPracticeHistory",
          sessions_completed: 4,
          subjects: ["Mathematics"],
          completeness: 1,
          data_version: "practice:1",
        },
        mistakes: {
          projection: "StudentMistakesBook",
          open_count: 2,
          recent_concepts: ["Integration"],
          completeness: 1,
          data_version: "mistakes:1",
        },
        recovery: {
          projection: "StudentRecoveryQueue",
          pending_count: 1,
          open_concepts: ["Limits"],
          completeness: 1,
          data_version: "recovery:1",
        },
        progression: {
          projection: "StudentProgression",
          study_streak: 5,
          xp: 400,
          level: 3,
          completeness: 1,
          data_version: "prog:1",
        },
      },
      eie: {
        algorithm_id: "eie.mastery.v1",
        avg_mastery: 62,
        weak_concepts: [{ concept: "Integration", subject: "Math", mastery_score: 40 }],
        completeness: 0.9,
        data_version: "eie:1",
      },
      tier_signals: { facts_complete: true },
    });
    const json = packForModel(pack);
    expect(json).toContain("11-A");
    expect(json).toContain("study_streak");
    expect(json).toContain("Integration");
    expect(json).not.toMatch(/attendance_pct|Arjun|1382|Level 14|current_streak/i);
  });
});
