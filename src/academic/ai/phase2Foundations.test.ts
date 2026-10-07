/**
 * Phase 1 remainder + Phase 2 foundations unit tests — against the edge
 * modules ai-gateway runs.
 */

import { describe, expect, it } from "vitest";
import {
  getBuiltinPrompt,
  loadProductionPrompt,
  renderPromptTemplate,
} from "../../../supabase/functions/_shared/promptLibrary.ts";
import { buildRecommendationPackage } from "../../../supabase/functions/_shared/recommendationEngine.ts";
import {
  buildFeedbackRow,
  redactFeedbackComment,
} from "./feedbackLoop";
import { getCapability } from "../../../supabase/functions/_shared/capabilityCatalog.ts";
import { mapIntentToCapability } from "./intentMapper";
import { computeAttendanceRisk, computeHomeworkConsistency } from "../../../supabase/functions/_shared/eieProjection.ts";

/** The concept the package tells the student to practise first. */
function nextConcept(pkg: ReturnType<typeof buildRecommendationPackage>): string | null {
  return pkg.actions.find((a) => a.kind === "next_concept")?.concept_or_topic ?? null;
}

describe("Prompt Library v1", () => {
  it("loads builtin production prompts for explain capabilities", async () => {
    expect(getBuiltinPrompt("student.performance.explain")?.version).toBe("v1");
    expect(getBuiltinPrompt("student.concept.explain")?.status).toBe("production");
    // With no prompt row in the database, the builtin is what runs.
    const offline = { rpc: async () => ({ data: null, error: { message: "no such function" } }) };
    expect((await loadProductionPrompt(offline, "student.concept.explain"))?.capability_id).toBe(
      "student.concept.explain",
    );
  });

  it("prefers a production row from the database, and only a production one", async () => {
    const row = (status: string) => ({
      rpc: async () => ({
        data: { ...getBuiltinPrompt("student.concept.explain"), version: "v9-db", status },
        error: null,
      }),
    });
    expect((await loadProductionPrompt(row("production"), "student.concept.explain"))?.version).toBe(
      "v9-db",
    );
    expect((await loadProductionPrompt(row("shadow"), "student.concept.explain"))?.version).toBe(
      getBuiltinPrompt("student.concept.explain")?.version,
    );
  });

  it("renders template vars without inventing content", () => {
    expect(renderPromptTemplate("Hi {{name}} — {{missing}}", { name: "Ada" })).toBe(
      "Hi Ada — ",
    );
  });
});

