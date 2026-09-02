/**
 * Phase 1 unit tests — Context Builder, Validator, Confidence, Budget, Analytics, Narrative.
 */

import { describe, expect, it } from "vitest";
import {
  buildContextPack,
  packContainsForbidden,
  packForModel,
  redactProjection,
} from "./contextBuilder";
import {
  evidenceFromExplainFacts,
  validateModelResponse,
} from "./responseValidator";
import {
  applyConfidencePolicy,
  scoreConfidence,
} from "./confidenceEngine";
import {
  assignReasoningTier,
  getTierLimits,
  modelCallOptionsForTier,
} from "./reasoningBudget";
import {
  checkBudgetReservation,
  estimateUnitsForTier,
  periodKey,
} from "./budgetQuotas";
import { aggregateAiDecisions } from "./analytics";
import { buildParentScheduledNarrative } from "./parentNarrative";
import { getCapability } from "./capabilityCatalog";

const AE = {
  attendance: {
    projection: "StudentAttendanceQuery",
    attendance_pct: 92.5,
    present: 37,
    absent: 3,
    data_version: "att:s1:40",
    source_as_of: "2026-08-01",
    completeness: 1,
    internal_notes: "SECRET",
    studentId: "stu-uuid-should-drop",
  },
  homework: {
    projection: "StudentHomeworkDue",
    pending_count: 2,
    data_version: "hw:s1:2",
    completeness: 1,
  },
  marks: {
    projection: "StudentMarksSummary",
    average_pct: 78,
    data_version: "marks:s1:5",
    completeness: 1,
  },
};

const EIE = {
  algorithm_id: "eie.mastery.v1",
  avg_mastery: 64,
  data_version: "eie:10:3:1",
  source_data_version: "eie:10:3:1",
  completeness: 0.85,
  weak_concepts: [{ concept: "Fractions", mastery_score: 42, band: "weak" }],
  attempt_history: [{ id: "raw", score: 1 }],
};

describe("Adaptive Reasoning Budget", () => {
  it("defaults performance explain to simple when facts complete", () => {
    expect(
      assignReasoningTier({
        feature_id: "student.performance.explain",
        facts_complete: true,
      }),
    ).toBe("simple");
  });

  it("downgrades under budget pressure", () => {
    expect(
      assignReasoningTier({
        feature_id: "student.mistake.analysis",
        capability_default: "complex",
        budget_pressure: true,
      }),
    ).toBe("medium");
  });

  it("exposes model call ceilings", () => {
    const opts = modelCallOptionsForTier("simple");
    expect(opts.max_tokens).toBe(getTierLimits("simple").max_output_tokens);
    expect(opts.temperature).toBeLessThanOrEqual(0.2);
  });
});

describe("Context Builder v1", () => {
  it("assembles AE+EIE with provenance and redacts secrets/ids", () => {
    const pack = buildContextPack({
      capability: "student.performance.explain",
      request_text: "How am I doing?",
      ae: AE,
      eie: EIE,
      tier_signals: { facts_complete: true },
    });

    expect(pack.tier).toBe("simple");
    expect(pack.provenance.algorithm_ids).toContain("eie.mastery.v1");
    expect(pack.provenance.data_versions.length).toBeGreaterThan(0);
    expect(pack.provenance.source_as_of).toBe("2026-08-01");
    expect(packContainsForbidden(pack)).toBe(false);
    expect(JSON.stringify(pack.ae_facts)).not.toMatch(/internal_notes|SECRET/i);
    expect(JSON.stringify(pack.eie_facts)).not.toMatch(/attempt_history/);
    expect(packForModel(pack)).toContain("92.5");
  });

  it("redactProjection drops forbidden keys", () => {
    const r = redactProjection({ password: "x", attendance_pct: 80 }) as Record<
      string,
      unknown
    >;
    expect(r.password).toBeUndefined();
    expect(r.attendance_pct).toBe(80);
  });
});

describe("Response Validator v1", () => {
  const evidence = evidenceFromExplainFacts({
    attendance: { attendance_pct: 92.5 },
    marks: { average_pct: 78 },
    eie: { avg_mastery: 64 },
    homework: { pending_count: 2 },
  });

  it("accepts grounded explanation", () => {
    const text =
      "Attendance is 92.5%. Your marks average is 78%. Tracked mastery averages 64%.";
    const v = validateModelResponse(text, evidence);
    expect(v.material_failure).toBe(false);
    expect(v.ok).toBe(true);
  });

  // The §10.8 vocabulary in the string below is DELIBERATE and stays.
  //
  // It is the INPUT the validator has to refuse, not an output the app
  // produces — a rejection fixture is the opposite of a test holding a
  // violation in place. Grepping the suite for strength vocabulary (which found
  // two real cases) also surfaces this one, and deleting it would remove the
  // proof that the guard works. The grep is a lead, not a verdict.
  it("rejects invented mastery percentage", () => {
    const v = validateModelResponse(
      "Your concept mastery is 97% — excellent work!",
      evidence,
    );
    expect(v.material_failure).toBe(true);
    expect(v.codes).toContain("invented_mastery_pct");
  });

  it("rejects invented attendance percentage", () => {
    const v = validateModelResponse("Your attendance is 55% this term.", evidence);
    expect(v.codes).toContain("invented_attendance_pct");
  });

  it("rejects empty model output", () => {
    expect(validateModelResponse("  ", evidence).codes).toContain("empty_response");
  });
});

