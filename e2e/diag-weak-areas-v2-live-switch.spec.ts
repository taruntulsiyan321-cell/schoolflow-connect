import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Verifies the VITE_FF_DECISION_ENGINE_WEAK_AREAS_V2 wiring in
 * PracticeService.listWeakConcepts -- not formula correctness (that's
 * already proven by diag-weak-areas-v2.spec.ts), but that flipping the flag
 * on actually makes Practice.tsx's "Weak Areas Practice" mode call
 * rpc_weak_areas_v2, and that the legacy concept_mastery query does NOT
 * also fire -- exactly one implementation must execute, not both.
 *
 * IMPORTANT -- this only proves anything against a build that was actually
 * compiled with the flag on. playwright.config.ts points at the live
 * deployed site by default, and VITE_FF_* is resolved at Vite BUILD time,
 * so this diagnostic is useless run against the default baseURL. Run it
 * like:
 *
 *   VITE_FF_DECISION_ENGINE_WEAK_AREAS_V2=1 npm run dev
 *   PLAYWRIGHT_BASE_URL=http://localhost:8080 npx playwright test \
 *     e2e/diag-weak-areas-v2-live-switch.spec.ts --project=chromium
 *
 * Not part of any default suite/CI gate, same as diag-weak-areas-v2.spec.ts.
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

async function callRpc(page: Page, token: string, name: string, body: Record<string, unknown> = {}) {
  const res = await page.request.post(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: body,
  });
  return { status: res.status(), body: await res.text() };
}

async function optionButton(page: Page, letter: "A" | "B" | "C" | "D") {
  return page.getByText(letter, { exact: true }).locator("..");
}

/** Wilson score interval, mirrored from _dim_evidence_strength -- same
 * reimplementation diag-weak-areas-v2.spec.ts already validated. */
function wilsonEvidenceStrength(correct: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.96;
  const p = correct / n;
  const denom = 1 + (z * z) / n;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  const width = Math.min(1, 2 * margin);
  return Math.round((1 - width) * 100 * 10) / 10;
}

