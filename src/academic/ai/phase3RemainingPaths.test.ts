/**
 * Phase 3 remaining production paths — image solve, marking scheme,
 * EIE school rollups, prompt shadow traffic, voice STT stub. Against the edge
 * modules ai-gateway runs; private gates are reached through their callers.
 */

import { describe, expect, it } from "vitest";
import {
  runImageDoubtSolve,
  renderImageDoubtSolvePrompt,
} from "../../../supabase/functions/_shared/imageDoubtSolve.ts";
import {
  buildQuestionPaperMarkingScheme,
  renderMarkingSchemePrompt,
} from "../../../supabase/functions/_shared/questionPaperMarkingScheme.ts";
import { runVoiceDoubtSubmit } from "../../../supabase/functions/_shared/voiceDoubtSubmit.ts";
import { buildSchoolHealthBrief } from "../../../supabase/functions/_shared/schoolHealthBrief.ts";
import {
  parseShadowPromptFlag,
  selectPromptWithShadow,
} from "../../../supabase/functions/_shared/promptEvaluation.ts";
import { getBuiltinPrompt, loadShadowPrompt } from "../../../supabase/functions/_shared/promptLibrary.ts";
import { getCapability } from "../../../supabase/functions/_shared/capabilityCatalog.ts";
import { mapIntentToCapability } from "./intentMapper";
import { sessionScopeForCapability } from "../../../supabase/functions/_shared/sessionMemory.ts";
import { buildSchoolRiskRollups } from "../../../supabase/functions/_shared/schoolRollups.ts";

describe("student.image_doubt.solve gated tutoring", () => {
  it("refuses missing reconstructed question / low confidence", () => {
    const solve = (reconstructed_question: string, extraction_confidence: number) =>
      runImageDoubtSolve({ reconstructed_question, extraction_confidence });
    expect(solve("", 0.9).stop_reason).toBe("reconstructed_question_required");
    expect(solve("Solve 2x+3=7", 0.2).stop_reason).toBe("low_extraction_confidence");
    // The bar is 0.55: just under it clarifies, just over it does not.
    expect(solve("Solve 2x+3=7", 0.54).status).toBe("clarify");
    expect(solve("Solve 2x+3=7", 0.56).status).not.toBe("clarify");

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

  it("registers capability, prompt and session scope", () => {
    const cap = getCapability("student.image_doubt.solve");
    expect(cap?.model_policy).toBe("optional_explain");
    expect(cap?.allowed_roles).toEqual(["student", "teacher", "admin"]);
    expect(cap?.allowed_roles.includes("super_admin" as never)).toBe(false);
    expect(getBuiltinPrompt("student.image_doubt.solve")?.status).toBe("production");
    expect(renderImageDoubtSolvePrompt({ question: "x+1=2" }).system.length).toBeGreaterThan(20);
    expect(sessionScopeForCapability("student.image_doubt.solve")).toBe("tutoring");
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
  it("samples stably by request id and never auto-promotes", async () => {
    const production = getBuiltinPrompt("student.concept.explain");
    const shadow = production
      ? { ...production, version: "v2-shadow", status: "shadow" as const }
      : null;
    const pick = (request_id: string, shadow_percent: number) =>
      selectPromptWithShadow({ production, shadow, request_id, shadow_percent }).shadow_sampled;
    expect(pick("req-stable-1", 0)).toBe(false);
    expect(pick("req-stable-1", 100)).toBe(true);
    expect(pick("abc-123", 50)).toBe(pick("abc-123", 50));

    const flag = parseShadowPromptFlag(true, { percent: 15 });
    expect(flag.enabled).toBe(true);
    expect(flag.percent).toBe(15);
    expect(parseShadowPromptFlag(false, { percent: 90 }).percent).toBe(0);

    const selected = selectPromptWithShadow({
      production,
      shadow,
      request_id: "force-shadow-aaaaaaaa",
      shadow_percent: 100,
    });
    expect(selected.selected_status).toBe("shadow");
    expect(selected.shadow_sampled).toBe(true);
    // Only a row whose status IS shadow loads as the shadow prompt.
    const answering = (row: unknown) => ({ rpc: async () => ({ data: row, error: null }) });
    expect((await loadShadowPrompt(answering(shadow), "student.concept.explain"))?.status).toBe(
      "shadow",
    );
    expect(await loadShadowPrompt(answering(production), "student.concept.explain")).toBeNull();
  });
});

describe("student.voice_doubt.submit STT stub", () => {
  it("clarifies when STT unset and never invents transcript", () => {
    expect(
      runVoiceDoubtSubmit({ mime: "audio/wav", bytes: 2000, duration_ms: 1500 }).checkpoints[0],
    ).toMatchObject({ step_id: "validate_media", ok: true });
    expect(runVoiceDoubtSubmit({ mime: "image/jpeg", bytes: 2000 }).status).toBe("rejected");

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

  it("registers capability without super_admin", () => {
    const cap = getCapability("student.voice_doubt.submit");
    expect(cap?.model_policy).toBe("never");
    expect(cap?.allowed_roles.includes("super_admin" as never)).toBe(false);
    expect(mapIntentToCapability("Record a voice doubt")?.feature_id).toBe(
      "student.voice_doubt.submit",
    );
  });
});

describe("No super_admin", () => {
  it("new capabilities exclude super_admin", () => {
    for (const id of [
      "student.image_doubt.solve",
      "student.voice_doubt.submit",
      "teacher.question_paper.marking_scheme",
    ]) {
      expect(getCapability(id)?.allowed_roles.includes("super_admin" as never)).toBe(false);
    }
  });
});
