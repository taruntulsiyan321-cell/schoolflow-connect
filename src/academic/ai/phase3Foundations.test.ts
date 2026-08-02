/**
 * Phase 3 — KMS, OCR stub, Benchmark gate, Prompt Evaluation, Failure Recovery.
 */

import { describe, expect, it } from "vitest";
import {
  chunkPedagogicalText,
  buildEmbeddingStub,
  isPublishedForRetrieval,
} from "./knowledgeManagement";
import {
  validateImageMetadata,
  runOcrPipelineStub,
  isOcrProviderConfigured,
} from "./multimodalPipeline";
import {
  BUILTIN_BENCHMARK_SUITES,
  BUILTIN_BENCHMARK_FIXTURES,
  criticalSuiteIds,
  evaluateBenchmarkGate,
} from "./benchmarkSuite";
import {
  canTransitionPromptStatus,
  assertPromotionAllowed,
  feedbackMayTriggerReevaluation,
  normalizePromptEvalStatus,
} from "./promptEvaluation";
import {
  classifyProviderError,
  shouldRetryFailure,
  computeBackoffMs,
  planFailureRecovery,
  withRetry,
} from "./failureRecovery";
import {
  createWorkflowRun,
  getWorkflowDefinition,
  listWorkflowDefinitions,
} from "./workflowOrchestrator";
import { getCapability } from "./capabilityCatalog";
import { getBuiltinPrompt } from "./promptLibrary";

describe("Knowledge Management v0", () => {
  it("chunks on pedagogical blank lines without inventing text", () => {
    const chunks = chunkPedagogicalText("Part A\n\nPart B\n\n\nPart C");
    expect(chunks).toEqual(["Part A", "Part B", "Part C"]);
    expect(chunkPedagogicalText("")).toEqual([]);
    expect(chunkPedagogicalText("single")).toEqual(["single"]);
  });

  it("uses deferred embedding stub (no fake vectors)", () => {
    expect(buildEmbeddingStub()).toEqual({ status: "deferred", dims: 0 });
    expect(isPublishedForRetrieval("published", true)).toBe(true);
    expect(isPublishedForRetrieval("draft", true)).toBe(false);
    expect(isPublishedForRetrieval("published", false)).toBe(false);
  });
});

describe("OCR / Multimodal pipeline v0", () => {
  it("rejects invalid image metadata", () => {
    const bad = validateImageMetadata({ mime: "application/pdf", bytes: 10 });
    expect(bad.ok).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
  });

  it("accepts jpeg metadata bounds", () => {
    const ok = validateImageMetadata({
      mime: "image/jpeg",
      bytes: 1200,
      width: 800,
      height: 600,
    });
    expect(ok.ok).toBe(true);
  });

  it("clarifies when OCR provider is not configured (never invents OCR text)", () => {
    expect(isOcrProviderConfigured({})).toBe(false);
    const result = runOcrPipelineStub(
      { mime: "image/jpeg", bytes: 2000, width: 640, height: 480 },
      { providerConfigured: false },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fail = result as Extract<typeof result, { ok: false }>;
      expect(fail.action).toBe("clarify");
      expect(fail.reason).toBe("ocr_not_configured");
      expect(fail.extraction?.ocr_text).toBeNull();
      expect(fail.extraction?.normalised_question_text).toBeNull();
    }
  });

  it("matches benchmark fixture expectation for missing provider", () => {
    const fixture = BUILTIN_BENCHMARK_FIXTURES.find(
      (f) => f.fixture_key === "missing_provider_clarify",
    )!;
    const img = fixture.input.image as {
      mime: string;
      bytes: number;
      width: number;
      height: number;
    };
    const result = runOcrPipelineStub(img, { providerConfigured: false });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fail = result as Extract<typeof result, { ok: false }>;
      expect(fail.action).toBe(fixture.expected.action);
      expect(fail.reason).toBe(fixture.expected.reason);
    }
  });
});

describe("Benchmark Suite scaffold", () => {
  it("seeds critical suites including hallucination and safety", () => {
    const critical = criticalSuiteIds();
    expect(critical).toContain("hallucination");
    expect(critical).toContain("curriculum_grounding");
    expect(critical).toContain("safety_privacy");
    expect(BUILTIN_BENCHMARK_SUITES.some((s) => s.suite_id === "ocr_multimodal")).toBe(
      true,
    );
    expect(BUILTIN_BENCHMARK_FIXTURES.length).toBeGreaterThanOrEqual(5);
  });

  it("gate fails when critical suites missing", () => {
    const g = evaluateBenchmarkGate({
      candidate_label: "prompt:student.concept.explain:v2",
      latest_results: { hallucination: true },
    });
    expect(g.gate_passed).toBe(false);
    expect(g.missing_suites.length).toBeGreaterThan(0);
  });

  it("gate passes only when all critical suites green", () => {
    const g = evaluateBenchmarkGate({
      candidate_label: "prompt:student.concept.explain:v2",
      latest_results: {
        hallucination: true,
        curriculum_grounding: true,
        safety_privacy: true,
      },
    });
    expect(g.gate_passed).toBe(true);
    expect(g.failed_suites).toEqual([]);
    expect(g.missing_suites).toEqual([]);
  });

  it("gate fails on any critical regression", () => {
    const g = evaluateBenchmarkGate({
      candidate_label: "model:qwen-alt",
      latest_results: {
        hallucination: true,
        curriculum_grounding: false,
        safety_privacy: true,
      },
    });
    expect(g.gate_passed).toBe(false);
    expect(g.failed_suites).toContain("curriculum_grounding");
  });
});

