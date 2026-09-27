/**
 * Screen capture under a plan (20261111000000): captures are counted a day.
 * The hook asks before it starts filming, and when the server refuses a frame
 * it stops the watch and drops the queue — every later frame would be refused.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const listeners = vi.hoisted(() => new Map<string, (e?: unknown) => unknown>());
const native = vi.hoisted(() => ({
  addListener: vi.fn(async (name: string, cb: (e?: unknown) => unknown) => {
    listeners.set(name, cb);
    return { remove: async () => {} };
  }),
  setAllowedPackages: vi.fn(async () => {}),
  hasUsageAccess: vi.fn(async () => ({ allowed: true })),
  canDrawOverlays: vi.fn(async () => ({ allowed: true })),
  requestOverlayPermission: vi.fn(async () => ({ allowed: true })),
  openUsageAccessSettings: vi.fn(async () => {}),
  showTapOverlay: vi.fn(async () => {}),
  hideTapOverlay: vi.fn(async () => {}),
  startWatchSession: vi.fn(async () => {}),
  stopWatchSession: vi.fn(async () => {}),
  getFunnelCounters: vi.fn(async () => ({})),
  captureOnce: vi.fn(async () => ({})),
}));
const submit = vi.hoisted(() => vi.fn());
const status = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/lib/screenCaptureMistake", () => ({ isNativeScreenCaptureAvailable: () => true, ScreenCaptureMistake: native }));
vi.mock("@/academic/services/screenCaptureService", () => ({
  submitScreenCaptureMistake: (...a: unknown[]) => submit(...a),
  deleteScreenCaptureQuestion: vi.fn(async () => true),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ eq: async () => ({ data: [{ package_name: "com.physicswallah.pw" }], error: null }) }) }) },
}));
vi.mock("@/lib/premium", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium")>()),
  fetchPremiumStatus: () => Promise.resolve(status.value),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), message: vi.fn(), success: vi.fn() } }));

const { useScreenCaptureMistakes } = await import("./useScreenCaptureMistakes");
const { planLimitFrom } = await import("@/lib/premium");

function withCaptures(d: Record<string, unknown>) {
  return {
    individual: true, enforced: true, sales_enabled: false, terms_version: "", tier: "standard", tier_rank: 2, tier_until: null,
    entitlements: [], tiers: [], products: [],
    features: [{ feature: "screen_capture.mistake", period: "day", limit: 10, applies: true, enforced: true, ...d }],
  };
}
const refusal = () => planLimitFrom({ error_code: "plan_limit", premium: { ok: false, feature: "screen_capture.mistake", reason: "limit_reached", limit: 10, period: "day" } })!;
const frame = { image_base64: "aaa", mime_type: "image/png", package_name: "com.physicswallah.pw" };

async function mounted() {
  const hook = renderHook(() => useScreenCaptureMistakes({ userId: "u1", examId: null, schoolId: null }));
  await waitFor(() => expect(listeners.has("watchFrameReady")).toBe(true));
  return hook;
}

beforeEach(() => {
  listeners.clear();
  submit.mockReset();
  Object.values(native).forEach((f) => f.mockClear());
});

describe("screen capture — the plan's captures", () => {
  it("a plan that refuses captures: the watch never starts", async () => {
    status.value = withCaptures({ ok: false, used: 10, remaining: 0, reason: "limit_reached" });
    const { result } = await mounted();
    await act(async () => { await result.current.startWatch(); });
    expect(native.startWatchSession).not.toHaveBeenCalled();
    expect(result.current.planLimit?.message).toBe("You've used today's 10 screen captures.");
  });

  it("a refused frame stops the watch and drops what is queued", async () => {
    status.value = withCaptures({ ok: true, used: 9, remaining: 1 });
    const { result } = await mounted();
    await act(async () => { await result.current.startWatch(); });
    expect(native.startWatchSession).toHaveBeenCalledTimes(1);
    let release!: () => void;
    submit.mockImplementationOnce(() => new Promise((res) => { release = () => res({ ok: false, error: refusal().message, planLimit: refusal() }); }));
    submit.mockResolvedValue({ ok: true, captured: true });
    await act(async () => {
      listeners.get("watchFrameReady")!(frame);
      listeners.get("watchFrameReady")!(frame); // queued behind the first
    });
    await act(async () => { release(); });
    await waitFor(() => expect(native.stopWatchSession).toHaveBeenCalledTimes(1));
    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.current.watching).toBe(false);
    expect(result.current.planLimit?.message).toBe("You've used today's 10 screen captures.");
  });

  it("CONTROL: an accepted frame keeps the watch running and the next frame goes up", async () => {
    status.value = withCaptures({ ok: true, used: 0, remaining: 10 });
    const { result } = await mounted();
    await act(async () => { await result.current.startWatch(); });
    submit.mockResolvedValue({ ok: true, captured: true });
    await act(async () => {
      listeners.get("watchFrameReady")!(frame);
      listeners.get("watchFrameReady")!(frame);
    });
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(native.stopWatchSession).not.toHaveBeenCalled();
    expect(result.current.watching).toBe(true);
    expect(result.current.planLimit).toBeNull();
  });
});
