import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Verifies the VITE_FF_DECISION_ENGINE_WEAK_AREAS_V2 wiring in
 * Recovery.tsx's evidence-only topic branch -- the 4th Weak Areas
 * consumer, reusing the existing flag. Not a re-test of
 * rpc_weak_areas_v2's formula correctness -- proves the Recovery Center's
 * "no open assignment yet" topics source from rpc_weak_areas_v2 when the
 * flag is on, not from rpc_student_recovery_zone's weak_concepts field.
 *
 * Also checks the one genuinely new risk vs. the prior three migrations:
 * mapRecoveryZoneToTopics dedupes open_assignments (workflow, untouched)
 * against weak_concepts (evidence, now V2-sourced) by a
 * `${subject}:${concept}` key -- confirms that key still lines up between
 * the two different RPCs' concept naming, i.e. no duplicate topics and no
 * V2 concept silently swallowed.
 *
 * Every concept the QA account already has V2 evidence for ("French")
 * already has an open recovery_assignments row too. This diagnostic
 * originally tried to manufacture a guaranteed evidence-ONLY case (no
 * assignment) by recording wrong answers directly via
 * rpc_record_question_attempt, bypassing the UI's assignRecoveryOnMistake
 * flow -- but discovered that's not actually possible: per
 * 20260618000000_mistake_triggers_recovery.sql, wrong practice answers
 * immediately queue a recovery assignment at the DATABASE level (not just
 * from a UI button), so *any* concept with V2 evidence from a wrong
 * answer will already have an open assignment. That's expected product
 * behavior, not a bug -- it also means the true evidence-only branch is
 * a rare/edge path in practice (e.g. an assignment already marked
 * completed while the concept is still weak), not the common case this
 * plan initially assumed.
 *
 * Given that, this diagnostic instead verifies the one thing that IS
 * reliably testable and is the actual genuinely-new risk for this
 * migration: the dedup/merge path. mapRecoveryZoneToTopics's first loop
 * (open_assignments, untouched by this migration) looks up
 * `weakMap.get('${subject}:${concept}')` -- built from the SAME
 * weak_concepts array this migration now sources from V2 -- to enrich an
 * assignment-derived topic with real mastery/aiReason text. If V2's
 * concept-key naming didn't line up with open_assignments' naming, that
 * lookup would silently miss and fall back to a generic message. This
 * diagnostic manufactures a fresh concept (Economics/"Collection of
 * Data"/primary, never touched by this QA account before), confirms V2
 * flags it as weak, confirms it now also has an open assignment (the
 * discovery above, asserted as expected rather than treated as a
 * failure), then confirms the rendered card's "Insight" text is the
 * weakMap-enriched message -- proving the V2-sourced weak_concepts array
 * key-matches successfully against open_assignments' concept naming.
 *
 * Requires a flag-on local build:
 *   VITE_FF_DECISION_ENGINE_WEAK_AREAS_V2=1 npm run dev
 *   PLAYWRIGHT_BASE_URL=http://localhost:8080 npx playwright test \
 *     e2e/diag-recovery-weak-areas-v2.spec.ts --project=chromium
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

async function recordAttempts(
  page: Page,
  token: string,
  opts: { subject: string; chapter: string; bankQuestionId: string; correctIndex: number; sequence: boolean[] },
) {
  for (const isCorrect of opts.sequence) {
    const session = await callRpc(page, token, "rpc_start_practice_session", {
      _subject: opts.subject, _chapter: opts.chapter, _count: 1,
    });
    expect(session.status, `rpc_start_practice_session failed: ${session.body}`).toBe(200);
    const sessionId = JSON.parse(session.body);
    const attempt = await callRpc(page, token, "rpc_record_question_attempt", {
      _correct_answer: {},
      _generated_question: {},
      _is_correct: isCorrect,
      _selected_answer: { index: isCorrect ? opts.correctIndex : (opts.correctIndex + 1) % 4 },
      _session_id: sessionId,
      _bank_question_id: opts.bankQuestionId,
    });
    expect(attempt.status, `rpc_record_question_attempt failed: ${attempt.body}`).toBe(200);
  }
}

test("diagnostic: Recovery.tsx's evidence-only topics source from rpc_weak_areas_v2 when the flag is on", async ({ page }) => {
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

  // Manufacture a guaranteed-clean evidence-only case: 9 wrong answers on
  // a concept this QA account has never touched (no concept_mastery, no
  // recovery_assignments), recorded via the RPC directly -- never through
  // the UI's assign-on-mistake flow, so no workflow assignment is created.
  await recordAttempts(page, token, {
    subject: "Economics", chapter: "Collection of Data",
    bankQuestionId: "2bb16a91-172f-4110-a46b-b8601a317391", correctIndex: 1,
    sequence: Array(9).fill(false),
  });

  // Ground truth #1: what the evidence-only policy actually says right now.
  const v2Res = await callRpc(page, token, "rpc_weak_areas_v2");
  expect(v2Res.status, `rpc_weak_areas_v2 direct call failed: ${v2Res.body}`).toBe(200);
  const v2Rows = JSON.parse(v2Res.body) as Array<{ subject: string; concept: string }>;
  const v2Keys = v2Rows.map((r) => `${r.subject}:${r.concept}`);
  console.log(`rpc_weak_areas_v2 ground truth: ${v2Rows.length} row(s): ${v2Keys.join(", ")}`);

  const manufactured = v2Rows.find((r) => r.subject === "Economics" && r.concept === "primary");
  expect(manufactured, "the manufactured Economics/primary scenario (9 wrong answers) should qualify for rpc_weak_areas_v2 -- if not, the diagnostic's own setup is broken, not necessarily Recovery.tsx").toBeTruthy();

  // Ground truth #2: which concepts already have an open recovery
  // assignment (workflow state -- untouched by this migration, still
  // sourced from the legacy RPC either way).
  const zoneRes = await callRpc(page, token, "rpc_student_recovery_zone");
  expect(zoneRes.status, `rpc_student_recovery_zone direct call failed: ${zoneRes.body}`).toBe(200);
  const zone = JSON.parse(zoneRes.body) as {
    open_assignments?: Array<{ subject: string; concept: string }>;
  };
  const assignedKeys = new Set((zone.open_assignments ?? []).map((a) => `${a.subject}:${a.concept}`));
  console.log(`open_assignments keys: ${[...assignedKeys].join(", ") || "(none)"}`);

  // Discovery (see file header): rpc_record_question_attempt itself
  // triggers immediate recovery-assignment creation on a wrong answer, so
  // the manufactured concept now has BOTH V2 evidence AND an open
  // assignment -- exactly the merge/dedup path this diagnostic actually
  // needs to exercise, not the (effectively unreachable via this route)
  // evidence-only path originally planned.
  expect(assignedKeys.has("Economics:primary"), "expected rpc_record_question_attempt to have auto-created a recovery_assignments row for the manufactured concept (see file header) -- if this is false, that underlying behavior changed and this diagnostic's premise needs revisiting").toBe(true);

  const evidenceOnlyKeys = v2Keys.filter((k) => !assignedKeys.has(k));
  console.log(`Evidence-only (no open assignment) V2 keys this run: ${evidenceOnlyKeys.join(", ") || "(none)"}`);

  // The page was loaded before recordAttempts ran, so its initial fetches
  // predate the new evidence/assignment -- reload for a fresh fetch.
  await page.reload();
  await page.waitForTimeout(5000);

  expect(sawV2Call, "rpc_weak_areas_v2 was never called -- flag was not actually on for this build, or Recovery.tsx never mounted the effect").toBe(true);

  // Primary check: the manufactured concept's card must show the
  // weakMap-enriched "Insight" text, not the generic fallback -- proving
  // mapRecoveryZoneToTopics's `${subject}:${concept}` lookup against the
  // now-V2-sourced weak_concepts array actually matched
  // open_assignments' concept naming instead of silently missing.
  const title = page.locator("div.text-sm.font-bold.text-white", { hasText: /^Primary Data$/ });
  await expect(title).toBeVisible({ timeout: 15000 });
  const card = title.locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' p-4 ')][1]");
  await card.getByRole("button", { name: /Insight/i }).click();
  await page.waitForTimeout(500);
  const cardText = (await card.innerText()).toLowerCase();
  console.log(`Primary card expanded text: ${cardText}`);
  expect(
    cardText.includes("recovery drill queued from recent mistakes"),
    `Expected the weakMap-enriched Insight text for 'Primary' (proves the V2-sourced weak_concepts key matched open_assignments' key) -- got: ${cardText}`,
  ).toBe(true);

  // Secondary, broader check: if V2 flagged anything else this run that's
  // genuinely evidence-only (rare, per the discovery above, but log it).
  if (evidenceOnlyKeys.length > 0) {
    const pageText = (await page.locator("body").innerText()).toLowerCase();
    const others = v2Rows
      .filter((r) => evidenceOnlyKeys.includes(`${r.subject}:${r.concept}`) && `${r.subject}:${r.concept}` !== "Economics:primary")
      .map((r) => r.concept.toLowerCase());
    for (const concept of others) {
      console.log(`Evidence-only concept "${concept}" appears on page: ${pageText.includes(concept)}`);
    }
  }
});
