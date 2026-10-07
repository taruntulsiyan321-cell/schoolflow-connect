/**
 * Phase 3 — OCR pipeline and Failure Recovery, against the edge modules the
 * deployed functions run. Their private helpers are reached through the
 * exported function that calls them.
 */

import { describe, expect, it } from "vitest";
import { runImageDoubtSubmit } from "../../../supabase/functions/_shared/multimodalPipeline.ts";
import {
  planFailureRecovery,
  withRetry,
} from "../../../supabase/functions/_shared/failureRecovery.ts";
import { getCapability } from "../../../supabase/functions/_shared/capabilityCatalog.ts";
import { getBuiltinPrompt } from "../../../supabase/functions/_shared/promptLibrary.ts";

describe("OCR / Multimodal pipeline v0", () => {
  it("rejects invalid image metadata", () => {
    const bad = runImageDoubtSubmit({ mime: "application/pdf", bytes: 10 });
    expect(bad.status).toBe("rejected");
    expect(bad.checkpoints[0]).toMatchObject({ step_id: "validate_media", ok: false });
  });

  it("accepts jpeg metadata bounds", () => {
    const ok = runImageDoubtSubmit(
      { mime: "image/jpeg", bytes: 1200, width: 800, height: 600 },
      { providerConfigured: false },
    );
    expect(ok.status).not.toBe("rejected");
    expect(ok.checkpoints[0]).toMatchObject({ step_id: "validate_media", ok: true });
  });

  it("clarifies when OCR provider is not configured (never invents OCR text)", () => {
    const result = runImageDoubtSubmit(
      { mime: "image/jpeg", bytes: 2000, width: 640, height: 480 },
      { env: {} },
    );
    expect(result.status).toBe("clarify");
    expect(result.stop_reason).toBe("ocr_not_configured");
    expect(result.ocr_text).toBeNull();
    expect(result.normalised_question_text).toBeNull();
  });

});

describe("Prompt Library builtins", () => {
  it("keeps builtin production prompts loadable", () => {
    expect(getBuiltinPrompt("student.performance.explain")?.status).toBe("production");
  });
});

describe("Enterprise Failure Recovery", () => {
  const classOf = (error: string) => planFailureRecovery({ error, attempt: 1 }).failure_class;

  it("classifies transient vs permanent provider errors", () => {
    expect(classOf("OpenRouter error 429: rate limit")).toBe("provider_transient");
    expect(classOf("timeout waiting")).toBe("provider_transient");
    expect(classOf("OPENROUTER_API_KEY not configured")).toBe("provider_permanent");
    expect(classOf("401 unauthorized")).toBe("provider_permanent");
  });

  it("retries only transient/unknown within policy", () => {
    expect(planFailureRecovery({ error: "503", attempt: 1 }).next_stage).toBe("retry");
    expect(planFailureRecovery({ error: "401", attempt: 1 }).retryable).toBe(false);
    expect(planFailureRecovery({ error: "503", attempt: 3 }).retryable).toBe(false);
  });

  it("backs off exponentially between attempts, with jitter on top", async () => {
    const waits = async (random: () => number) => {
      const slept: number[] = [];
      await withRetry(
        async () => {
          throw new Error("503 timeout");
        },
        { sleep: async (ms) => void slept.push(ms), random },
      );
      return slept;
    };
    expect(await waits(() => 0)).toEqual([200, 400]); // base 200 * 2^(attempt-1)
    const jittered = await waits(() => 1);
    expect(jittered).toHaveLength(2);
    expect(jittered[0]).toBeGreaterThan(200);
    expect(jittered[1]).toBeGreaterThan(400);
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

describe("Image doubt capability", () => {
  it("catalog lists multimodal image doubt capability", () => {
    const cap = getCapability("student.image_doubt");
    expect(cap?.route_class).toBe("multimodal");
    expect(cap?.allowed_roles).toContain("student");
    expect(cap?.allowed_roles).not.toContain("super_admin");
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
