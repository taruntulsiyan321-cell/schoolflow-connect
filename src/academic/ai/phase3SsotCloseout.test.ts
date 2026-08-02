/**
 * Phase 3 SSOT close-out — embedding provider, OCR submit, benchmark CI,
 * paper outline, principal health brief.
 */

import { describe, expect, it } from "vitest";
import {
  isEmbeddingProviderConfigured,
  resolveEmbeddingApiKey,
  planProcessOneEmbeddingJob,
  parseEmbeddingApiResponse,
  processOneEmbeddingJob,
  buildEmbeddingRequestBody,
} from "./embeddingProvider";
import {
  validateImageMetadata,
  runOcrPipelineStub,
  runImageDoubtSubmit,
} from "./multimodalPipeline";
import {
  evaluateFixture,
  runBuiltinBenchmarkSuites,
  evaluateBenchmarkGate,
  BUILTIN_BENCHMARK_FIXTURES,
  criticalSuiteIds,
} from "./benchmarkSuite";
import {
  buildQuestionPaperOutline,
  buildOutlineSectionsFromPlan,
  renderOutlinePrompt,
} from "./questionPaperOutline";
import { planQuestionPaper } from "./questionPaperPlan";
import { buildSchoolHealthBrief } from "./schoolHealthBrief";
import { getCapability } from "./capabilityCatalog";
import { planRoute } from "./routerPolicy";
import { mapIntentToCapability } from "./intentMapper";
import {
  createWorkflowRun,
  getWorkflowDefinition,
  listWorkflowDefinitions,
} from "./workflowOrchestrator";
import { getBuiltinPrompt } from "./promptLibrary";
import { SESSION_MEMORY_CAPABILITIES } from "./sessionMemory";
import { isEmbeddingProviderConfigured as kmsEmbConfigured } from "./knowledgeManagement";

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

describe("Embedding provider hook", () => {
  it("defers when no API keys are set", () => {
    expect(isEmbeddingProviderConfigured({})).toBe(false);
    expect(kmsEmbConfigured({})).toBe(false);
    const plan = planProcessOneEmbeddingJob(
      {
        job_id: "j1",
        chunk_id: "c1",
        school_id: "s1",
        chunk_text: "Fractions are parts of a whole",
      },
      {},
    );
    expect(plan.action).toBe("defer");
  });

  it("accepts OPENROUTER_API_KEY and AI_EMBEDDING_API_KEY", () => {
    expect(resolveEmbeddingApiKey({ OPENROUTER_API_KEY: "sk-or" })?.provider).toBe(
      "openrouter",
    );
    expect(resolveEmbeddingApiKey({ AI_EMBEDDING_API_KEY: "sk-emb" })?.provider).toBe(
      "openai_compat",
    );
    expect(isEmbeddingProviderConfigured({ AI_EMBEDDING_API_KEY: "x" })).toBe(true);
  });

  it("plans embed action with truncated input when configured", () => {
    const plan = planProcessOneEmbeddingJob(
      {
        job_id: "j1",
        chunk_id: "c1",
        school_id: "s1",
        chunk_text: "Algebra basics",
      },
      { OPENROUTER_API_KEY: "sk-test" },
    );
    expect(plan.action).toBe("embed");
    if (plan.action === "embed") {
      expect(plan.provider).toBe("openrouter");
      expect(plan.input_text).toBe("Algebra basics");
      expect(buildEmbeddingRequestBody({ model: plan.model, text: plan.input_text }).input).toBe(
        "Algebra basics",
      );
    }
  });

  it("parses OpenAI-compatible embedding responses", () => {
    const parsed = parseEmbeddingApiResponse(
      { model: "text-embedding-3-small", data: [{ embedding: [0.1, 0.2, 0.3] }] },
      "openrouter",
      "fallback",
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.dims).toBe(3);
      expect(parsed.embedding).toEqual([0.1, 0.2, 0.3]);
    }
  });

  it("processOneEmbeddingJob defers without inventing vectors when unset", async () => {
    const result = await processOneEmbeddingJob(
      {
        job_id: "j1",
        chunk_id: "c1",
        school_id: "s1",
        chunk_text: "Hello",
      },
      { env: {} },
    );
    expect(result.ok).toBe(false);
    expect((result as Extract<typeof result, { ok: false }>).deferred).toBe(true);
  });

  it("processOneEmbeddingJob embeds via injected fetch", async () => {
    const result = await processOneEmbeddingJob(
      {
        job_id: "j1",
        chunk_id: "c1",
        school_id: "s1",
        chunk_text: "Hello",
      },
      {
        env: { OPENROUTER_API_KEY: "sk-test" },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              model: "openai/text-embedding-3-small",
              data: [{ embedding: [1, 0, 0] }],
            }),
            { status: 200 },
          ),
      },
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.embedding).toEqual([1, 0, 0]);
  });
});

