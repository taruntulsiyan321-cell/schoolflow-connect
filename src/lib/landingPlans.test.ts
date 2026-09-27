/**
 * The landing page's plans (public/landing.html, #gurukul-plans) are read
 * from the database and worded like the app. This runs that block — it is
 * plain JavaScript in a static page, so it cannot import src/lib/premium.ts —
 * and pins it to the app's own functions.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const app = await import("./premium");
const { injectLandingConfig } = (await import("../../scripts/landing-config.mjs")) as {
  injectLandingConfig: (html: string, c: { url?: string; key?: string }) => { html: string; injected: boolean };
};

const LANDING = readFileSync(join(__dirname, "../../public/landing.html"), "utf8");

type Plans = {
  load: () => Promise<unknown>;
  buildPlans: (t: unknown[], l: unknown[], p: unknown[]) => { code: string; name: string; price: { amount: string; days: number } | null; rows: { feature: string; label: string; value: string | null }[] }[];
  describeAllowance: (period: string, limit: number | null) => string;
  formatRupees: (paise: number) => string;
  FEATURE_LABELS: Record<string, string>;
  FEATURE_ORDER: string[];
};

function plansFrom(html: string, fetchImpl: unknown = () => Promise.reject(new Error("no fetch"))): Plans {
  const m = html.match(/<script id="gurukul-plans">([\s\S]*?)<\/script>/);
  if (!m) throw new Error("#gurukul-plans is missing from the landing page");
  const win = {} as { GurukulPlans: Plans };
  new Function("window", "fetch", m[1])(win, fetchImpl);
  return win.GurukulPlans;
}

// The live catalog's shape (20261111000000 / 20261114000000), plus a paid
// tier with nothing on sale, which must not be advertised.
const TIERS = [
  { code: "premium", rank: 3, display_name: "Premium" },
  { code: "free", rank: 0, display_name: "Free" },
  { code: "starter", rank: 1, display_name: "Starter" },
  { code: "standard", rank: 2, display_name: "Standard" },
  { code: "legacy", rank: 4, display_name: "Legacy" },
];
const LIMITS = [
  { tier_code: "free", feature_code: "practice.question", period: "day", max_uses: 20 },
  { tier_code: "free", feature_code: "nova.message", period: "day", max_uses: 5 },
  { tier_code: "starter", feature_code: "practice.question", period: "day", max_uses: null },
  { tier_code: "starter", feature_code: "analysis.topic", period: "none", max_uses: null },
  { tier_code: "premium", feature_code: "screen_capture.mistake", period: "day", max_uses: null },
];
const PRODUCTS = [
  { tier_code: "starter", amount_paise: 19900, currency: "INR", validity_days: 30 },
  { tier_code: "standard", amount_paise: 49900, currency: "INR", validity_days: 30 },
  { tier_code: "premium", amount_paise: 99900, currency: "INR", validity_days: 30 },
];

describe("the landing page's plans", () => {
  const plans = plansFrom(LANDING);

  it("name every feature as the app does, in the app's order", () => {
    expect(plans.FEATURE_LABELS).toEqual(app.FEATURE_NAMES);
    expect(plans.FEATURE_ORDER).toEqual(app.FEATURE_ORDER);
  });

  it("describe an allowance and a price exactly as the app does", () => {
    for (const period of ["none", "day", "month", "lifetime"] as const) {
      for (const limit of [null, 0, 1, 5, 100]) {
        expect(plans.describeAllowance(period, limit)).toBe(app.describeAllowance(period, limit));
      }
    }
    for (const paise of [0, 100, 19900, 19950, 49900, 99900, 123456700]) {
      expect(plans.formatRupees(paise)).toBe(app.formatRupees(paise));
    }
  });

  it("show Free and each plan on sale, in rank order, with what each includes", () => {
    const out = plans.buildPlans(TIERS, LIMITS, PRODUCTS);
    expect(out.map((p) => p.code)).toEqual(["free", "starter", "standard", "premium"]);
    expect(out[0].price).toBeNull();
    expect(out[1].price).toEqual({ amount: "₹199", days: 30 });
    const row = (i: number, f: string) => out[i].rows.find((r) => r.feature === f)!.value;
    expect(row(0, "practice.question")).toBe("20 a day");
    expect(row(0, "analysis.topic")).toBeNull(); // not in the plan
    expect(row(1, "practice.question")).toBe("Unlimited");
    expect(row(1, "analysis.topic")).toBe("Included");
    expect(row(3, "screen_capture.mistake")).toBe("Unlimited");
  });

  it("carry no price of their own anywhere on the page", () => {
    const outsideTheReader = LANDING.replace(/<script id="gurukul-plans">[\s\S]*?<\/script>/, "");
    // CONTROL: the pattern finds a price when there is one.
    expect(/₹\s?\d/.test("price: '₹199'")).toBe(true);
    expect(outsideTheReader).not.toMatch(/₹\s?\d/);
    expect(outsideTheReader).not.toMatch(/\/mo\b/);
    expect(outsideTheReader).not.toMatch(/unlimited usage|no cap/i);
  });

  it("name no price at all until the build has written in the project", async () => {
    await expect(plans.load()).rejects.toThrow(/not configured/);
  });

  it("once built, read the three public tables with the publishable key", async () => {
    const { html, injected } = injectLandingConfig(LANDING, { url: "https://abc.supabase.co/", key: "sb_publishable_TEST" });
    expect(injected).toBe(true);
    const bodies: Record<string, unknown> = { premium_tiers: TIERS, premium_limits: LIMITS, premium_products: PRODUCTS };
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => bodies[url.split("/rest/v1/")[1].split("?")[0]],
    }));
    const built = plansFrom(html, fetchMock);
    const out = (await built.load()) as { code: string }[];
    expect(out.map((p) => p.code)).toEqual(["free", "starter", "standard", "premium"]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [url, init] = fetchMock.mock.calls[2] as unknown as [string, { headers: Record<string, string> }];
    expect(url).toBe("https://abc.supabase.co/rest/v1/premium_products?select=tier_code,amount_paise,currency,validity_days&is_active=eq.true");
    expect(init.headers).toEqual({ apikey: "sb_publishable_TEST", Authorization: "Bearer sb_publishable_TEST" });
  });

  it("the build writes in only a plain URL and key", () => {
    expect(injectLandingConfig(LANDING, { url: undefined, key: undefined }).injected).toBe(false);
    expect(injectLandingConfig(LANDING, { url: "https://abc.supabase.co", key: 'x";alert(1);"' }).injected).toBe(false);
    expect(injectLandingConfig(LANDING, { url: "http://abc.supabase.co", key: "k" }).injected).toBe(false);
    expect(() => injectLandingConfig("<html></html>", { url: "https://a.b", key: "k" })).toThrow(/placeholders/);
  });
});