test("diagnostic: flag-on Weak Areas Practice actually calls rpc_weak_areas_v2, not the legacy query", async ({ page }) => {
  test.setTimeout(120000);
  expect(SUPABASE_ANON_KEY, "VITE_SUPABASE_PUBLISHABLE_KEY not set -- check .env").not.toBe("");

  let sawV2Call = false;
  let sawLegacyCall = false;
  const recordBankQuestionIds: string[] = [];

  page.on("request", (req) => {
    const url = req.url();
    if (req.method() === "POST" && url.includes("/rest/v1/rpc/rpc_weak_areas_v2")) {
      sawV2Call = true;
    }
    // The legacy "simple" path's exact filter: .eq("classification", "weak")
    // on concept_mastery, ordered by confidence_score.
    if (
      req.method() === "GET" &&
      url.includes("/rest/v1/concept_mastery") &&
      url.includes("classification=eq.weak")
    ) {
      sawLegacyCall = true;
    }
    if (req.method() === "POST" && url.includes("/rest/v1/rpc/rpc_record_question_attempt")) {
      try {
        const data = req.postDataJSON() as { _bank_question_id?: string };
        if (data._bank_question_id) recordBankQuestionIds.push(data._bank_question_id);
      } catch {
        // non-JSON body, ignore
      }
    }
  });

  // Deep-link straight into the instant "weak" mode -- Practice.tsx's own
  // ?mode=weak handler (handleMode) skips the config step and starts the
  // session immediately, so there's no button to click first.
  await page.goto("/student/practice?mode=weak");

  const token = await getAccessToken(page);

  // Ground truth: what does the policy actually say for this account, right now.
  const direct = await callRpc(page, token, "rpc_weak_areas_v2");
  expect(direct.status, `rpc_weak_areas_v2 direct call failed: ${direct.body}`).toBe(200);
  const v2Rows = JSON.parse(direct.body) as Array<{
    subject: string; concept: string; understanding: number | null; evidence_strength: number | null;
  }>;
  const v2Concepts = new Set(v2Rows.map((r) => r.concept));
  console.log(`rpc_weak_areas_v2 ground truth: ${v2Rows.length} concept(s): ${[...v2Concepts].join(", ")}`);

  // Either a question loads, or the (correct, honest) empty state renders.
  const question = page.getByText(/Q\d+ of/);
  const emptyState = page.getByText(/No weak concepts tracked yet/);
  await expect(question.or(emptyState)).toBeVisible({ timeout: 30000 });

  if (await emptyState.isVisible().catch(() => false)) {
    console.log("Empty state rendered -- V2 legitimately returned no qualifying concepts.");
    expect(v2Rows.length, "UI showed the empty state but rpc_weak_areas_v2 actually returned rows -- flag likely not wired/on for this build").toBe(0);
  } else {
    // Answer a couple of questions (any option -- correctness doesn't
    // matter here) so rpc_record_question_attempt's request bodies reveal
    // which real bank questions were actually served.
    for (let i = 0; i < 2; i++) {
      const stillQuestion = await question.isVisible().catch(() => false);
      if (!stillQuestion) break;
      await (await optionButton(page, "A")).click();
      const nextBtn = page.getByRole("button", { name: /Next Question|See Results/ });
      await expect(nextBtn).toBeVisible({ timeout: 10000 });
      const isLast = (await nextBtn.textContent())?.includes("See Results") ?? false;
      await nextBtn.click();
      if (isLast) break;
      await expect(page.getByText(/Q\d+ of/)).toBeVisible({ timeout: 15000 });
    }
  }

  expect(sawV2Call, "rpc_weak_areas_v2 was never called -- flag was not actually on for this build").toBe(true);
  expect(sawLegacyCall, "the legacy concept_mastery classification=eq.weak query fired -- both paths executed, not just V2").toBe(false);

  // Trace served questions back to their concept, confirm each is a member
  // of the same set rpc_weak_areas_v2 itself returned -- not a second,
  // independent selection.
  if (recordBankQuestionIds.length > 0) {
    const params = new URLSearchParams({
      select: "id,concept",
      id: `in.(${recordBankQuestionIds.join(",")})`,
    });
    const res = await page.request.get(`${SUPABASE_URL}/rest/v1/question_bank?${params.toString()}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    const bankRows = JSON.parse(await res.text()) as Array<{ id: string; concept: string | null }>;
    console.log(`Served bank questions traced to concepts: ${bankRows.map((r) => r.concept).join(", ")}`);
    for (const row of bankRows) {
      expect(
        row.concept && v2Concepts.has(row.concept),
        `served question ${row.id} has concept "${row.concept}", not present in rpc_weak_areas_v2's own concept set`,
      ).toBe(true);
    }
  }

  // Cross-check formula correctness once more on whatever V2 actually
  // returned here (diag-weak-areas-v2.spec.ts already proves this
  // end-to-end with a forced sequence; this just confirms the same
  // guarantee holds for this run's real data too).
  if (v2Rows.length > 0) {
    const target = v2Rows[0];
    const cmParams = new URLSearchParams({
      select: "total_attempts,correct_attempts,confidence_score",
      subject: `eq.${target.subject}`,
      concept: `eq.${target.concept}`,
    });
    const cmRes = await page.request.get(`${SUPABASE_URL}/rest/v1/concept_mastery?${cmParams.toString()}`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
    const cmRows = JSON.parse(await cmRes.text()) as Array<{ total_attempts: number; correct_attempts: number }>;
    if (cmRows.length > 0) {
      const expectedEvidence = wilsonEvidenceStrength(cmRows[0].correct_attempts, cmRows[0].total_attempts);
      expect(Math.abs((target.evidence_strength ?? -999) - expectedEvidence)).toBeLessThan(0.2);
    }
  }
});