describe("OCR pipeline hardening + image_doubt.submit", () => {
  it("rejects blocked mime and malware stub flag", () => {
    expect(
      validateImageMetadata({
        mime: "application/x-msdownload",
        bytes: 1200,
      }).ok,
    ).toBe(false);
    expect(
      validateImageMetadata({
        mime: "image/jpeg",
        bytes: 1200,
        width: 400,
        height: 300,
        malware_scan_status: "stub_flagged",
      }).errors,
    ).toContain("malware_stub_flagged");
    expect(
      validateImageMetadata({
        mime: "image/jpeg",
        bytes: 1200,
        filename: "virus.exe",
      }).errors,
    ).toContain("dangerous_filename_extension");
  });

  it("submit workflow clarifies without inventing problem text when OCR unset", () => {
    const result = runImageDoubtSubmit(
      { mime: "image/jpeg", bytes: 2000, width: 640, height: 480 },
      { providerConfigured: false },
    );
    expect(result.status).toBe("clarify");
    expect(result.invented_problem_text).toBe(false);
    expect(result.ocr_text).toBeNull();
    expect(result.normalised_question_text).toBeNull();
    expect(result.stop_reason).toBe("ocr_not_configured");
    expect(result.checkpoints.map((c) => c.step_id)).toEqual([
      "validate_media",
      "safety_screen",
      "ocr_extract",
      "confidence_gate",
    ]);
  });

  it("submit rejects oversized images before OCR", () => {
    const result = runImageDoubtSubmit(
      { mime: "image/png", bytes: 20 * 1024 * 1024, width: 100, height: 100 },
      { providerConfigured: true },
    );
    expect(result.status).toBe("rejected");
    expect(result.invented_problem_text).toBe(false);
  });

  it("OCR stub still never invents text when provider present but live deferred", () => {
    const ocr = runOcrPipelineStub(
      { mime: "image/webp", bytes: 900, width: 200, height: 200 },
      { providerConfigured: true },
    );
    expect(ocr.ok).toBe(false);
    if (!ocr.ok) {
      expect(ocr.action).toBe("clarify");
      expect(ocr.extraction?.ocr_text).toBeNull();
      expect(ocr.extraction?.normalised_question_text).toBeNull();
    }
  });

  it("registers enabled submit workflow", () => {
    const def = getWorkflowDefinition("student.image_doubt.submit.v1");
    expect(def?.enabled).toBe(true);
    const run = createWorkflowRun({
      workflow_id: "student.image_doubt.submit.v1",
      run_id: "sub-1",
    });
    expect(run.status).toBe("pending");
    expect(getCapability("student.image_doubt.submit")?.model_policy).toBe("never");
  });
});

describe("Benchmark CI scaffold", () => {
  it("evaluates every built-in fixture", () => {
    for (const f of BUILTIN_BENCHMARK_FIXTURES) {
      const r = evaluateFixture(f);
      expect(r.passed, `${f.suite_id}/${f.fixture_key}: ${r.detail}`).toBe(true);
    }
  });

  it("runs suite aggregate and passes critical gate", () => {
    const run = runBuiltinBenchmarkSuites();
    expect(run.fixture_results.every((r) => r.passed)).toBe(true);
    for (const sid of criticalSuiteIds()) {
      expect(run.suite_results[sid], sid).toBe(true);
    }
    expect(run.gate.gate_passed).toBe(true);
    expect(run.gate.missing_suites).toEqual([]);
  });

  it("gate fails when a critical suite is missing", () => {
    const gate = evaluateBenchmarkGate({
      candidate_label: "bad",
      latest_results: { hallucination: true, curriculum_grounding: true },
    });
    expect(gate.gate_passed).toBe(false);
    expect(gate.missing_suites).toContain("safety_privacy");
  });
});

