/**
 * The Plans screen sells only when it may, and only what it may.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  status: null as unknown,
  native: false,
  legalComplete: true,
}));

vi.mock("@/hooks/usePremiumStatus", () => ({
  usePremiumStatus: () => ({ status: state.status, loading: false, error: null, reload: vi.fn() }),
  premiumChanged: vi.fn(),
}));
vi.mock("@/gurukul/StudentContext", () => ({ useGurukulStudent: () => ({ name: "Riya Verma" }) }));
vi.mock("@/lib/legal", async (orig) => ({
  ...(await orig<typeof import("@/lib/legal")>()),
  legalEntityComplete: () => state.legalComplete,
}));
vi.mock("@/lib/premium", async (orig) => ({
  ...(await orig<typeof import("@/lib/premium")>()),
  canBuyInThisApp: () => !state.native,
  fetchMyOrders: () => Promise.resolve([]),
  buyPlan: vi.fn(),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => state.native } }));

const { default: Premium } = await import("./Premium");
const { LEGAL_VERSION } = await import("@/lib/legal");

const TIERS = [
  { code: "free", rank: 0, display_name: "Free", limits: [{ feature: "practice.question", period: "day", limit: 20 }, { feature: "nova.message", period: "day", limit: 5 }] },
  { code: "starter", rank: 1, display_name: "Starter", limits: [{ feature: "practice.question", period: "day", limit: null }, { feature: "analysis.topic", period: "none", limit: null }] },
  { code: "standard", rank: 2, display_name: "Standard", limits: [{ feature: "practice.question", period: "day", limit: null }] },
  { code: "premium", rank: 3, display_name: "Premium", limits: [{ feature: "practice.question", period: "day", limit: null }] },
];
const PRODUCTS = [
  { code: "starter_30d", tier: "starter", amount_paise: 19900, currency: "INR", validity_days: 30, display_name: "Starter — 30 days" },
  { code: "standard_30d", tier: "standard", amount_paise: 49900, currency: "INR", validity_days: 30, display_name: "Standard — 30 days" },
  { code: "premium_30d", tier: "premium", amount_paise: 99900, currency: "INR", validity_days: 30, display_name: "Premium — 30 days" },
];

function individual(over: Record<string, unknown> = {}) {
  return {
    individual: true,
    enforced: true,
    sales_enabled: true,
    terms_version: LEGAL_VERSION,
    tier: "free",
    tier_rank: 0,
    tier_until: null,
    entitlements: [],
    features: [{ ok: true, feature: "practice.question", period: "day", limit: 20, used: 7, remaining: 13 }],
    tiers: TIERS,
    products: PRODUCTS,
    ...over,
  };
}

const show = () => render(<MemoryRouter><Premium /></MemoryRouter>);
const buyButtons = () => screen.queryAllByRole("button").filter((b) => /^(Buy|Upgrade|Add \d+ days|You have)/.test(b.textContent ?? ""));

beforeEach(() => {
  state.native = false;
  state.legalComplete = true;
  state.status = individual();
});

describe("the Plans screen", () => {
  it("tells a school's student plans do not apply to them, and sells nothing", () => {
    state.status = { individual: false };
    show();
    expect(screen.getByText(/Plans are for individual exam accounts/)).toBeTruthy();
    expect(buyButtons()).toHaveLength(0);
  });

  it("shows today's usage from the server and the price, GST included, for 30 days", () => {
    show();
    expect(screen.getByText("7 of 20 a day")).toBeTruthy();
    expect(screen.getAllByText("₹199").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/for 30 days · GST included · one-time payment/).length).toBe(3);
  });

  it("keeps every buy button off until both the terms and the 18+/guardian box are ticked", () => {
    show();
    expect(buyButtons().every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByLabelText(/I have read and accept/));
    expect(buyButtons().every((b) => (b as HTMLButtonElement).disabled)).toBe(true);
    fireEvent.click(screen.getByLabelText(/I am 18 or older/));
    expect(buyButtons().every((b) => !(b as HTMLButtonElement).disabled)).toBe(true);
  });

  it("will not sell a lower plan over a higher one, and says why", () => {
    state.status = individual({ tier: "standard", tier_rank: 2, tier_until: "2026-10-27T00:00:00Z" });
    show();
    fireEvent.click(screen.getByLabelText(/I have read and accept/));
    fireEvent.click(screen.getByLabelText(/I am 18 or older/));
    const starter = buyButtons().find((b) => /You have Standard until/.test(b.textContent ?? ""))!;
    expect((starter as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Add 30 days")).toBeTruthy();
    expect(screen.getByText("Upgrade to Premium")).toBeTruthy();
  });

  it("sells nothing while sales are closed, the legal details are missing, or the terms on screen are not the accepted ones", () => {
    state.status = individual({ sales_enabled: false });
    const a = show();
    expect(buyButtons()).toHaveLength(0);
    expect(screen.getByText("Plans open for purchase soon.")).toBeTruthy();
    a.unmount();

    state.status = individual();
    state.legalComplete = false;
    const b = show();
    expect(buyButtons()).toHaveLength(0);
    b.unmount();

    state.legalComplete = true;
    state.status = individual({ terms_version: "some-older-version" });
    show();
    expect(buyButtons()).toHaveLength(0);
    expect(screen.getByText(/Our terms are being updated/)).toBeTruthy();
  });

  it("in the Android app shows the plan but no price and no way to buy", () => {
    state.native = true;
    show();
    expect(screen.getByText("Your plan")).toBeTruthy();
    expect(screen.queryByText(/₹/)).toBeNull();
    expect(buyButtons()).toHaveLength(0);
    expect(screen.queryByText(/One-time payments/)).toBeNull();
  });

  it("says so while plans are not enforced", () => {
    state.status = individual({ enforced: false });
    show();
    expect(screen.getByText(/everything in Gurukul is open to you for now/)).toBeTruthy();
  });
});