describe("Recommendation Engine v1", () => {
  it("builds next concept from weakest EIE seed", () => {
    const pkg = buildRecommendationPackage({
      studentId: "s1",
      schoolId: "sch1",
      intelligence_version: "eie:2:1:0",
      completeness: 0.85,
      weak_concepts: [
        { subject: "Math", concept: "Fractions", mastery_score: 42, band: "weak" },
        { subject: "Math", concept: "Decimals", mastery_score: 55, band: "weak" },
      ],
      revision_priority: [
        { subject: "Math", topic: "Fractions", priority: 9, reason: "weak_topic" },
      ],
      attendance_pct: 80,
      homework_completion_pct: 60,
    });
    expect(pkg.actions.length).toBeGreaterThan(0);
    expect(nextConcept(pkg)).toBe("Fractions");
    expect(pkg.actions.some((a) => a.kind === "attendance_checkin")).toBe(true);
    expect(pkg.actions.some((a) => a.kind === "homework_catchup")).toBe(true);
  });

  it("omits attendance/homework actions when office pcts are null (student learning-only)", () => {
    const pkg = buildRecommendationPackage({
      studentId: "s1-student",
      schoolId: "sch1",
      intelligence_version: "eie:2:1:0",
      completeness: 0.85,
      weak_concepts: [
        { subject: "Math", concept: "Fractions", mastery_score: 42, band: "weak" },
      ],
      revision_priority: [
        { subject: "Math", topic: "Fractions", priority: 9, reason: "weak_topic" },
      ],
      attendance_pct: null,
      homework_completion_pct: null,
    });
    expect(nextConcept(pkg)).toBe("Fractions");
    expect(pkg.actions.some((a) => a.kind === "revision_priority")).toBe(true);
    expect(pkg.actions.some((a) => a.kind === "attendance_checkin")).toBe(false);
    expect(pkg.actions.some((a) => a.kind === "homework_catchup")).toBe(false);
    expect(pkg.actions.every((a) => a.kind === "next_concept" || a.kind === "revision_priority")).toBe(
      true,
    );
  });

  it("still emits office checkin/catchup when pcts provided (parent/staff surfaces)", () => {
    const pkg = buildRecommendationPackage({
      studentId: "s1-staff",
      schoolId: "sch1",
      intelligence_version: "eie:1:0:0",
      completeness: 0.7,
      weak_concepts: [],
      revision_priority: [],
      attendance_pct: 70,
      homework_completion_pct: 50,
    });
    expect(pkg.actions.some((a) => a.kind === "attendance_checkin")).toBe(true);
    expect(pkg.actions.some((a) => a.kind === "homework_catchup")).toBe(true);
  });

  it("returns empty actions when no seeds (honest empty)", () => {
    const pkg = buildRecommendationPackage({
      studentId: "s2",
      schoolId: "sch1",
      intelligence_version: "eie:0:0:0",
      completeness: 0,
      weak_concepts: [],
      revision_priority: [],
    });
    expect(pkg.actions).toEqual([]);
    expect(nextConcept(pkg)).toBeNull();
  });

  it("skips Subject/Topic/Daily/General placeholder seeds", () => {
    const pkg = buildRecommendationPackage({
      studentId: "s3",
      schoolId: "sch1",
      intelligence_version: "eie:1:0:0",
      completeness: 0.5,
      weak_concepts: [
        { subject: "General", concept: "Daily", mastery_score: 10, band: "weak" },
        { subject: "Subject", concept: "Topic", mastery_score: 5, band: "weak" },
        { subject: "Mathematics", concept: "Limits", mastery_score: 40, band: "weak" },
      ],
      revision_priority: [
        { subject: "General", topic: "Daily", priority: 99 },
        { subject: "Mathematics", topic: "Derivatives", priority: 8 },
      ],
    });
    expect(nextConcept(pkg)).toBe("Limits");
    const rev = pkg.actions.find((a) => a.kind === "revision_priority");
    expect(rev?.concept_or_topic).toBe("Derivatives");
    expect(
      pkg.actions.some((a) =>
        ["Daily", "General", "Subject", "Topic"].includes(String(a.concept_or_topic)),
      ),
    ).toBe(false);
  });
});

describe("Feedback Loop", () => {
  it("redacts PII from comments", () => {
    expect(redactFeedbackComment("email me at a@b.com or +91 98765 43210")).toContain(
      "[redacted-email]",
    );
    expect(redactFeedbackComment("call +91 98765 43210")).toContain("[redacted-phone]");
  });

  it("builds insertable rows", () => {
    const row = buildFeedbackRow({
      actor_user_id: "u1",
      signal_type: "like",
      feature_id: "student.concept.explain",
      request_id: "req-1",
      comment: "helpful",
      rating: 5,
    });
    expect(row.signal_type).toBe("like");
    expect(row.comment_redacted).toBe("helpful");
    expect(row.rating).toBe(5);
  });
});

describe("EIE risk products", () => {
  it("computes attendance risk and homework consistency from AE facts", () => {
    const risk = computeAttendanceRisk(70);
    expect(risk.band).not.toBe("unknown");
    expect(risk.risk_score).toBeGreaterThan(0);
    const hw = computeHomeworkConsistency(40);
    expect(hw.consistency_score).toBe(40);
    expect(hw.band).toBe("high");
  });
});

describe("New capabilities + intents", () => {
  it("registers concept explain and recommendation capabilities", () => {
    expect(getCapability("student.concept.explain")?.model_policy).toBe("optional_explain");
    expect(getCapability("student.recommendation.next")?.route_class).toBe("recommendation");
    expect(getCapability("student.recommendation.next")?.model_policy).toBe("never");
  });

  it("maps coach intents to new capabilities", () => {
    expect(mapIntentToCapability("help me understand fractions")?.feature_id).toBe(
      "student.concept.explain",
    );
    expect(mapIntentToCapability("what should I practise next")?.feature_id).toBe(
      "student.recommendation.next",
    );
    expect(mapIntentToCapability("weekly progress narrative")?.feature_id).toBe(
      "parent.child.narrative",
    );
  });
});
