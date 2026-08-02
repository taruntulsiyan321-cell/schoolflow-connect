/**
 * Audit regression coverage for Gurukul AI hardening.
 */
import { describe, expect, it } from "vitest";
import { CAPABILITY_CATALOG, getCapability } from "./capabilityCatalog";
import type { AiActorRole } from "./envelope";
import { planRoute, wouldCallModel } from "./routerPolicy";
import {
  redactSessionForContext,
  SESSION_MEMORY_CAPABILITIES,
} from "./sessionMemory";

const VALID_ROLES: AiActorRole[] = [
  "student",
  "teacher",
  "parent",
  "principal",
  "admin",
];

const FLAGS_ON = {
  gatewayEnabled: true,
  deterministicEnabled: true,
  generativeEnabled: true,
};

describe("AI audit hardening", () => {
  it("AiActorRole and capability roles never include super_admin", () => {
    expect(VALID_ROLES.includes("super_admin" as AiActorRole)).toBe(false);
    for (const cap of Object.values(CAPABILITY_CATALOG)) {
      for (const role of cap.allowed_roles) {
        expect(VALID_ROLES).toContain(role);
        expect(role).not.toBe("super_admin");
      }
    }
  });

  it("every catalog capability is either never-model or optional/budget", () => {
    for (const cap of Object.values(CAPABILITY_CATALOG)) {
      expect(["never", "optional_explain", "required_when_budget"]).toContain(
        cap.model_policy,
      );
    }
  });

  it("deterministic never-policy caps never plan a model call", () => {
    for (const [id, cap] of Object.entries(CAPABILITY_CATALOG)) {
      if (cap.model_policy !== "never") continue;
      expect(wouldCallModel(id, FLAGS_ON)).toBe(false);
      const plan = planRoute(id, FLAGS_ON);
      if ("rejected" in plan) continue;
      expect(plan.may_call_model).toBe(false);
    }
  });

  it("recommendation + grounded_retrieval respect deterministic kill switch", () => {
    const off = {
      gatewayEnabled: true,
      deterministicEnabled: false,
      generativeEnabled: true,
    };
    for (const id of ["student.recommendation.next", "student.knowledge.retrieve"]) {
      const plan = planRoute(id, off);
      expect("rejected" in plan && plan.rejected).toBe(true);
      if ("rejected" in plan) {
        expect(plan.error_code).toBe("deterministic_disabled");
      }
    }
  });

  it("student.image_doubt remains registered (router must not fall through)", () => {
    const cap = getCapability("student.image_doubt");
    expect(cap?.route_class).toBe("multimodal");
    expect(cap?.model_policy).toBe("optional_explain");
  });

  it("session memory allowlist matches catalog only (no orphans)", () => {
    for (const id of Object.keys(SESSION_MEMORY_CAPABILITIES)) {
      expect(getCapability(id)).not.toBeNull();
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
});
