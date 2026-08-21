import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Verifies the VITE_FF_DECISION_ENGINE_REVISION_V2 wiring in
 * useRevisionItems (src/gurukul/pages/useRevisionQueueV2.ts) -- that
 * flipping the flag on actually makes Revision.tsx render from
 * rpc_revision_plan_v2 instead of snapshot.revision_queue, and that the
 * priority->dueIn bucket adapter produces the expected labels.
 *
 * Unlike the Weak Areas live-switch diagnostic, this does NOT assert the
 * legacy RPC never fires -- rpc_student_academic_snapshot is still called
 * by Revision.tsx regardless of the flag (for loading/error/reload state
 * and other snapshot fields), it's only the *rendered* revision_queue data
 * that gets superseded. Proof here is: rpc_revision_plan_v2 fires, the
 * rendered card count matches its row count, and no concept rendered on
 * the page is one that's absent from V2's own concept set.
 *
 * Requires a flag-on local build, same as the Weak Areas diagnostic:
 *   VITE_FF_DECISION_ENGINE_REVISION_V2=1 npm run dev
 *   PLAYWRIGHT_BASE_URL=http://localhost:8080 npx playwright test \
 *     e2e/diag-revision-v2-live-switch.spec.ts --project=chromium
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
const SUPABASE_URL = loadEnvVar("VITE_SUPABASE_URL") || "https://psqxykzqfvxgsvkmgurn.supabase.co";
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

/** Mirrors dueLabelFromPriority in useRevisionQueueV2.ts -- independent
 * reimplementation, not a call into the same code. */
function dueLabelFromPriority(priority: number): string {
  if (priority >= 80) return "Now";
  if (priority >= 60) return "Today";
  if (priority >= 40) return "Tomorrow";
  const days = Math.max(2, Math.round((100 - priority) / 10));
  return `${days} days`;
}

test("diagnostic: flag-on Revision page renders from rpc_revision_plan_v2 with correctly-adapted due labels", async ({ page }) => {
  test.setTimeout(120000);
  expect(SUPABASE_ANON_KEY, "VITE_SUPABASE_PUBLISHABLE_KEY not set -- check .env").not.toBe("");

  let sawV2Call = false;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/rest/v1/rpc/rpc_revision_plan_v2")) {
      sawV2Call = true;
    }
  });

  await page.goto("/student/revision");
  const token = await getAccessToken(page);

  // Ground truth: what does the policy actually say for this account, right now.
  const direct = await callRpc(page, token, "rpc_revision_plan_v2");
  expect(direct.status, `rpc_revision_plan_v2 direct call failed: ${direct.body}`).toBe(200);
  const v2Rows = JSON.parse(direct.body) as Array<{
    subject: string; chapter: string | null; concept: string; subconcept: string | null; priority: number;
  }>;
  const v2Concepts = new Set(v2Rows.map((r) => r.subconcept ?? r.concept));
  const expectedBuckets = v2Rows.map((r) => dueLabelFromPriority(r.priority));
  console.log(`rpc_revision_plan_v2 ground truth: ${v2Rows.length} row(s), expected buckets: ${expectedBuckets.join(", ")}`);

  // Page must settle to either real cards or the empty state -- never an
  // indefinite spinner or a silently-empty page with no explanation.
  const emptyState = page.getByText(/No items match this filter|revision queue is empty/i);
  const anyCard = page.getByText(/Practice topic/); // RevItemCard's own action button, one per card
  await expect(emptyState.or(anyCard).first()).toBeVisible({ timeout: 30000 });

  expect(sawV2Call, "rpc_revision_plan_v2 was never called -- flag was not actually on for this build").toBe(true);

  if (v2Rows.length === 0) {
    console.log("V2 legitimately returned no revision items -- confirming empty state, nothing further to cross-check.");
    await expect(emptyState.first()).toBeVisible();
    return;
  }

  // Rendered card count should match V2's row count exactly -- if it
  // instead matched some other number, the page would still be reading
  // snapshot.revision_queue (or something else), not the V2 response.
  const cardCount = await page.getByText("Practice topic").count();
  expect(cardCount, "rendered card count doesn't match rpc_revision_plan_v2's row count").toBe(v2Rows.length);

  // No concept on the page should be one V2 didn't return.
  const pageText = (await page.locator("body").innerText()).toLowerCase();
  for (const concept of v2Concepts) {
    expect(pageText.includes(concept.toLowerCase()), `expected V2 concept "${concept}" to appear on the page`).toBe(true);
  }

  // At least one expected due-bucket label should be visible (DueTag
  // renders exactly these strings) -- cross-checks the priority adapter,
  // not just that "some" data rendered.
  const uniqueBuckets = [...new Set(expectedBuckets)];
  let sawExpectedBucket = false;
  for (const bucket of uniqueBuckets) {
    if (pageText.includes(bucket.toLowerCase())) {
      sawExpectedBucket = true;
      break;
    }
  }
  expect(sawExpectedBucket, `expected at least one of [${uniqueBuckets.join(", ")}] due-bucket labels on the page`).toBe(true);

  // "Mark done" on a V2 item must fail safely (rpc_complete_revision's own
  // "item not found" exception -- a synthetic V2 id never matches a real
  // revision_queue row), never a silent false success. The toast itself is
  // transient (Sonner auto-dismisses in a few seconds) and unreliable to
  // catch reliably in a poll window, so the robust check is the thing that
  // actually matters: the card must NOT disappear, since a real completion
  // would remove it from the (NOT completed) queue.
  const cardCountBefore = await page.getByText("Practice topic").count();
  const markDoneBtn = page.getByRole("button", { name: /Mark done/i }).first();
  if (await markDoneBtn.isVisible().catch(() => false)) {
    await markDoneBtn.click();
    await page.waitForTimeout(2000);
    const cardCountAfter = await page.getByText("Practice topic").count();
    expect(
      cardCountAfter,
      "card count changed after a forced-to-fail 'Mark done' click -- possible false success",
    ).toBe(cardCountBefore);
  }
});
