/**
 * Phase 3 SSOT close-out — embedding provider, OCR submit, paper outline,
 * principal health brief. Every import is an edge module a deployed function
 * runs; each private helper is reached through the function that calls it.
 */

import { describe, expect, it } from "vitest";
import {
  isEmbeddingProviderConfigured,
  resolveEmbeddingApiKey,
  processOneEmbeddingJob,
  embedQueryText,
} from "../../../supabase/functions/_shared/embeddingProvider.ts";
import { runImageDoubtSubmit } from "../../../supabase/functions/_shared/multimodalPipeline.ts";
import {
  buildQuestionPaperOutline,
  renderOutlinePrompt,
} from "../../../supabase/functions/_shared/questionPaperOutline.ts";
import { planQuestionPaper } from "../../../supabase/functions/_shared/questionPaperPlan.ts";
import { buildSchoolHealthBrief } from "../../../supabase/functions/_shared/schoolHealthBrief.ts";
import { getCapability } from "../../../supabase/functions/_shared/capabilityCatalog.ts";
import { mapIntentToCapability } from "./intentMapper";
import { getBuiltinPrompt } from "../../../supabase/functions/_shared/promptLibrary.ts";
import { sessionScopeForCapability } from "../../../supabase/functions/_shared/sessionMemory.ts";

const JOB = { job_id: "j1", chunk_id: "c1", school_id: "s1", chunk_text: "Algebra basics" };

/** A fetch that answers with one embedding and records every request. */
function embeddingFetch(embedding: number[]) {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(
      JSON.stringify({ model: "openai/text-embedding-3-small", data: [{ embedding }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { requests, fetchImpl };
}

describe("Embedding provider hook", () => {
  it("defers when no API keys are set", () => {
    expect(isEmbeddingProviderConfigured({})).toBe(false);
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

  it("sends the chunk text to the configured provider and reads its vector back", async () => {
    const { requests, fetchImpl } = embeddingFetch([0.1, 0.2, 0.3]);
    const result = await processOneEmbeddingJob(JOB, {
      env: { OPENROUTER_API_KEY: "sk-test" },
      fetchImpl,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(requests[0].body.input).toBe("Algebra basics");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.dims).toBe(3);
      expect(result.embedding).toEqual([0.1, 0.2, 0.3]);
    }
  });

  it("defers an empty chunk without calling the provider", async () => {
    const { requests, fetchImpl } = embeddingFetch([1]);
    const result = await processOneEmbeddingJob(
      { ...JOB, chunk_text: "   " },
      { env: { OPENROUTER_API_KEY: "sk-test" }, fetchImpl },
    );
    expect(requests).toHaveLength(0);
    expect(result.ok).toBe(false);
    expect((result as Extract<typeof result, { ok: false }>).deferred).toBe(true);
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

  it("embedQueryText never invents vectors when unset or empty", async () => {
    expect((await embedQueryText("fractions", { env: {} })).ok).toBe(false);
    expect((await embedQueryText("  ", { env: { OPENROUTER_API_KEY: "sk" } })).ok).toBe(false);
  });

  it("embedQueryText returns provider vectors via injected fetch", async () => {
    const result = await embedQueryText("fractions", {
      env: { OPENROUTER_API_KEY: "sk-test" },
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            model: "openai/text-embedding-3-small",
            data: [{ embedding: [0.2, 0.8] }],
          }),
          { status: 200 },
        ),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.embedding).toEqual([0.2, 0.8]);
      expect(result.provider).toBe("openrouter");
    }
  });
});

describe("OCR pipeline hardening + image_doubt.submit", () => {
  it("rejects blocked mime, a flagged scan and an executable name", () => {
    const blocked = runImageDoubtSubmit({ mime: "application/x-msdownload", bytes: 1200 });
    expect(blocked.status).toBe("rejected");
    expect(blocked.stop_reason).toContain("blocked_mime");
    const flagged = runImageDoubtSubmit({
      mime: "image/jpeg",
      bytes: 1200,
      width: 400,
      height: 300,
      malware_scan_status: "stub_flagged",
    });
    expect(flagged.status).toBe("rejected");
    expect(flagged.stop_reason).toContain("malware_stub_flagged");
    const exe = runImageDoubtSubmit({ mime: "image/jpeg", bytes: 1200, filename: "virus.exe" });
    expect(exe.status).toBe("rejected");
    expect(exe.stop_reason).toContain("dangerous_filename_extension");
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

  it("never invents text when a provider is present but live OCR is deferred", () => {
    const result = runImageDoubtSubmit(
      { mime: "image/webp", bytes: 900, width: 200, height: 200 },
      { providerConfigured: true },
    );
    expect(result.status).toBe("clarify");
    expect(result.invented_problem_text).toBe(false);
    expect(result.ocr_text).toBeNull();
    expect(result.normalised_question_text).toBeNull();
  });

  it("registers the submit capability without a model", () => {
    expect(getCapability("student.image_doubt.submit")?.model_policy).toBe("never");
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

  it("has prompt library + capability", () => {
    expect(getBuiltinPrompt("teacher.question_paper.generate_outline")?.status).toBe(
      "production",
    );
    const cap = getCapability("teacher.question_paper.generate_outline");
    expect(cap?.model_policy).toBe("required_when_budget");
    expect(cap?.allowed_roles).toEqual(["teacher", "admin"]);
    expect(cap?.allowed_roles.includes("super_admin" as never)).toBe(false);

    const plan = planQuestionPaper({
      subject: "Math",
      total_marks: 10,
      chapters: [{ name: "A" }],
    });
    const outline = buildQuestionPaperOutline({
      planInput: { subject: "Math", total_marks: 10, chapters: [{ name: "A" }] },
      may_call_model: false,
    });
    expect(outline.sections).toHaveLength(1);
    expect(renderOutlinePrompt(plan).system.length).toBeGreaterThan(20);
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

  it("registers capability and session scope", () => {
    const cap = getCapability("principal.school.health_brief");
    expect(cap?.route_class).toBe("deterministic_insight");
    expect(cap?.model_policy).toBe("never");
    expect(cap?.allowed_roles).toEqual(["principal", "admin"]);
    expect(sessionScopeForCapability("principal.school.health_brief")).toBe(
      "principal_analytics",
    );
    expect(mapIntentToCapability("Show me the school health brief")?.feature_id).toBe(
      "principal.school.health_brief",
    );
  });
});

describe("No super_admin", () => {
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
});
