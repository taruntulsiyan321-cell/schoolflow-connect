/**
 * Phase 1 unit tests — Context Builder, Validator, Confidence, Budget, Analytics, Narrative.
 *
 * Every import is the edge module ai-gateway runs. Budget ENFORCEMENT is the
 * SQL function `ai_budget_check_and_reserve`, not code here, so only the
 * per-tier cost units are tested below.
 */

import { describe, expect, it } from "vitest";
import {
  buildContextPack,
  packForModel,
} from "../../../supabase/functions/_shared/contextBuilder.ts";
import {
  evidenceFromExplainFacts,
  validateModelResponse,
} from "../../../supabase/functions/_shared/responseValidator.ts";
import {
  applyConfidencePolicy,
  scoreConfidence,
} from "../../../supabase/functions/_shared/confidenceEngine.ts";
import {
  assignReasoningTier,
  getTierLimits,
  modelCallOptionsForTier,
} from "../../../supabase/functions/_shared/reasoningBudget.ts";
import { estimateUnitsForTier } from "../../../supabase/functions/_shared/budgetQuotas.ts";

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
    password: "hunter2",
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
    // The fixture carries a password, a staff note and a student id; none may
    // reach the pack, and the figure beside them must.
    const whole = JSON.stringify(pack);
    expect(whole).not.toMatch(/hunter2|"password"/);
    expect(whole).not.toMatch(/internal_notes|SECRET/i);
    expect(whole).not.toContain("stu-uuid-should-drop");
    expect(JSON.stringify(pack.eie_facts)).not.toMatch(/attempt_history/);
    expect(packForModel(pack)).toContain("92.5");
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
  it("estimates tier units", () => {
    expect(estimateUnitsForTier("simple")).toBe(1);
    expect(estimateUnitsForTier("complex")).toBeGreaterThan(estimateUnitsForTier("medium"));
  });
});