describe("Prompt Evaluation Framework", () => {
  it("normalizes legacy shadow/production statuses", () => {
    expect(normalizePromptEvalStatus("shadow")).toBe("shadow");
    expect(normalizePromptEvalStatus("draft")).toBe("draft");
  });

  it("allows draft → offline_benchmark → shadow → ab_test → production", () => {
    expect(canTransitionPromptStatus("draft", "offline_benchmark")).toBe(true);
    expect(canTransitionPromptStatus("offline_benchmark", "shadow")).toBe(true);
    expect(canTransitionPromptStatus("shadow", "ab_test")).toBe(true);
    expect(canTransitionPromptStatus("ab_test", "production")).toBe(true);
    expect(canTransitionPromptStatus("draft", "production")).toBe(false);
  });

  it("blocks production without benchmark evidence", () => {
    const blocked = assertPromotionAllowed({
      from: "ab_test",
      to: "production",
      scorecard: {},
      benchmark_run_ids: [],
    });
    expect(blocked.ok).toBe(false);

    const ok = assertPromotionAllowed({
      from: "ab_test",
      to: "production",
      scorecard: { gate_passed: true },
    });
    expect(ok.ok).toBe(true);
  });

  it("feedback may re-evaluate but never implies auto-promote", () => {
    expect(feedbackMayTriggerReevaluation("dislike")).toBe(true);
    expect(feedbackMayTriggerReevaluation("like")).toBe(false);
    expect(canTransitionPromptStatus("draft", "production")).toBe(false);
  });

  it("keeps builtin production prompts loadable", () => {
    expect(getBuiltinPrompt("student.performance.explain")?.status).toBe("production");
  });
});

describe("Enterprise Failure Recovery", () => {
  it("classifies transient vs permanent provider errors", () => {
    expect(classifyProviderError("OpenRouter error 429: rate limit")).toBe(
      "provider_transient",
    );
    expect(classifyProviderError("timeout waiting")).toBe("provider_transient");
    expect(classifyProviderError("OPENROUTER_API_KEY not configured")).toBe(
      "provider_permanent",
    );
    expect(classifyProviderError("401 unauthorized")).toBe("provider_permanent");
  });

  it("retries only transient/unknown within policy", () => {
    expect(shouldRetryFailure("provider_transient", 1)).toBe(true);
    expect(shouldRetryFailure("provider_permanent", 1)).toBe(false);
    expect(shouldRetryFailure("provider_transient", 3)).toBe(false);
  });

  it("computes backoff with jitter bounds", () => {
    const ms = computeBackoffMs(2, undefined, () => 0);
    expect(ms).toBe(400); // base 200 * 2^(1)
    const withJitter = computeBackoffMs(2, undefined, () => 1);
    expect(withJitter).toBeGreaterThan(ms);
  });

  it("plans safe_fail when retries exhausted and no queue", () => {
    const plan = planFailureRecovery({
      error: "OpenRouter error 503",
      attempt: 3,
    });
    expect(plan.next_stage).toBe("safe_fail");
    expect(plan.user_message.toLowerCase()).toContain("unavailable");
  });

  it("withRetry succeeds after transient failures", async () => {
    let n = 0;
    const result = await withRetry(
      async () => {
        n += 1;
        if (n < 3) throw new Error("503 timeout");
        return "ok";
      },
      { sleep: async () => {}, random: () => 0 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toBe("ok");
      expect(result.attempts).toBe(3);
    }
  });

  it("withRetry does not retry permanent failures", async () => {
    let n = 0;
    const result = await withRetry(
      async () => {
        n += 1;
        throw new Error("not configured");
      },
      { sleep: async () => {}, random: () => 0 },
    );
    expect(result.ok).toBe(false);
    expect(n).toBe(1);
    if (!result.ok) expect((result as Extract<typeof result, { ok: false }>).plan.next_stage).toBe("safe_fail");
  });
});

describe("Image doubt workflow + capability", () => {
  it("registers student.image_doubt.v1 disabled with OCR steps", () => {
    const def = getWorkflowDefinition("student.image_doubt.v1");
    expect(def?.enabled).toBe(false);
    expect(def?.steps.some((s) => s.kind === "ocr_extract")).toBe(true);
    expect(def?.steps.some((s) => s.kind === "media_validate")).toBe(true);
    expect(listWorkflowDefinitions().length).toBeGreaterThanOrEqual(2);
  });

  it("createWorkflowRun stays registered when disabled", () => {
    const run = createWorkflowRun({
      workflow_id: "student.image_doubt.v1",
      run_id: "img-1",
    });
    expect(run.status).toBe("registered");
    expect(run.error_code).toBe("workflow_disabled");
  });

  it("catalog lists multimodal image doubt capability", () => {
    const cap = getCapability("student.image_doubt");
    expect(cap?.route_class).toBe("multimodal");
    expect(cap?.allowed_roles).toContain("student");
    expect(cap?.allowed_roles).not.toContain("super_admin");
  });

  it("lists at least three registered workflows including paper plan", () => {
    expect(listWorkflowDefinitions().length).toBeGreaterThanOrEqual(3);
    expect(getWorkflowDefinition("teacher.question_paper.plan.v1")?.enabled).toBe(true);
  });
});

describe("No super_admin in Phase 3 surfaces", () => {
  it("image doubt and recommendation roles exclude super_admin", () => {
    for (const id of [
      "student.image_doubt",
      "student.recommendation.next",
      "student.concept.explain",
    ]) {
      const roles = getCapability(id)?.allowed_roles ?? [];
      expect(roles.includes("super_admin" as never)).toBe(false);
    }
  });
});
