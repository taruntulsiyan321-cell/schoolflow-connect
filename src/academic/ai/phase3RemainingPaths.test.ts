/**
 * Phase 3 remaining production paths — image solve, marking scheme,
 * EIE school rollups, prompt shadow traffic, voice STT stub.
 */

import { describe, expect, it } from "vitest";
import {
  runImageDoubtSolve,
  gateImageDoubtSolveConfidence,
  IMAGE_DOUBT_CONFIDENCE_THRESHOLD,
  renderImageDoubtSolvePrompt,
} from "./imageDoubtSolve";
import {
  buildQuestionPaperMarkingScheme,
  renderMarkingSchemePrompt,
} from "./questionPaperMarkingScheme";
import { runVoiceDoubtSubmit, validateVoiceMetadata } from "./voiceDoubtSubmit";
import { buildSchoolHealthBrief } from "./schoolHealthBrief";
import {
  shouldUseShadowPrompt,
  parseShadowPromptFlag,
  selectPromptWithShadow,
} from "./promptEvaluation";
import { getBuiltinPrompt, resolveShadowPrompt } from "./promptLibrary";
import { getCapability } from "./capabilityCatalog";
import { planRoute } from "./routerPolicy";
import { mapIntentToCapability } from "./intentMapper";
import {
  createWorkflowRun,
  getWorkflowDefinition,
  listWorkflowDefinitions,
} from "./workflowOrchestrator";
import { SESSION_MEMORY_CAPABILITIES } from "./sessionMemory";
import { buildSchoolRiskRollups } from "../eie/schoolRollups";

const FLAGS_ON = {
  gatewayEnabled: true,
  deterministicEnabled: true,
  generativeEnabled: true,
};
const FLAGS_GEN_OFF = {
  gatewayEnabled: true,
  deterministicEnabled: true,
  generativeEnabled: false,
};

describe("student.image_doubt.solve gated tutoring", () => {
  it("refuses missing reconstructed question / low confidence", () => {
    expect(
      gateImageDoubtSolveConfidence({
        reconstructed_question: "",
        extraction_confidence: 0.9,
      }).ok,
    ).toBe(false);
    expect(
      gateImageDoubtSolveConfidence({
        reconstructed_question: "Solve 2x+3=7",
        extraction_confidence: 0.2,
      }).ok,
    ).toBe(false);
    expect(IMAGE_DOUBT_CONFIDENCE_THRESHOLD).toBe(0.55);

    const clarify = runImageDoubtSolve({
      reconstructed_question: "Solve 2x+3=7",
      extraction_confidence: 0.4,
    });
    expect(clarify.status).toBe("clarify");
    expect(clarify.invented_problem_text).toBe(false);
    expect(clarify.explanation).toBeNull();
  });

  it("returns cache hit before model", () => {
    const r = runImageDoubtSolve({
      reconstructed_question: "What is photosynthesis?",
      extraction_confidence: 0.9,
      cached_explanation: "Plants convert light into chemical energy.",
    });
    expect(r.status).toBe("cache_hit");
    expect(r.cache_hit).toBe(true);
    expect(r.used_model).toBe(false);
    expect(r.explanation).toMatch(/photosynthesis|Plants/i);
  });

  it("validates model answer and falls back on invented mastery", () => {
    const bad = runImageDoubtSolve({
      reconstructed_question: "Explain fractions",
      extraction_confidence: 0.88,
      may_call_model: true,
      model_text: "Your mastery score is 97% so you are done.",
      retrieval_snippets: ["A fraction is a part of a whole."],
    });
    expect(bad.used_model).toBe(false);
    expect(bad.status === "retrieval" || bad.status === "facts_only").toBe(true);

    const good = runImageDoubtSolve({
      reconstructed_question: "Explain fractions",
      extraction_confidence: 0.88,
      may_call_model: true,
      model_text: "A fraction names a part of a whole. Start with halves and quarters.",
    });
    expect(good.status).toBe("model");
    expect(good.used_model).toBe(true);
    expect(good.validation_ok).toBe(true);
  });

  it("registers capability + enabled workflow; full image_doubt.v1 stays disabled", () => {
    const cap = getCapability("student.image_doubt.solve");
    expect(cap?.model_policy).toBe("optional_explain");
    expect(cap?.allowed_roles).toEqual(["student", "teacher", "admin"]);
    expect(cap?.allowed_roles.includes("super_admin" as never)).toBe(false);
    expect(getBuiltinPrompt("student.image_doubt.solve")?.status).toBe("production");
    expect(renderImageDoubtSolvePrompt({ question: "x+1=2" }).system.length).toBeGreaterThan(20);

    const def = getWorkflowDefinition("student.image_doubt.solve.v1");
    expect(def?.enabled).toBe(true);
    expect(def?.steps.map((s) => s.step_id)).toContain("cache_lookup");
    expect(createWorkflowRun({ workflow_id: "student.image_doubt.solve.v1", run_id: "s1" }).status)
      .toBe("pending");
    expect(getWorkflowDefinition("student.image_doubt.v1")?.enabled).toBe(false);
    expect(SESSION_MEMORY_CAPABILITIES["student.image_doubt.solve"]).toBe("tutoring");

    const on = planRoute("student.image_doubt.solve", FLAGS_ON);
    if (!("rejected" in on)) expect(on.may_call_model).toBe(true);
    const off = planRoute("student.image_doubt.solve", FLAGS_GEN_OFF);
    if (!("rejected" in off)) expect(off.may_call_model).toBe(false);
  });
});

