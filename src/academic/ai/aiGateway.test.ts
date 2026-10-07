import { describe, expect, it } from "vitest";
import {
  getCapability,
  isModelAllowed,
} from "../../../supabase/functions/_shared/capabilityCatalog.ts";
import {
  resolveCoachCapability,
  isAiBillingOrCreditsIssue,
  AI_BILLING_UNAVAILABLE_MSG,
} from "./gatewayClient";
import { mapIntentToCapability } from "./intentMapper";
import { sessionScopeForCapability } from "../../../supabase/functions/_shared/sessionMemory.ts";
import { stripComments } from "@/test/stripComments";

describe("capability catalog", () => {
  it("rejects unknown feature", () => {
    expect(getCapability("student.made_up.thing")).toBeNull();
  });

  it("registers deterministic student capabilities", () => {
    for (const id of [
      "student.attendance.query",
      "student.homework.due",
      "student.marks.summary",
      "student.calendar.upcoming",
      "student.eie.mastery_summary",
      "student.performance.explain",
      "student.concept.explain",
      "student.recommendation.next",
      "parent.child.summary",
      "parent.child.narrative",
    ]) {
      expect(getCapability(id)?.feature_id).toBe(id);
    }
  });
});

describe("model policy in the catalogue the router reads", () => {
  it("never lets a model answer a school record", () => {
    for (const id of [
      "student.attendance.query",
      "student.homework.due",
      "student.marks.summary",
      "student.calendar.upcoming",
      "student.eie.mastery_summary",
      "parent.child.summary",
      "parent.child.narrative",
    ]) {
      const cap = getCapability(id);
      expect(cap, id).not.toBeNull();
      expect(isModelAllowed(cap!), id).toBe(false);
    }
  });

  it("lets a model explain performance", () => {
    expect(isModelAllowed(getCapability("student.performance.explain")!)).toBe(true);
  });
});

