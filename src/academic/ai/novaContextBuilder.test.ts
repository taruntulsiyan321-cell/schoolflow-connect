/**
 * Nova Context Builder — chip/subject dedupe + placeholder hygiene.
 */
import { describe, expect, it } from "vitest";
import {
  buildNovaUiChips,
  dedupeSubjects,
  isPlaceholderLabel,
} from "./novaContextBuilder";
import { buildContextPack, packForModel } from "./contextBuilder";

describe("Nova Context Builder", () => {
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

  it("builds unique chips from live signals without placeholders", () => {
    const chips = buildNovaUiChips({
      classLabel: "11-A",
      subjects: ["Mathematics", "mathematics", "Physics", "General", "Subject"],
      homeworkPending: 2,
      attendancePct: 91,
      practiceSessions: 4,
      mistakeCount: 3,
      recoveryPending: 1,
      xp: 1200,
      level: 5,
      studyStreak: 7,
      weakConcepts: ["Sin Values", "Sin Values", "Topic"],
      goal: "",
    });
    const labels = chips.map((c) => c.label);
    expect(labels.filter((l) => /Mathematics/i.test(l)).length).toBeLessThanOrEqual(1);
    expect(labels.some((l) => l === "General" || l === "Subject" || l === "Topic")).toBe(false);
    expect(labels.some((l) => /study streak/i.test(l))).toBe(true);
    expect(labels.some((l) => /HW pending/i.test(l))).toBe(true);
    expect(labels.some((l) => /Attendance/i.test(l))).toBe(true);
    expect(labels.some((l) => /Weak: Sin Values/i.test(l))).toBe(true);
    // No invented demo chips when zeros
    const empty = buildNovaUiChips({
      subjects: [],
      homeworkPending: 0,
      attendancePct: 0,
      practiceSessions: 0,
      mistakeCount: 0,
      recoveryPending: 0,
      xp: 0,
      level: 1,
      studyStreak: 0,
      weakConcepts: [],
    });
    expect(empty).toEqual([]);
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
        attendance: {
          projection: "StudentAttendanceQuery",
          attendance_pct: 91,
          completeness: 1,
          data_version: "att:1",
        },
        homework: {
          projection: "StudentHomeworkDue",
          pending_count: 1,
          completeness: 1,
          data_version: "hw:1",
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
    expect(json).not.toMatch(/Arjun|1382|Level 14|current_streak/i);
  });
});