describe("Confidence Engine v1", () => {
  it("scores deterministic high when fresh and complete", () => {
    const r = scoreConfidence({
      used_model: false,
      completeness: 1,
      source_as_of: new Date().toISOString(),
      route_class: "deterministic_record",
      freshness_hours: 1,
    });
    expect(r.confidence).toBeGreaterThan(0.85);
    expect(r.action).toBe("none");
  });

  it("forces facts_only on validation failure", () => {
    const validation = validateModelResponse("Mastery is 99%.", {
      avg_mastery: 64,
      allowed_pcts: [64],
    });
    const r = scoreConfidence({
      used_model: true,
      completeness: 0.9,
      validation,
      budget_tier: "simple",
    });
    expect(r.action).toBe("facts_only");

    const applied = applyConfidencePolicy(
      { explanation: "Mastery is 99%.", facts: {} },
      r,
    );
    expect(applied.explanation).toBeNull();
    expect(applied.confidence_action).toBe("facts_only");
  });

  it("discloses uncertainty at medium confidence", () => {
    const r = scoreConfidence({
      used_model: true,
      completeness: 0.4,
      freshness_hours: 200,
      validation: {
        ok: true,
        codes: ["ok"],
        material_failure: false,
        grounded_numbers_checked: 0,
      },
      source_as_of: "2026-07-01",
    });
    expect(["uncertainty_disclosure", "safer_narrower_answer", "facts_only"]).toContain(
      r.action,
    );
  });
});

describe("Budget quotas", () => {
  it("allows under soft limit", () => {
    const r = checkBudgetReservation({
      quotas: [],
      usage: [],
      school_id: "sch-1",
      feature_id: "student.performance.explain",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.soft_breach).toBe(false);
  });

  it("hard-blocks when exhausted", () => {
    const day = periodKey("daily");
    const r = checkBudgetReservation({
      quotas: [
        {
          school_id: "sch-1",
          scope: "school",
          feature_id: null,
          period: "daily",
          soft_limit_units: 10,
          hard_limit_units: 12,
        },
      ],
      usage: [
        {
          school_id: "sch-1",
          feature_id: null,
          period: "daily",
          period_key: day,
          units_used: 12,
        },
      ],
      school_id: "sch-1",
      feature_id: "student.performance.explain",
      units: 1,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect((r as Extract<typeof r, { ok: false }>).error_code).toBe("budget_exhausted");
  });

  it("estimates tier units", () => {
    expect(estimateUnitsForTier("simple")).toBe(1);
    expect(estimateUnitsForTier("complex")).toBeGreaterThan(estimateUnitsForTier("medium"));
  });
});

describe("AI Analytics Dashboard v1", () => {
  it("aggregates route mix, cost, deflection without demo padding", () => {
    const summary = aggregateAiDecisions([
      {
        feature_id: "student.attendance.query",
        route_class: "deterministic_record",
        decision: "answered_deterministic",
        used_model: false,
        cache_hit: true,
        confidence: 0.95,
        latency_ms: 40,
      },
      {
        feature_id: "student.performance.explain",
        route_class: "personalised_intelligence",
        decision: "answered_model",
        used_model: true,
        cache_hit: false,
        confidence: 0.7,
        latency_ms: 900,
        evidence: { cost_units: 1 },
      },
      {
        feature_id: "student.eie.mastery_summary",
        route_class: "eie_insight",
        decision: "answered_eie",
        used_model: false,
        cache_hit: false,
        confidence: 0.9,
        latency_ms: 60,
      },
    ]);

    expect(summary.window.count).toBe(3);
    expect(summary.model_calls).toBe(1);
    expect(summary.cache_hits).toBe(1);
    expect(summary.deflection_pct).toBeCloseTo(66.7, 0);
    expect(summary.estimated_cost_units).toBe(1);
    expect(summary.route_mix.deterministic_record).toBe(1);
    // Honest empty — never invent demo volume
    expect(summary.window.count).not.toBe(1382);
  });

  it("empty rows → zeros", () => {
    const summary = aggregateAiDecisions([]);
    expect(summary.window.count).toBe(0);
    expect(summary.deflection_pct).toBe(0);
    expect(summary.avg_confidence).toBeNull();
  });
});

describe("Parent scheduled narrative pilot", () => {
  it("builds deterministic narrative from facts only", () => {
    const n = buildParentScheduledNarrative({
      attendance_pct: 90,
      homework_completion_pct: 80,
      tests_avg_pct: 70,
      exams_avg_pct: 0,
      weak_topics: ["Algebra"],
      avg_mastery: 66,
      source_as_of: "2026-08-01",
      data_version: "parent:s1:1",
    });
    expect(n.used_model).toBe(false);
    expect(n.narrative).toContain("90%");
    expect(n.narrative).toContain("Algebra");
    expect(n.bullets.length).toBeGreaterThan(2);
    expect(n.projection).toBe("ParentScheduledNarrative");
  });

  it("registers parent.child.narrative capability", () => {
    expect(getCapability("parent.child.narrative")?.model_policy).toBe("never");
  });
});