describe("Teacher paper generate_outline", () => {
  it("returns plan-only under generative kill switch (no invented stems)", () => {
    const outline = buildQuestionPaperOutline({
      planInput: {
        subject: "Math",
        total_marks: 40,
        chapters: [{ name: "Algebra" }, { name: "Geometry" }],
        may_call_model: false,
      },
      may_call_model: false,
    });
    expect(outline.mode).toBe("plan_only");
    expect(outline.generates_marking_scheme).toBe(false);
    expect(outline.generates_full_paper).toBe(false);
    expect(outline.outline_text).toBeNull();
    expect(outline.sections.every((s) => s.suggested_question_stems.length === 0)).toBe(true);
    expect(outline.degraded_reason).toContain("generative");
  });

  it("accepts validated model outline text", () => {
    const outline = buildQuestionPaperOutline({
      planInput: {
        subject: "Science",
        total_marks: 50,
        chapters: [{ name: "Cells", weight_hint: 1 }],
      },
      may_call_model: true,
      model_text:
        "Section A — Cells (50 marks): short definitions and one diagram labelling item.",
    });
    expect(outline.mode).toBe("outline_with_model");
    expect(outline.outline_text).toMatch(/Cells/);
    expect(outline.validation_ok).toBe(true);
  });

  it("drops invalid model text and keeps plan skeleton", () => {
    const outline = buildQuestionPaperOutline({
      planInput: {
        subject: "Math",
        total_marks: 20,
        chapters: [{ name: "Fractions" }],
      },
      may_call_model: true,
      model_text: "",
      model_error: "empty",
    });
    expect(outline.mode).toBe("plan_only");
    expect(outline.outline_text).toBeNull();
  });

  it("has prompt library + capability + route policy", () => {
    expect(getBuiltinPrompt("teacher.question_paper.generate_outline")?.status).toBe(
      "production",
    );
    const cap = getCapability("teacher.question_paper.generate_outline");
    expect(cap?.model_policy).toBe("required_when_budget");
    expect(cap?.allowed_roles).toEqual(["teacher", "admin"]);
    expect(cap?.allowed_roles.includes("super_admin" as never)).toBe(false);

    const on = planRoute("teacher.question_paper.generate_outline", FLAGS_ON);
    if (!("rejected" in on)) expect(on.may_call_model).toBe(true);

    const off = planRoute("teacher.question_paper.generate_outline", FLAGS_GEN_OFF);
    if (!("rejected" in off)) {
      expect(off.may_call_model).toBe(false);
      expect(off.decision_if_ready).toBe("answered_facts_only");
    }

    const plan = planQuestionPaper({
      subject: "Math",
      total_marks: 10,
      chapters: [{ name: "A" }],
    });
    expect(buildOutlineSectionsFromPlan(plan)).toHaveLength(1);
    expect(renderOutlinePrompt(plan).system.length).toBeGreaterThan(20);
    expect(getWorkflowDefinition("teacher.question_paper.outline.v1")?.enabled).toBe(true);
  });
});

describe("Principal school health brief", () => {
  it("returns honest empty when aggregates missing", () => {
    const brief = buildSchoolHealthBrief({ school_id: "s1" });
    expect(brief.status).toBe("empty");
    expect(brief.used_model).toBe(false);
    expect(brief.bullets).toEqual([]);
    expect(brief.headline).toMatch(/not available/i);
    expect(brief.notes.some((n) => /honest empty/i.test(n))).toBe(true);
  });

  it("builds deterministic brief from AE/EIE aggregates without inventing", () => {
    const brief = buildSchoolHealthBrief({
      school_id: "s1",
      class_count: 12,
      student_count: 400,
      teacher_count: 28,
      avg_attendance_pct: 91.2,
      avg_homework_completion_pct: 78,
      avg_tests_pct: 72,
      avg_mastery: 64,
      weak_concept_count: 40,
      attendance_risk_band: "moderate",
      source_as_of: "2026-08-01T00:00:00Z",
      data_version: "school_health:test",
      eie_algorithm_id: "eie.mastery.v1",
    });
    expect(brief.status).toBe("ready");
    expect(brief.used_model).toBe(false);
    expect(brief.metrics.avg_attendance_pct).toBe(91.2);
    expect(brief.bullets.some((b) => /91\.2%/.test(b))).toBe(true);
    expect(JSON.stringify(brief)).not.toMatch(/Arjun|Priya|1382/);
    expect(brief.completeness).toBeGreaterThan(0.5);
  });

  it("registers capability, session scope, workflow", () => {
    const cap = getCapability("principal.school.health_brief");
    expect(cap?.route_class).toBe("deterministic_insight");
    expect(cap?.model_policy).toBe("never");
    expect(cap?.allowed_roles).toEqual(["principal", "admin"]);
    expect(SESSION_MEMORY_CAPABILITIES["principal.school.health_brief"]).toBe(
      "principal_analytics",
    );
    expect(getWorkflowDefinition("principal.school.health_brief.v1")?.enabled).toBe(true);
    expect(mapIntentToCapability("Show me the school health brief")?.feature_id).toBe(
      "principal.school.health_brief",
    );
    const plan = planRoute("principal.school.health_brief", FLAGS_ON);
    if (!("rejected" in plan)) {
      expect(plan.may_call_model).toBe(false);
      expect(plan.decision_if_ready).toBe("answered_deterministic");
    }
  });
});

describe("No super_admin + multi-agent still reserved", () => {
  it("new capabilities exclude super_admin", () => {
    for (const id of [
      "student.image_doubt.submit",
      "teacher.question_paper.generate_outline",
      "principal.school.health_brief",
    ]) {
      const roles = getCapability(id)?.allowed_roles ?? [];
      expect(roles.includes("super_admin" as never)).toBe(false);
    }
  });

  it("full image-doubt tutoring workflow remains disabled", () => {
    expect(getWorkflowDefinition("student.image_doubt.v1")?.enabled).toBe(false);
    expect(getWorkflowDefinition("teacher.question_paper.v1")?.enabled).toBe(false);
    expect(listWorkflowDefinitions().length).toBeGreaterThanOrEqual(6);
  });
});
