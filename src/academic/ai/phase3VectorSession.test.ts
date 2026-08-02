/**
 * Phase 3 continued — Vector Retrieval v0, embedding stub, Session Memory v1,
 * teacher paper plan dry-run.
 */

import { describe, expect, it } from "vitest";
import {
  lexicalOverlap,
  cosineSimilarity,
  isEvidenceSufficient,
  buildEvidenceCitations,
  rankApprovedChunksLocally,
  parseRetrievalRpcPayload,
} from "./vectorRetrieval";
import {
  isEmbeddingProviderConfigured,
  planEmbeddingJobAction,
  buildEmbeddingStub,
} from "./knowledgeManagement";
import {
  SESSION_MEMORY_CAPABILITIES,
  sessionScopeForCapability,
  isSessionMemoryAllowed,
  buildSessionSummaryPatch,
  redactSessionForContext,
} from "./sessionMemory";
import { planQuestionPaper, runPaperPlanDryRun } from "./questionPaperPlan";
import {
  createWorkflowRun,
  getWorkflowDefinition,
  listWorkflowDefinitions,
} from "./workflowOrchestrator";
import { getCapability } from "./capabilityCatalog";
import { planRoute } from "./routerPolicy";
import { mapIntentToCapability } from "./intentMapper";
import { buildContextPack } from "./contextBuilder";

const FLAGS = {
  gatewayEnabled: true,
  deterministicEnabled: true,
  generativeEnabled: true,
};

describe("Vector Retrieval v0", () => {
  it("scores lexical overlap without inventing tokens", () => {
    expect(lexicalOverlap("fractions decimals", "Learn fractions and decimals today")).toBe(1);
    expect(lexicalOverlap("photosynthesis", "gravity and motion")).toBe(0);
    expect(lexicalOverlap("", "anything")).toBe(0);
  });

  it("computes cosine similarity for compat vectors", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([], [1])).toBeNull();
  });

  it("ranks only published approved chunks; draft excluded", () => {
    const pack = rankApprovedChunksLocally({
      query: "fractions improper",
      chunks: [
        {
          chunk_id: "c1",
          document_id: "d1",
          chunk_text: "Improper fractions are greater than one",
          published: true,
          document_status: "published",
          document_title: "Math notes",
        },
        {
          chunk_id: "c2",
          document_id: "d2",
          chunk_text: "Improper fractions draft only",
          published: false,
          document_status: "draft",
        },
        {
          chunk_id: "c3",
          document_id: "d3",
          chunk_text: "Gravity and orbits",
          published: true,
          document_status: "published",
        },
      ],
      min_score: 0.2,
    });
    expect(pack.approved_only).toBe(true);
    expect(pack.hits.map((h) => h.chunk_id)).toEqual(["c1"]);
    expect(pack.sufficient).toBe(true);
    expect(pack.mode).toBe("lexical");
  });

  it("prefers vector_compat when query embedding present", () => {
    const pack = rankApprovedChunksLocally({
      query: "ignored when vector matches",
      query_embedding: [1, 0, 0],
      chunks: [
        {
          chunk_id: "v1",
          document_id: "d1",
          chunk_text: "unrelated text",
          published: true,
          document_status: "published",
          embedding_compat: [0.9, 0.1, 0],
        },
      ],
      min_score: 0.5,
    });
    expect(pack.mode).toBe("vector_compat");
    expect(pack.hits[0]?.chunk_id).toBe("v1");
  });

  it("falls back to lexical when vectors missing", () => {
    const pack = rankApprovedChunksLocally({
      query: "algebra equations",
      query_embedding: [1, 0],
      chunks: [
        {
          chunk_id: "l1",
          document_id: "d1",
          chunk_text: "Solving algebra equations",
          published: true,
          document_status: "published",
          embedding_compat: null,
        },
      ],
      min_score: 0.3,
    });
    expect(pack.mode).toBe("lexical");
    expect(pack.sufficient).toBe(true);
  });

  it("parses RPC payload and evidence citations", () => {
    const pack = parseRetrievalRpcPayload(
      {
        school_id: "s1",
        query: "fractions",
        mode: "lexical",
        min_score: 0.12,
        hits: [
          {
            chunk_id: "c1",
            document_id: "d1",
            chunk_text: "A long excerpt about fractions ".repeat(20),
            document_title: "Notes",
            score: 0.8,
            match_mode: "lexical",
          },
        ],
        hit_count: 1,
        approved_only: true,
      },
      "s1",
      "fractions",
    );
    expect(isEvidenceSufficient(pack.hits)).toBe(true);
    const cites = buildEvidenceCitations(pack.hits);
    expect(cites[0]?.excerpt.length).toBeLessThanOrEqual(280);
    expect(cites[0]?.title).toBe("Notes");
  });
});

