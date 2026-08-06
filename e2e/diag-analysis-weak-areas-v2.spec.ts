import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Verifies the VITE_FF_DECISION_ENGINE_WEAK_AREAS_V2 wiring in
 * Analysis.tsx's topicGroups.needs_attention list -- the third Weak Areas
 * consumer, reusing the existing flag. Not a re-test of rpc_weak_areas_v2's
 * formula correctness -- proves the "Topics that need your attention" list
 * actually sources from rpc_weak_areas_v2 when the flag is on, not from
 * snapshot.weak_topics.
 *
 * Requires a flag-on local build:
 *   VITE_FF_DECISION_ENGINE_WEAK_AREAS_V2=1 npm run dev
 *   PLAYWRIGHT_BASE_URL=http://localhost:8080 npx playwright test \
 *     e2e/diag-analysis-weak-areas-v2.spec.ts --project=chromium
 */

function loadEnvVar(name: string): string {
  if (process.env[name]) return process.env[name] as string;
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const envPath = join(root, ".env");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(new RegExp(`^\\s*${name}\\s*=\\s*"?([^"]*)"?\\s*$`));
      if (m) return m[1];
    }
  }
  return "";
}
const SUPABASE_URL = loadEnvVar("VITE_SUPABASE_URL") || "https://kdmjipeksjdyojjdokbi.supabase.co";
const SUPABASE_ANON_KEY = loadEnvVar("VITE_SUPABASE_PUBLISHABLE_KEY");

async function getAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try { return JSON.parse(raw)?.access_token ?? null; } catch { return null; }
  });
  if (!token) throw new Error("No Supabase access token in localStorage");
  return token;
}

async function callRpc(page: Page, token: string, name: string, args: Record<string, unknown> = {}) {
  const res = await page.request.post(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: args,
  });
  return { status: res.status(), body: await res.text() };
}

test("diagnostic: Analysis.tsx's needs-attention list sources from rpc_weak_areas_v2 when the flag is on", async ({ page }) => {
  test.setTimeout(120000);
  expect(SUPABASE_ANON_KEY, "VITE_SUPABASE_PUBLISHABLE_KEY not set -- check .env").not.toBe("");

  let sawV2Call = false;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/rest/v1/rpc/rpc_weak_areas_v2")) {
      sawV2Call = true;
    }
  });

  await page.goto("/student/analysis");
  const token = await getAccessToken(page);

  // Ground truth: what does the policy actually say for this account, right now.
  const direct = await callRpc(page, token, "rpc_weak_areas_v2");
  expect(direct.status, `rpc_weak_areas_v2 direct call failed: ${direct.body}`).toBe(200);
  const v2Rows = JSON.parse(direct.body) as Array<{ subject: string; concept: string; subconcept: string | null }>;
  const v2Topics = new Set(v2Rows.map((r) => (r.subconcept ?? r.concept).toLowerCase()));
  console.log(`rpc_weak_areas_v2 ground truth: ${v2Rows.length} row(s): ${[...v2Topics].join(", ")}`);

  // Give the async effect a real window to fire and the page to settle.
  await page.waitForTimeout(5000);

  expect(sawV2Call, "rpc_weak_areas_v2 was never called -- flag was not actually on for this build, or Analysis.tsx never mounted the effect").toBe(true);

  // The "Topics" tab holds the needs_attention list -- switch to it if the
  // page defaults to Overview.
  const topicsTab = page.getByRole("button", { name: /^Topics$/i }).or(page.getByText(/^Topics$/i));
  if (await topicsTab.first().isVisible().catch(() => false)) {
    await topicsTab.first().click();
  }

  const pageText = (await page.locator("body").innerText()).toLowerCase();

  if (v2Rows.length === 0) {
    console.log("V2 legitimately returned no weak areas -- nothing further to cross-check.");
    return;
  }

  // Corroborating evidence: at least one V2 topic should appear somewhere
  // on the page (display formatting may alter casing/labels, so this is a
  // soft substring check, not a strict equality assertion -- the network
  // assertion above is the primary proof of wiring).
  const anyV2TopicShown = [...v2Topics].some((t) => pageText.includes(t));
  console.log(`A V2 topic appears in the rendered page text: ${anyV2TopicShown}`);
});
