/**
 * Phase 3 continued — Vector Retrieval, Session Memory v1, teacher paper plan.
 *
 * Ranking is the SQL function `ai_kms_retrieve_chunks`; what the edge module
 * owns is reading its payload, which is tested through `retrieveKmsChunks`.
 */

import { describe, expect, it } from "vitest";
import {
  buildEvidenceCitations,
  retrieveKmsChunks,
} from "../../../supabase/functions/_shared/vectorRetrieval.ts";
import {
  sessionScopeForCapability,
  isSessionMemoryAllowed,
  buildSessionSummaryPatch,
  redactSessionForContext,
} from "../../../supabase/functions/_shared/sessionMemory.ts";
import { planQuestionPaper } from "../../../supabase/functions/_shared/questionPaperPlan.ts";
import { getCapability } from "../../../supabase/functions/_shared/capabilityCatalog.ts";
import { mapIntentToCapability } from "./intentMapper";
import { buildContextPack } from "../../../supabase/functions/_shared/contextBuilder.ts";

/** A client whose one RPC answers with `payload`, recording what it was asked. */
function rpcReturning(payload: unknown) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  return {
    calls,
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: payload, error: null };
    },
  };
}

describe("Vector Retrieval v0", () => {
  it("parses RPC payload and evidence citations", async () => {
    const client = rpcReturning({
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
    });
    const pack = await retrieveKmsChunks(client, { school_id: "s1", query: "fractions" });
    expect(client.calls.map((c) => c.fn)).toEqual(["ai_kms_retrieve_chunks"]);
    expect(pack.hits.map((h) => h.chunk_id)).toEqual(["c1"]);
    expect(pack.sufficient).toBe(true);
    const cites = buildEvidenceCitations(pack.hits);
    expect(cites[0]?.excerpt.length).toBeLessThanOrEqual(280);
    expect(cites[0]?.title).toBe("Notes");
  });
});

describe("Session Memory v1", () => {
  it("maps tutoring / paper / parent / principal scopes", () => {
    expect(sessionScopeForCapability("student.concept.explain")).toBe("tutoring");
    expect(sessionScopeForCapability("teacher.question_paper.plan")).toBe("paper_gen");
    expect(sessionScopeForCapability("parent.child.summary")).toBe("parent_guidance");
    expect(sessionScopeForCapability("principal.school.health_brief")).toBe(
      "principal_analytics",
    );
    expect(sessionScopeForCapability("principal.analytics.brief")).toBeNull();
    expect(sessionScopeForCapability("teacher.question_paper.generate")).toBeNull();
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

describe("Teacher question paper plan", () => {
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
});

describe("Capability catalog", () => {
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