describe("Embedding job stub", () => {
  it("defers when provider unset (safe degrade)", () => {
    expect(isEmbeddingProviderConfigured({})).toBe(false);
    expect(planEmbeddingJobAction(false)).toEqual({
      action: "defer",
      embed_status: "deferred",
      reason: "embedding_provider_unset",
    });
    expect(buildEmbeddingStub().status).toBe("deferred");
  });

  it("marks pending_embed when a provider key is present", () => {
    expect(isEmbeddingProviderConfigured({ OPENAI_API_KEY: "sk-test" })).toBe(true);
    expect(planEmbeddingJobAction(true).action).toBe("embed");
    expect(planEmbeddingJobAction(true).embed_status).toBe("pending_embed");
  });
});

describe("Session Memory v1", () => {
  it("maps tutoring / paper / parent / principal scopes", () => {
    expect(sessionScopeForCapability("student.concept.explain")).toBe("tutoring");
    expect(sessionScopeForCapability("teacher.question_paper.plan")).toBe("paper_gen");
    expect(sessionScopeForCapability("parent.child.summary")).toBe("parent_guidance");
    expect(SESSION_MEMORY_CAPABILITIES["principal.analytics.brief"]).toBe(
      "principal_analytics",
    );
    expect(isSessionMemoryAllowed("student.attendance.query")).toBe(false);
  });

  it("builds structured summary patches without raw chat dumps", () => {
    const patch = buildSessionSummaryPatch({
      last_feature_id: "student.concept.explain",
      last_decision: "answered_retrieval",
      concepts_touched: ["Fractions", "Decimals", "x", "y", "z", "a", "b", "c", "d"],
      misconceptions_addressed: ["confusing numerator"],
    });
    expect(patch.last_feature_id).toBe("student.concept.explain");
    expect((patch.concepts_touched as string[]).length).toBe(8);
    expect(JSON.stringify(patch)).not.toMatch(/user said/i);
  });

  it("redacts inactive sessions from context", () => {
    expect(
      redactSessionForContext({
        session_id: "s1",
        workflow_scope: "tutoring",
        status: "closed",
        summary: { concepts_touched: ["A"] },
        turn_count: 2,
      }),
    ).toBeNull();
    const active = redactSessionForContext({
      session_id: "s1",
      workflow_scope: "tutoring",
      status: "active",
      summary: { concepts_touched: ["Fractions"], last_decision: "answered_retrieval" },
      turn_count: 3,
    });
    expect(active?.turn_count).toBe(3);
    expect(active?.concepts_touched).toEqual(["Fractions"]);
  });

  it("injects session memory into context pack when provided", () => {
    const pack = buildContextPack({
      capability: "student.concept.explain",
      request_text: "Explain fractions",
      ae: {},
      eie: { avg_mastery: 0.4, data_version: "e1" },
      retrieval: { mode: "lexical", citations: [{ excerpt: "Improper fractions" }] },
      session_memory: { workflow_scope: "tutoring", turn_count: 2, concepts_touched: ["Fractions"] },
    });
    expect(pack.retrieval_evidence).not.toBeNull();
    expect(pack.session_memory?.workflow_scope).toBe("tutoring");
    expect(pack.provenance.projection_names.some((p) => p.startsWith("kms_retrieval:"))).toBe(
      true,
    );
  });
});

