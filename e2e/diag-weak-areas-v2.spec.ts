import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Diagnostic verifying Decision Engine Slice 1 (rpc_weak_areas_v2) end to
 * end, against real live data -- not just "did it not error."
 *
 * Strategy: force some wrong answers via Subject Practice, call
 * rpc_weak_areas_v2 directly (as an authenticated REST call, using the
 * browser's own session token), then for the first concept it returns,
 * independently re-read the raw concept_mastery row for that exact concept
 * and recompute understanding + evidence_strength in this test using the
 * same formulas the migration uses (simple ratio; Wilson score interval).
 * The RPC's values must match the independently-computed ones -- this is a
 * real cross-check of the SQL formulas, not a shape assertion.
 */

// Playwright's Node process doesn't auto-load .env the way Vite does for the
// app itself -- read it directly, same pattern as scripts/apply-seed.mjs's
// loadEnvFile helper.
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

async function optionButton(page: Page, letter: "A" | "B" | "C" | "D") {
  return page.getByText(letter, { exact: true }).locator("..");
}
function subjectChips(page: Page, labelText: string | RegExp) {
  return page.getByText(labelText).locator("..").locator("button");
}

/** Extracts the current Supabase access token from the page's own auth
 * storage -- the same token the app's own client uses for every request. */
async function getAccessToken(page: Page): Promise<string> {
  const token = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
    if (!key) return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try { return JSON.parse(raw)?.access_token ?? null; } catch { return null; }
  });
  if (!token) throw new Error("Could not find a Supabase access token in localStorage -- is the session authenticated?");
  return token;
}

async function callRpc(page: Page, name: string, body: Record<string, unknown> = {}) {
  const token = await getAccessToken(page);
  const res = await page.request.post(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: body,
  });
  return { status: res.status(), body: await res.text() };
}

