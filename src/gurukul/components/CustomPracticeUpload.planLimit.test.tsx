/**
 * Custom Practice under a plan (20261111000000): uploads are in the paid plans
 * and counted a month. The screen reads the allowance before any file is sent
 * to storage, and stops at the first refusal instead of uploading the rest to
 * be refused one by one.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const create = vi.fn();
const requestClassify = vi.fn();
const status = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/academic", () => {
  const value = { ctx: { schoolId: "s", userId: "u", role: "student", studentId: "st" }, ready: true };
  return { useAcademicContext: () => value };
});
vi.mock("@/academic/services/studentUploadService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/academic/services/studentUploadService")>();
  return {
    ...actual,
    StudentUploadService: {
      listMine: async () => [],
      create: (...a: unknown[]) => create(...a),
      requestClassify: (...a: unknown[]) => requestClassify(...a),
    },
  };
});
vi.mock("@/lib/premium", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium")>()),
  fetchPremiumStatus: () => Promise.resolve(status.value),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (m: string) => toastError(m), message: vi.fn(), success: vi.fn() } }));

const { CustomPracticeUpload } = await import("./CustomPracticeUpload");
const { planLimitFrom } = await import("@/lib/premium");

function withUploads(d: Record<string, unknown>) {
  return {
    individual: true, enforced: true, sales_enabled: false, terms_version: "", tier: "starter", tier_rank: 1, tier_until: null,
    entitlements: [], tiers: [], products: [],
    features: [{ feature: "custom_practice.upload", period: "month", limit: 5, applies: true, enforced: true, ...d }],
  };
}
const file = (name: string) => new File(["x"], name, { type: "image/png" });

async function show() {
  render(<MemoryRouter><CustomPracticeUpload accentColor="#123456" onSelectMode={() => {}} /></MemoryRouter>);
  await act(async () => {});
}
async function pick(...names: string[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => { fireEvent.change(input, { target: { files: names.map(file) } }); });
}
const uploadButton = () => screen.getByRole("button", { name: /Upload PDF or images/ });

beforeEach(() => {
  create.mockReset();
  requestClassify.mockReset();
  toastError.mockReset();
});

describe("Custom Practice — the plan's uploads", () => {
  it("a plan without it: the notice shows and the upload button is off", async () => {
    status.value = withUploads({ ok: false, limit: null, period: "none", reason: "not_in_plan", used: 0, remaining: 0 });
    await show();
    expect(screen.getByRole("status").textContent).toContain("Custom Practice uploads are not in your plan.");
    expect(uploadButton()).toHaveProperty("disabled", true);
  });

  it("used up since the screen opened: the files are not sent, and the notice shows", async () => {
    status.value = withUploads({ ok: true, used: 4, remaining: 1 });
    await show();
    expect(screen.queryByRole("status")).toBeNull();
    status.value = withUploads({ ok: false, used: 5, remaining: 0, reason: "limit_reached" });
    await pick("a.png");
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("You've used this month's 5 Custom Practice uploads.");
  });

  it("more files than uploads left: nothing is sent to storage", async () => {
    status.value = withUploads({ ok: true, used: 3, remaining: 2 });
    await show();
    await pick("a.png", "b.png", "c.png");
    expect(create).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith("2 Custom Practice uploads left this month on your plan. Choose 2 files or fewer.");
  });

  it("a refusal at classification stops the rest and shows the notice", async () => {
    status.value = withUploads({ ok: true, used: 0, remaining: 5 });
    create.mockResolvedValue([{ id: "r1" }, { id: "r2" }].map((r) => ({ ...r, status: "pending", original_filename: `${r.id}.png`, verdict: null })));
    const refusal = planLimitFrom({ error_code: "plan_limit", premium: { ok: false, feature: "custom_practice.upload", reason: "limit_reached", limit: 5, period: "month" } })!;
    requestClassify.mockResolvedValueOnce({ ok: false, error: refusal.message, planLimit: refusal });
    await show();
    await pick("a.png", "b.png");
    expect(requestClassify).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status").textContent).toContain("You've used this month's 5 Custom Practice uploads.");
  });

  it("CONTROL: with uploads left, every file is classified and no notice shows", async () => {
    status.value = withUploads({ ok: true, used: 0, remaining: 5 });
    create.mockResolvedValue([{ id: "r1" }, { id: "r2" }].map((r) => ({ ...r, status: "pending", original_filename: `${r.id}.png`, verdict: null })));
    requestClassify.mockResolvedValue({ ok: true });
    await show();
    await pick("a.png", "b.png");
    expect(create).toHaveBeenCalledTimes(1);
    expect(requestClassify).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("status")).toBeNull();
  });
});
