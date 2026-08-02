/**
 * Phase 1 remainder + Phase 2 foundations unit tests.
 */

import { describe, expect, it } from "vitest";
import {
  getBuiltinPrompt,
  renderPromptTemplate,
  resolveProductionPrompt,
} from "./promptLibrary";
import {
  dailyUsageFromDecisions,
  forecastBudget,
} from "./budgetForecast";
import {
  buildRecommendationPackage,
  pickNextConcept,
} from "./recommendationEngine";
import {
  createWorkflowRun,
  getWorkflowDefinition,
  listWorkflowDefinitions,
} from "./workflowOrchestrator";
import {
  buildFeedbackRow,
  redactFeedbackComment,
} from "./feedbackLoop";
import { getCapability } from "./capabilityCatalog";
import { mapIntentToCapability } from "./intentMapper";
import { computeAttendanceRisk, computeHomeworkConsistency } from "../eie/riskProducts";
import { buildStudentEducationalIntelligence } from "../eie/studentIntelligence";

describe("Prompt Library v1", () => {
  it("loads builtin production prompts for explain capabilities", () => {
    expect(getBuiltinPrompt("student.performance.explain")?.version).toBe("v1");
    expect(getBuiltinPrompt("student.concept.explain")?.status).toBe("production");
    expect(resolveProductionPrompt("student.concept.explain")?.capability_id).toBe(
      "student.concept.explain",
    );
  });

  it("renders template vars without inventing content", () => {
    expect(renderPromptTemplate("Hi {{name}} — {{missing}}", { name: "Ada" })).toBe(
      "Hi Ada — ",
    );
  });
});

describe("Budget forecast", () => {
  it("returns insufficient_data for empty ledger (no demo burn)", () => {
    const f = forecastBudget({
      daily_usage: [],
      soft_limit_daily: 200,
      hard_limit_daily: 400,
      days_remaining_in_month: 10,
      month_units_used: 0,
    });
    expect(f.status).toBe("insufficient_data");
    expect(f.avg_daily_units).toBe(0);
    expect(f.projected_month_end_units).toBe(0);
  });

  it("projects from observed daily usage", () => {
    const f = forecastBudget({
      daily_usage: [
        { day: "2026-08-01", units: 100 },
        { day: "2026-08-02", units: 100 },
      ],
      soft_limit_daily: 200,
      hard_limit_daily: 400,
      days_remaining_in_month: 10,
      month_units_used: 200,
      soft_limit_monthly: 1000,
    });
    expect(f.avg_daily_units).toBe(100);
    expect(f.projected_month_end_units).toBe(1200);
    expect(f.at_or_above_100_pct).toBe(true);
    expect(f.status).toBe("critical");
  });

  it("aggregates decision rows into daily points", () => {
    const points = dailyUsageFromDecisions([
      { created_at: "2026-08-01T10:00:00Z", used_model: true, estimated_cost_units: 2 },
      { created_at: "2026-08-01T12:00:00Z", used_model: false, estimated_cost_units: 0 },
      { created_at: "2026-08-02T09:00:00Z", used_model: true, evidence: { cost_units: 3 } },
    ]);
    expect(points).toEqual([
      { day: "2026-08-01", units: 2 },
      { day: "2026-08-02", units: 3 },
    ]);
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
    expect(pickNextConcept(pkg)?.concept_or_topic).toBe("Fractions");
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
    expect(pickNextConcept(pkg)).toBeNull();
  });
});

describe("Workflow Orchestrator skeleton", () => {
  it("registers teacher question paper workflow disabled", () => {
    const def = getWorkflowDefinition("teacher.question_paper.v1");
    expect(def?.enabled).toBe(false);
    expect(def?.steps.length).toBeGreaterThan(3);
    expect(listWorkflowDefinitions().length).toBeGreaterThanOrEqual(1);
  });

  it("createWorkflowRun stays registered when disabled", () => {
    const run = createWorkflowRun({
      workflow_id: "teacher.question_paper.v1",
      run_id: "run-1",
    });
    expect(run.status).toBe("registered");
    expect(run.error_code).toBe("workflow_disabled");
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

  it("attaches risk products on student intelligence projection", () => {
    const intel = buildStudentEducationalIntelligence({
      studentId: "s1",
      schoolId: "sch1",
      mastery: [{ subject: "Math", concept: "Algebra", mastery_score: 50 }],
      revisionQueue: [],
      attendance_pct: 88,
      homework_completion_pct: 92,
    });
    expect(intel.attendance_risk.attendance_pct).toBe(88);
    expect(intel.homework_consistency.homework_completion_pct).toBe(92);
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
