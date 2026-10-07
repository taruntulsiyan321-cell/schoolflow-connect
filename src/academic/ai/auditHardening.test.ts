/**
 * Audit regression coverage for Gurukul AI hardening — against the catalogue
 * and session memory ai-gateway runs.
 */
import { describe, expect, it } from "vitest";
import {
  getCapability,
  type AiActorRole,
} from "../../../supabase/functions/_shared/capabilityCatalog.ts";
import {
  redactSessionForContext,
  sessionScopeForCapability,
  buildSessionSummaryPatch,
} from "../../../supabase/functions/_shared/sessionMemory.ts";
import { edgeCapabilityIds, edgeSessionMemoryIds } from "@/test/edgeRegistries";

const VALID_ROLES: AiActorRole[] = [
  "student",
  "teacher",
  "parent",
  "principal",
  "admin",
];

/** Every catalogue entry, each proved against the module's own lookup. */
function catalogue() {
  return edgeCapabilityIds().map((id) => {
    const cap = getCapability(id);
    expect(cap, id).not.toBeNull();
    expect(cap!.feature_id).toBe(id);
    return cap!;
  });
}

describe("AI audit hardening", () => {
  it("AiActorRole and capability roles never include super_admin", () => {
    expect(VALID_ROLES.includes("super_admin" as AiActorRole)).toBe(false);
    for (const cap of catalogue()) {
      for (const role of cap.allowed_roles) {
        expect(VALID_ROLES).toContain(role);
        expect(role).not.toBe("super_admin");
      }
    }
  });

  it("every catalog capability is either never-model or optional/budget", () => {
    for (const cap of catalogue()) {
      expect(["never", "optional_explain", "required_when_budget"]).toContain(
        cap.model_policy,
      );
    }
  });

  it("student.image_doubt remains registered (router must not fall through)", () => {
    const cap = getCapability("student.image_doubt");
    expect(cap?.route_class).toBe("multimodal");
    expect(cap?.model_policy).toBe("optional_explain");
  });

  it("session memory allowlist matches catalog only (no orphans)", () => {
    for (const id of edgeSessionMemoryIds()) {
      expect(sessionScopeForCapability(id), id).not.toBeNull();
      expect(getCapability(id), id).not.toBeNull();
    }
  });

  it("redactSessionForContext strips outline/paper bodies from flags", () => {
    const redacted = redactSessionForContext({
      session_id: "s1",
      workflow_scope: "paper_gen",
      status: "active",
      turn_count: 1,
      summary: {
        flags: {
          plan_hash: "abc",
          outline_text: "HUGE OUTLINE BODY",
          marking_scheme_text: "MARKING",
          full_paper: "PAPER",
          keep_me: true,
        },
      },
    });
    expect(redacted?.flags).toEqual({ plan_hash: "abc", keep_me: true });
    expect(JSON.stringify(redacted)).not.toMatch(/HUGE OUTLINE|MARKING|PAPER/);
  });

  it("redaction strips outline but raw summary retains it for marking scheme", () => {
    const session = {
      session_id: "s1",
      workflow_scope: "paper_gen" as const,
      status: "active" as const,
      turn_count: 2,
      summary: {
        flags: {
          outline_ready: true,
          outline_text: "Section A — 20 marks",
          plan_hash: "ph1",
        },
      },
    };
    const redacted = redactSessionForContext(session);
    expect((redacted?.flags as Record<string, unknown>)?.outline_text).toBeUndefined();
    expect(session.summary.flags.outline_text).toBe("Section A — 20 marks");
  });

  it("session_patch from outline includes outline_text for persistence", () => {
    const patch = buildSessionSummaryPatch({
      last_feature_id: "teacher.question_paper.generate_outline",
      last_decision: "answered_model",
      plan_hash: "abc",
      flags: {
        outline_ready: true,
        outline_text: "Q1 short answer",
        plan_hash: "abc",
      },
    });
    expect((patch.flags as Record<string, unknown>).outline_text).toBe("Q1 short answer");
  });
});