describe("teacher.question_paper.marking_scheme", () => {
  it("requires outline in session before generating", () => {
    const missing = buildQuestionPaperMarkingScheme({
      outline_in_session: false,
      may_call_model: true,
      model_text: "Q1: 2 marks for method, 1 for answer.",
    });
    expect(missing.mode).toBe("outline_required");
    expect(missing.marking_scheme_text).toBeNull();
    expect(missing.generates_marking_scheme).toBe(true);
    expect(missing.generates_full_paper).toBe(false);
  });

  it("respects kill-switch and validates model scheme", () => {
    const killed = buildQuestionPaperMarkingScheme({
      outline_in_session: true,
      outline_text: "Section A — Algebra (40 marks)",
      plan_hash: "ph1",
      may_call_model: false,
    });
    expect(killed.mode).toBe("plan_only");
    expect(killed.degraded_reason).toContain("generative");

    const ok = buildQuestionPaperMarkingScheme({
      outline_in_session: true,
      outline_text: "Section A — Algebra (40 marks)",
      plan_hash: "ph1",
      total_marks: 40,
      may_call_model: true,
      model_text: "Award 40 marks across Algebra items: 2 for method, 1 for accuracy each.",
    });
    expect(ok.mode).toBe("scheme_with_model");
    expect(ok.marking_scheme_text).toMatch(/40/);
    expect(getBuiltinPrompt("teacher.question_paper.marking_scheme")?.status).toBe("production");
    expect(renderMarkingSchemePrompt({ outline_text: "Outline" }).user.length).toBeGreaterThan(10);
    expect(getWorkflowDefinition("teacher.question_paper.marking_scheme.v1")?.enabled).toBe(true);
    expect(mapIntentToCapability("Generate a marking scheme")?.feature_id).toBe(
      "teacher.question_paper.marking_scheme",
    );
  });
});

describe("EIE school rollups + health brief enrichment", () => {
  it("aggregates attendance risk and homework consistency without inventing", () => {
    const rollup = buildSchoolRiskRollups([
      { student_id: "a", class_id: "c1", attendance_pct: 92, homework_completion_pct: 88 },
      { student_id: "b", class_id: "c1", attendance_pct: 70, homework_completion_pct: 45 },
      { student_id: "c", class_id: "c2", attendance_pct: 98, homework_completion_pct: 95 },
    ]);
    expect(rollup.student_count).toBe(3);
    expect(rollup.class_count).toBe(2);
    expect(rollup.attendance_band_counts.elevated + rollup.attendance_band_counts.high).toBeGreaterThan(0);
    expect(rollup.homework_consistency_band).not.toBe("unknown");
    expect(rollup.at_risk_class_ids.length).toBeGreaterThan(0);
    expect(JSON.stringify(rollup)).not.toMatch(/Arjun|Priya|1382/);

    const empty = buildSchoolRiskRollups([]);
    expect(empty.student_count).toBe(0);
    expect(empty.attendance_risk_band).toBe("unknown");
  });

  it("enriches principal brief with rollup bands", () => {
    const brief = buildSchoolHealthBrief({
      school_id: "s1",
      class_count: 4,
      student_count: 100,
      avg_attendance_pct: 88,
      avg_homework_completion_pct: 76,
      attendance_risk_band: "moderate",
      homework_consistency_band: "moderate",
      attendance_band_counts: { low: 60, moderate: 25, elevated: 10, high: 5, unknown: 0 },
      at_risk_class_count: 2,
    });
    expect(brief.status).toBe("ready");
    expect(brief.used_model).toBe(false);
    expect(brief.bullets.some((b) => /Homework consistency/i.test(b))).toBe(true);
    expect(brief.bullets.some((b) => /elevated\/high attendance risk/i.test(b))).toBe(true);
    expect(brief.metrics.homework_consistency_band).toBe("moderate");
  });
});