async function readConceptMastery(page: Page, subject: string, chapter: string | null, concept: string, subconcept: string | null) {
  const token = await getAccessToken(page);
  const params = new URLSearchParams({
    select: "total_attempts,correct_attempts,confidence_score",
    subject: `eq.${subject}`,
    concept: `eq.${concept}`,
  });
  params.set("chapter", chapter ? `eq.${chapter}` : "is.null");
  params.set("subconcept", subconcept ? `eq.${subconcept}` : "is.null");
  const res = await page.request.get(`${SUPABASE_URL}/rest/v1/concept_mastery?${params.toString()}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  return { status: res.status(), body: await res.text() };
}

/** Wilson score interval confidence, mirrored exactly from
 * _dim_evidence_strength in 20260805050000_decision_engine_slice1_weak_areas.sql --
 * an independent re-implementation, not a call into the same code. */
function wilsonEvidenceStrength(correct: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.96;
  const p = correct / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  const width = Math.min(1, 2 * margin);
  return Math.round((1 - width) * 100 * 10) / 10;
}

test("diagnostic: rpc_weak_areas_v2 dimensions match independently-recomputed formulas", async ({ page }) => {
  test.setTimeout(120000);
  expect(SUPABASE_ANON_KEY, "VITE_SUPABASE_PUBLISHABLE_KEY not set -- check .env").not.toBe("");

  // Force several wrong answers -- we don't control which concept the seed
  // data assigns, we verify whichever ones come back from the policy.
  await page.goto("/student/practice");
  await expect(page.getByRole("button", { name: "Subject Practice" }).first()).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Subject Practice" }).first().click();
  await expect(page.getByText("Choose subject")).toBeVisible();
  await subjectChips(page, "Choose subject").first().click();
  const start = page.getByRole("button", { name: "Start Practice" });
  await expect(start).toBeEnabled({ timeout: 10000 });
  await start.click();
  await expect(page.getByText(/Q\d+ of/)).toBeVisible({ timeout: 30000 });

  const letters: Array<"A" | "B" | "C" | "D"> = ["D", "C", "B", "A"];
  for (let i = 0; i < 8; i++) {
    const letter = letters[i % letters.length];
    await (await optionButton(page, letter)).click();
    const nextBtn = page.getByRole("button", { name: /Next Question|See Results/ });
    await expect(nextBtn).toBeVisible({ timeout: 10000 });
    const isLast = (await nextBtn.textContent())?.includes("See Results") ?? false;
    await nextBtn.click();
    if (isLast) break;
    await expect(page.getByText(/Q\d+ of/)).toBeVisible({ timeout: 15000 });
  }
  await page.getByRole("button", { name: "End Session" }).click();
  await expect(page).toHaveURL(/\/student\/practice\/session\/.+\/result/, { timeout: 20000 });

  const direct = await callRpc(page, "rpc_weak_areas_v2");
  console.log(`rpc_weak_areas_v2: status=${direct.status}`);
  console.log(direct.body.slice(0, 3000));
  expect(direct.status, `rpc_weak_areas_v2 call failed: ${direct.body}`).toBe(200);

  const rows = JSON.parse(direct.body) as Array<{
    subject: string; chapter: string | null; concept: string; subconcept: string | null;
    understanding: number | null; evidence_strength: number | null;
    consistency: number | null; growth_trend: number | null; priority: number;
    reason: Record<string, number | null>;
  }>;

  console.log(`rpc_weak_areas_v2 returned ${rows.length} recommendation(s)`);
  expect(Array.isArray(rows)).toBe(true);

  for (const row of rows) {
    expect(row.evidence_strength ?? 0, `row for ${row.concept} has evidence_strength below the policy's own 30 threshold`).toBeGreaterThanOrEqual(30);
    expect(row.understanding ?? 100, `row for ${row.concept} has understanding at/above the policy's own 65 threshold`).toBeLessThan(65);
    // reason must be the structured object per the Decision Engine document's
    // explicit rule -- never a bare list -- and must match the top-level columns.
    expect(row.reason).toHaveProperty("understanding");
    expect(row.reason).toHaveProperty("evidence_strength");
    expect(row.reason.understanding).toBe(row.understanding);
    expect(row.reason.evidence_strength).toBe(row.evidence_strength);
  }

  for (let i = 1; i < rows.length; i++) {
    expect(rows[i - 1].priority, "rows are not sorted by priority DESC").toBeGreaterThanOrEqual(rows[i].priority);
  }

  if (rows.length > 0) {
    const target = rows[0];
    const cmRead = await readConceptMastery(page, target.subject, target.chapter, target.concept, target.subconcept);
    console.log(`Independent concept_mastery read: status=${cmRead.status} body=${cmRead.body}`);
    expect(cmRead.status).toBe(200);
    const cmRows = JSON.parse(cmRead.body) as Array<{ total_attempts: number; correct_attempts: number; confidence_score: number | null }>;
    expect(cmRows.length, "could not find the concept_mastery row for the RPC's own first result -- key mismatch between the policy and the raw table").toBeGreaterThan(0);

    const cm = cmRows[0];
    const expectedEvidenceStrength = wilsonEvidenceStrength(cm.correct_attempts, cm.total_attempts);
    const expectedUnderstanding = cm.confidence_score ?? Math.round((100 * cm.correct_attempts / cm.total_attempts) * 10) / 10;
    console.log(`Independently computed: evidence_strength=${expectedEvidenceStrength} (RPC said ${target.evidence_strength})`);
    console.log(`Independently computed: understanding=${expectedUnderstanding} (RPC said ${target.understanding})`);
    expect(Math.abs((target.evidence_strength ?? -999) - expectedEvidenceStrength), "evidence_strength diverges from independently-computed Wilson interval").toBeLessThan(0.2);
    expect(Math.abs((target.understanding ?? -999) - expectedUnderstanding), "understanding diverges from independently-computed ratio").toBeLessThan(0.2);
  }
});
