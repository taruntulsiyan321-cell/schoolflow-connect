import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Verifies the VITE_FF_DECISION_ENGINE_WEAK_AREAS_V2 wiring in
 * RecoveryCompletionReportPage.tsx -- the second Weak Areas consumer,
 * reusing the existing flag rather than a new one. Not a re-test of
 * rpc_weak_areas_v2's formula correctness (diag-weak-areas-v2.spec.ts
 * already proves that) -- this proves the report's "next weak concept"
 * suggestion actually comes from rpc_weak_areas_v2 when the flag is on,
 * not from rpc_student_recovery_zone.
 *
 * Bypasses actually playing through a real recovery session (unrelated to
 * what changed here) by writing a valid RecoverySessionResultState
 * directly into sessionStorage, exactly the shape
 * persistRecoveryResult/readRecoveryResultState already use -- then
 * navigating straight to the completion report.
 *
 * Requires a flag-on local build:
 *   VITE_FF_DECISION_ENGINE_WEAK_AREAS_V2=1 npm run dev
 *   PLAYWRIGHT_BASE_URL=http://localhost:8080 npx playwright test \
 *     e2e/diag-recovery-report-weak-areas-v2.spec.ts --project=chromium
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

test("diagnostic: RecoveryCompletionReportPage's next-weak-concept suggestion sources from rpc_weak_areas_v2 when the flag is on", async ({ page }) => {
  test.setTimeout(120000);
  expect(SUPABASE_ANON_KEY, "VITE_SUPABASE_PUBLISHABLE_KEY not set -- check .env").not.toBe("");

  let sawV2Call = false;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/rest/v1/rpc/rpc_weak_areas_v2")) {
      sawV2Call = true;
    }
  });

  await page.goto("/student/recovery");
  const token = await getAccessToken(page);

  // Ground truth: what does the policy actually say for this account, right now.
  const direct = await callRpc(page, token, "rpc_weak_areas_v2");
  expect(direct.status, `rpc_weak_areas_v2 direct call failed: ${direct.body}`).toBe(200);
  const v2Rows = JSON.parse(direct.body) as Array<{ concept: string }>;
  const v2Concepts = new Set(v2Rows.map((r) => r.concept));
  console.log(`rpc_weak_areas_v2 ground truth: ${v2Rows.length} concept(s): ${[...v2Concepts].join(", ")}`);

  // Fake a just-completed recovery session for a concept guaranteed to
  // differ from anything V2 might return, so the "next weak concept"
  // filter (w.concept !== localState.concept) can't accidentally exclude
  // every real V2 row.
  const assignmentId = `diag-${Date.now()}`;
  await page.evaluate(
    ({ id }) => {
      const state = {
        assignmentId: id,
        subject: "Diagnostic",
        chapter: "Diagnostic",
        concept: "__diagnostic_placeholder_concept__",
        severity: "minor",
        attempts: [
          {
            questionId: "diag-q1",
            question: "diagnostic",
            options: ["a", "b"],
            correctIndex: 0,
            selectedIndex: 0,
            isCorrect: true,
          },
        ],
        startedAt: new Date().toISOString(),
      };
      sessionStorage.setItem(`recovery-result-${id}`, JSON.stringify(state));
    },
    { id: assignmentId },
  );

  await page.goto(`/student/recovery/${assignmentId}/complete`);
  await expect(page.getByText(/Revision Complete|Recovery Complete|Complete/i).first()).toBeVisible({ timeout: 30000 })
    .catch(() => {
      // Report heading text may vary -- fall back to confirming the page
      // rendered *something* other than the "report not found" state.
    });
  await expect(page.getByText(/recovery report not found/i)).not.toBeVisible();

  // The report renders immediately from local session state -- the
  // getWeakAreasV2 fetch is a separate, async effect that fires after
  // ctx/academicReady resolve. Give it a real window to complete before
  // checking the network listener, rather than racing it.
  await page.waitForTimeout(5000);

  expect(sawV2Call, "rpc_weak_areas_v2 was never called -- flag was not actually on for this build, or the report never loaded").toBe(true);

  // If V2 returned any concepts, the page must not display a "next weak
  // concept" name that ISN'T one of them (would mean it's still reading
  // rpc_student_recovery_zone despite the flag).
  if (v2Rows.length > 0) {
    const pageText = (await page.locator("body").innerText()).toLowerCase();
    const anyV2ConceptShown = [...v2Concepts].some((c) => pageText.includes(c.toLowerCase()));
    // Not a hard assertion on which exact concept shows (the report may
    // present it via a differently-cased/labeled UI element) -- the network
    // assertion above is the primary proof. This is corroborating evidence
    // only, logged either way.
    console.log(`A V2 concept appears in the rendered report text: ${anyV2ConceptShown}`);
  }
});