describe("Prompt Evaluation shadow traffic flag", () => {
  it("samples stably by request id and never auto-promotes", () => {
    expect(shouldUseShadowPrompt("req-stable-1", 0)).toBe(false);
    expect(shouldUseShadowPrompt("req-stable-1", 100)).toBe(true);
    const a = shouldUseShadowPrompt("abc-123", 50);
    const b = shouldUseShadowPrompt("abc-123", 50);
    expect(a).toBe(b);

    const flag = parseShadowPromptFlag(true, { percent: 15 });
    expect(flag.enabled).toBe(true);
    expect(flag.percent).toBe(15);
    expect(parseShadowPromptFlag(false, { percent: 90 }).percent).toBe(0);

    const production = getBuiltinPrompt("student.concept.explain");
    const shadow = production
      ? { ...production, version: "v2-shadow", status: "shadow" as const }
      : null;
    const selected = selectPromptWithShadow({
      production,
      shadow,
      request_id: "force-shadow-aaaaaaaa",
      shadow_percent: 100,
    });
    expect(selected.selected_status).toBe("shadow");
    expect(selected.shadow_sampled).toBe(true);
    expect(resolveShadowPrompt("student.concept.explain", shadow)?.status).toBe("shadow");
  });
});

describe("student.voice_doubt.submit STT stub", () => {
  it("clarifies when STT unset and never invents transcript", () => {
    expect(
      validateVoiceMetadata({ mime: "audio/wav", bytes: 2000, duration_ms: 1500 }).ok,
    ).toBe(true);
    expect(
      validateVoiceMetadata({ mime: "image/jpeg", bytes: 2000 }).ok,
    ).toBe(false);

    const r = runVoiceDoubtSubmit(
      { mime: "audio/webm", bytes: 4000, duration_ms: 2000 },
      { providerConfigured: false },
    );
    expect(r.status).toBe("clarify");
    expect(r.stop_reason).toBe("stt_not_configured");
    expect(r.invented_transcript).toBe(false);
    expect(r.transcript_text).toBeNull();
    expect(r.checkpoints.map((c) => c.step_id)).toEqual([
      "validate_media",
      "safety_screen",
      "stt_extract",
      "confidence_gate",
    ]);

    const deferred = runVoiceDoubtSubmit(
      { mime: "audio/mpeg", bytes: 3000, duration_ms: 1200 },
      { providerConfigured: true },
    );
    expect(deferred.status).toBe("clarify");
    expect(deferred.invented_transcript).toBe(false);
    expect(deferred.transcript_text).toBeNull();
  });

  it("registers capability + workflow without super_admin", () => {
    const cap = getCapability("student.voice_doubt.submit");
    expect(cap?.model_policy).toBe("never");
    expect(cap?.allowed_roles.includes("super_admin" as never)).toBe(false);
    expect(getWorkflowDefinition("student.voice_doubt.submit.v1")?.enabled).toBe(true);
    expect(mapIntentToCapability("Record a voice doubt")?.feature_id).toBe(
      "student.voice_doubt.submit",
    );
    const plan = planRoute("student.voice_doubt.submit", FLAGS_ON);
    if (!("rejected" in plan)) expect(plan.may_call_model).toBe(false);
  });
});

describe("No super_admin + multi-agent still reserved", () => {
  it("new capabilities exclude super_admin; full paper/image tutoring stay disabled", () => {
    for (const id of [
      "student.image_doubt.solve",
      "student.voice_doubt.submit",
      "teacher.question_paper.marking_scheme",
    ]) {
      expect(getCapability(id)?.allowed_roles.includes("super_admin" as never)).toBe(false);
    }
    expect(getWorkflowDefinition("student.image_doubt.v1")?.enabled).toBe(false);
    expect(getWorkflowDefinition("teacher.question_paper.v1")?.enabled).toBe(false);
    expect(listWorkflowDefinitions().length).toBeGreaterThanOrEqual(9);
  });
});