describe("Teacher question paper plan dry-run", () => {
  it("allocates deterministic curriculum weights without generating questions", () => {
    const plan = planQuestionPaper({
      subject: "Mathematics",
      grade: "8",
      total_marks: 100,
      chapters: [
        { name: "Fractions", weight_hint: 2 },
        { name: "Algebra", weight_hint: 1 },
        { name: "Geometry", weight_hint: 1 },
      ],
    });
    expect(plan.dry_run).toBe(true);
    expect(plan.generates_questions).toBe(false);
    expect(plan.capability_id).toBe("teacher.question_paper.plan");
    expect(plan.chapters.reduce((s, c) => s + c.marks, 0)).toBe(100);
    expect(plan.chapters[0]?.marks).toBe(50);
    expect(plan.chapters[1]?.marks).toBe(25);
    expect(plan.plan_hash.startsWith("plan_")).toBe(true);
    expect(JSON.stringify(plan)).not.toMatch(/Qwen|OpenRouter/i);
  });

  it("runPaperPlanDryRun completes all planned checkpoints", () => {
    const run = runPaperPlanDryRun({
      subject: "Science",
      total_marks: 40,
      chapters: [{ name: "Cells" }, { name: "Atoms" }],
    });
    expect(run.run_status).toBe("completed");
    expect(run.checkpoints.every((c) => c.ok)).toBe(true);
    expect(run.plan.chapters.every((c) => c.marks === 20)).toBe(true);
  });

  it("registers enabled plan workflow and disabled full generate", () => {
    const planWf = getWorkflowDefinition("teacher.question_paper.plan.v1");
    expect(planWf?.enabled).toBe(true);
    expect(planWf?.capability_id).toBe("teacher.question_paper.plan");
    expect(getWorkflowDefinition("teacher.question_paper.v1")?.enabled).toBe(false);
    const run = createWorkflowRun({
      workflow_id: "teacher.question_paper.plan.v1",
      run_id: "plan-1",
    });
    expect(run.status).toBe("pending");
    expect(run.error_code).toBeUndefined();
    expect(listWorkflowDefinitions().length).toBeGreaterThanOrEqual(3);
  });
});

describe("Capability catalog + router policy", () => {
  it("registers knowledge.retrieve and paper.plan without super_admin", () => {
    const retrieve = getCapability("student.knowledge.retrieve");
    expect(retrieve?.route_class).toBe("grounded_retrieval");
    expect(retrieve?.model_policy).toBe("never");
    expect(retrieve?.requires_student_target).toBe(false);
    expect(retrieve?.allowed_roles.includes("super_admin" as never)).toBe(false);

    const paper = getCapability("teacher.question_paper.plan");
    expect(paper?.route_class).toBe("content_generation");
    expect(paper?.model_policy).toBe("never");
    expect(paper?.allowed_roles).toEqual(["teacher", "admin"]);
  });

  it("plans retrieval and paper routes without model", () => {
    const r = planRoute("student.knowledge.retrieve", FLAGS);
    expect("rejected" in r && r.rejected).toBeFalsy();
    if (!("rejected" in r)) {
      expect(r.may_call_model).toBe(false);
      expect(r.decision_if_ready).toBe("answered_retrieval");
    }
    const p = planRoute("teacher.question_paper.plan", FLAGS);
    if (!("rejected" in p)) {
      expect(p.may_call_model).toBe(false);
      expect(p.decision_if_ready).toBe("answered_deterministic");
    }
  });

  it("maps intents for retrieve and paper plan", () => {
    expect(mapIntentToCapability("Find this in my textbook notes")?.feature_id).toBe(
      "student.knowledge.retrieve",
    );
    expect(mapIntentToCapability("Plan a question paper with curriculum weights")?.feature_id).toBe(
      "teacher.question_paper.plan",
    );
  });
});

describe("No super_admin on new Phase 3 surfaces", () => {
  it("excludes super_admin from new capabilities", () => {
    for (const id of [
      "student.knowledge.retrieve",
      "teacher.question_paper.plan",
      "student.concept.explain",
    ]) {
      const roles = getCapability(id)?.allowed_roles ?? [];
      expect(roles.includes("super_admin" as never)).toBe(false);
    }
  });
});
