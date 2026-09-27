/**
 * The two services that call their edge function directly (uploads can outlast
 * invokeEdgeFunction's timeout) read a failure the same way it does: a plan
 * refusal becomes a PlanLimit, and any other failure keeps the function's own
 * words instead of "Edge Function returned a non-2xx status code".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invoke(...a) } } }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

const { submitScreenCaptureMistake } = await import("./screenCaptureService");
const { StudentUploadService } = await import("./studentUploadService");

/** What supabase-js hands back for a non-2xx: a FunctionsHttpError with the Response in context. */
function httpError(status: number, body: unknown) {
  return {
    data: null,
    error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      name: "FunctionsHttpError",
      context: new Response(JSON.stringify(body), { status }),
    }),
  };
}
const capture = () => submitScreenCaptureMistake({ image_base64: "aaa", package_name: "com.physicswallah.pw" });
const ctx = { schoolId: "s", userId: "u", role: "student", studentId: "st" } as never;

beforeEach(() => invoke.mockReset());

describe("screen capture", () => {
  it("a 402 plan refusal carries the plan's notice", async () => {
    invoke.mockResolvedValue(httpError(402, { error: "…", error_code: "plan_limit", premium: { ok: false, feature: "screen_capture.mistake", reason: "limit_reached", limit: 10, period: "day" } }));
    const r = await capture();
    expect(r.ok).toBe(false);
    expect(r.planLimit?.message).toBe("You've used today's 10 screen captures.");
    expect(r.error).toBe("You've used today's 10 screen captures.");
  });

  it("CONTROL: any other failure is not a plan refusal, and keeps the function's words", async () => {
    invoke.mockResolvedValue(httpError(503, { error: "Plans could not be checked. Please try again.", error_code: "premium_unavailable" }));
    const r = await capture();
    expect(r.planLimit).toBeUndefined();
    expect(r.error).toBe("Plans could not be checked. Please try again.");
  });
});

describe("Custom Practice classification", () => {
  it("a 402 plan refusal carries the plan's notice", async () => {
    invoke.mockResolvedValue(httpError(402, { error: "…", error_code: "plan_limit", premium: { ok: false, feature: "custom_practice.upload", reason: "not_in_plan" } }));
    const r = await StudentUploadService.requestClassify(ctx, "up-1");
    expect(r.ok).toBe(false);
    expect(r.planLimit?.message).toBe("Custom Practice uploads are not in your plan.");
  });

  it("CONTROL: any other failure keeps the function's words", async () => {
    invoke.mockResolvedValue(httpError(500, { error: "Upload not found" }));
    const r = await StudentUploadService.requestClassify(ctx, "up-1");
    expect(r.planLimit).toBeUndefined();
    expect(r.error).toBe("Upload not found");
  });
});