describe("intent mapping / golden routes", () => {
  it("maps attendance / homework / marks / mastery phrases", () => {
    expect(mapIntentToCapability("What is my attendance this month?")?.feature_id).toBe(
      "student.attendance.query",
    );
    expect(mapIntentToCapability("Which homework is due tomorrow?")?.feature_id).toBe(
      "student.homework.due",
    );
    expect(mapIntentToCapability("Show my marks in Science")?.feature_id).toBe(
      "student.marks.summary",
    );
    expect(mapIntentToCapability("Any upcoming school events or holidays?")?.feature_id).toBe(
      "student.calendar.upcoming",
    );
    expect(mapIntentToCapability("What should I revise? Show mastery")?.feature_id).toBe(
      "student.eie.mastery_summary",
    );
    expect(mapIntentToCapability("How am I doing — explain my performance")?.feature_id).toBe(
      "student.performance.explain",
    );
  });

  it("maps weak* plurals to mastery and revise-next to recommendation", () => {
    expect(mapIntentToCapability("Explain my weak topics")?.feature_id).toBe(
      "student.eie.mastery_summary",
    );
    expect(mapIntentToCapability("Summarise my weak concepts")?.feature_id).toBe(
      "student.eie.mastery_summary",
    );
    expect(mapIntentToCapability("Which are my weakest topics?")?.feature_id).toBe(
      "student.eie.mastery_summary",
    );
    expect(mapIntentToCapability("What should I revise next?")?.feature_id).toBe(
      "student.recommendation.next",
    );
    expect(mapIntentToCapability("Explain this concept to me")?.feature_id).toBe(
      "student.concept.explain",
    );
    // concept.explain wins over broad /\bmarks?\b/
    expect(
      mapIntentToCapability("Explain how marks are calculated in physics")?.feature_id,
    ).toBe("student.concept.explain");
  });

  it("AICoach SUGGESTIONS chips map to learning capabilities (student)", () => {
    // Keep in sync with SUGGESTIONS in src/gurukul/pages/AICoach.tsx
    const chips: Array<{ text: string; feature_id: string }> = [
      { text: "Explain my weak topics", feature_id: "student.eie.mastery_summary" },
      { text: "Which are my weakest topics?", feature_id: "student.eie.mastery_summary" },
      { text: "What should I do to improve them?", feature_id: "student.recommendation.next" },
      { text: "Explain this concept to me", feature_id: "student.concept.explain" },
      // Wrong-answer tutoring → concept.explain (not marks.summary); nova.chat also acceptable.
      { text: "I got this question wrong — why?", feature_id: "student.concept.explain" },
      { text: "What should I revise next?", feature_id: "student.recommendation.next" },
    ];
    expect(chips).toHaveLength(6);
    for (const chip of chips) {
      const resolved = resolveCoachCapability({ text: chip.text, role: "student" });
      expect(resolved, chip.text).toEqual({ feature_id: chip.feature_id });
    }
  });

  it("free text maps to student.nova.chat (Gateway generative)", () => {
    const r = resolveCoachCapability({ text: "Write me a study tip for calculus" });
    expect("unsupported" in r).toBe(false);
    if (!("unsupported" in r)) {
      expect(r.feature_id).toBe("student.nova.chat");
    }
  });

  it("keeps mapped intents ahead of nova.chat fallback when not student channel", () => {
    expect(resolveCoachCapability({ text: "What is my attendance this month?" })).toEqual({
      feature_id: "student.attendance.query",
    });
  });

  it("refuses school-office intents for student role / student_app channel", () => {
    for (const text of [
      "What is my attendance this month?",
      "Which homework is due tomorrow?",
      "Show my marks in Science",
      "Any upcoming school events or holidays?",
      "How am I doing — explain my performance",
    ]) {
      const byRole = resolveCoachCapability({ text, role: "student" });
      expect("unsupported" in byRole, text).toBe(true);
      if ("unsupported" in byRole) {
        expect(byRole.message).toMatch(/academic doubts|concepts/i);
        expect(byRole.message).not.toMatch(/\bClass\b/);
        expect(byRole.message).not.toMatch(/Ask about attendance/i);
      }
      const byChannel = resolveCoachCapability({ text, channel: "student_app" });
      expect("unsupported" in byChannel, text).toBe(true);
    }
    expect(
      resolveCoachCapability({
        feature_id: "student.attendance.query",
        role: "student",
      }),
    ).toMatchObject({ unsupported: true });
  });

  it("skips teacher/principal capabilities for student role", () => {
    expect(
      mapIntentToCapability("Generate a marking scheme", { role: "student" }),
    ).toBeNull();
    expect(
      mapIntentToCapability("principal health brief for the school", { role: "student" }),
    ).toBeNull();
    expect(
      resolveCoachCapability({
        text: "Generate a marking scheme for my paper",
        role: "student",
      }),
    ).toEqual({ feature_id: "student.nova.chat" });
    expect(
      mapIntentToCapability("Generate a marking scheme", { role: "teacher" })?.feature_id,
    ).toBe("teacher.question_paper.marking_scheme");
    expect(
      mapIntentToCapability("principal health brief for the school", {
        role: "principal",
      })?.feature_id,
    ).toBe("principal.school.health_brief");
  });

  it("registers student.nova.chat with model policy", () => {
    const cap = getCapability("student.nova.chat");
    expect(cap?.route_class).toBe("personalised_intelligence");
    expect(cap?.model_policy).toBe("required_when_budget");
    expect(isModelAllowed(cap!)).toBe(true);
  });

  it("session memory includes student.nova.chat", () => {
    expect(sessionScopeForCapability("student.nova.chat")).toBe("tutoring");
  });
});

describe("billing / credits soft degradation helpers", () => {
  it("detects OpenRouter billing and kill-switch codes", () => {
    expect(
      isAiBillingOrCreditsIssue({
        error_code: "openrouter_billing",
        message: "AI temporarily unavailable (billing/credits). Deterministic help still works.",
        data: null,
      }),
    ).toBe(true);
    expect(
      isAiBillingOrCreditsIssue({
        error_code: "gateway_invoke_failed",
        message: "network",
        data: null,
      }),
    ).toBe(false);
    expect(AI_BILLING_UNAVAILABLE_MSG).toMatch(/billing\/credits/i);
  });
});

describe("no demo / fake numbers in mapper", () => {
  it("does not embed demo XP or fake names", () => {
    // RULE 29 — Function.prototype.toString() INCLUDES comments, so a comment
    // saying "never return a demo name like Arjun" would fail this guard.
    const src = stripComments(
      mapIntentToCapability.toString() + resolveCoachCapability.toString(),
    );
    expect(src).not.toMatch(/Arjun|Priya Nair|1382|Level 14/i);
  });
});
