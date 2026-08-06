import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Verifies Decision Engine Slice 3 (rpc_recovery_v2 / _dim_recovery_need)
 * end to end, against real data -- not just "did it not error." No
 * product UI or flag is involved; this is a standalone diagnostic against
 * the QA automation account, same pattern as Slices 1 and 2.
 *
 * Three real, deterministic scenarios, each on a concept untouched by any
 * earlier diagnostic this session (avoids contamination from prior runs):
 *   1. "French" (Social Studies/History) -- ~9 consecutive wrong answers.
 *      Should QUALIFY: high recovery_need, high (stable-wrong) consistency,
 *      sufficient evidence, flat/negative growth.
 *   2. "Freedom" (Social Studies/History) -- exactly 1 wrong answer.
 *      Should NOT qualify: evidence_strength gate (thin evidence).
 *   3. "India" (Social Studies/Geography) -- ~9 consecutive correct answers.
 *      Should NOT qualify: high consistency, but stably CORRECT, not
 *      wrong -- proves the policy's understanding<65 gate is actually
 *      doing the "stability of being wrong, not being right" job the
 *      consistency dimension alone cannot do.
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

/** Wilson score interval, mirrored from _dim_evidence_strength -- same
 * reimplementation every prior slice's diagnostic already validated. */
function wilsonEvidenceStrength(correct: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.96;
  const p = correct / n;
  const denom = 1 + (z * z) / n;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  const width = Math.min(1, 2 * margin);
  return Math.round((1 - width) * 100 * 10) / 10;
}

/** Independent reimplementation of _dim_recovery_need -- not a call into
 * the same code. */
function recoveryNeed(understanding: number, lastCorrect: boolean, forgettingCount: number): number {
  const raw =
    (100 - understanding) * 0.5
    + (lastCorrect === false ? 30 : 0)
    + Math.min(forgettingCount * 15, 20);
  return Math.min(100, Math.round(raw * 10) / 10);
}

type MasteryRow = {
  total_attempts: number; correct_attempts: number; confidence_score: number | null;
  last_outcome_correct: boolean | null; forgetting_events_count: number;
};

async function readMastery(page: Page, token: string, subject: string, chapter: string, concept: string, subconcept: string): Promise<MasteryRow | null> {
  const params = new URLSearchParams({
    select: "total_attempts,correct_attempts,confidence_score,last_outcome_correct,forgetting_events_count",
    subject: `eq.${subject}`, chapter: `eq.${chapter}`, concept: `eq.${concept}`, subconcept: `eq.${subconcept}`,
  });
  const res = await page.request.get(`${SUPABASE_URL}/rest/v1/concept_mastery?${params.toString()}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const rows = JSON.parse(await res.text()) as MasteryRow[];
  return rows[0] ?? null;
}

test("diagnostic: rpc_recovery_v2 qualifies stably-wrong concepts, rejects thin evidence and stably-correct concepts", async ({ page }) => {
  test.setTimeout(150000);
  expect(SUPABASE_ANON_KEY, "VITE_SUPABASE_PUBLISHABLE_KEY not set -- check .env").not.toBe("");

  await page.goto("/student/practice");
  await expect(page.getByRole("button", { name: "Subject Practice" }).first()).toBeVisible({ timeout: 30000 });
  const token = await getAccessToken(page);

  // Scenario 1: stably wrong, sufficient evidence -- should qualify.
  await recordAttempts(page, token, {
    subject: "Social Studies", chapter: "History",
    bankQuestionId: "5d18b781-0fa4-4c5d-8546-a7b098cb372a", correctIndex: 2,
    sequence: Array(9).fill(false),
  });
  // Scenario 2: thin evidence -- should NOT qualify.
  await recordAttempts(page, token, {
    subject: "Social Studies", chapter: "History",
    bankQuestionId: "acf45304-b036-48ba-a683-09979f2a44f7", correctIndex: 2,
    sequence: [false],
  });
  // Scenario 3: stably CORRECT -- should NOT qualify despite high consistency.
  await recordAttempts(page, token, {
    subject: "Social Studies", chapter: "Geography",
    bankQuestionId: "768d91fc-43de-4b28-a10d-d03ac743c7eb", correctIndex: 3,
    sequence: Array(9).fill(true),
  });

  const direct = await callRpc(page, token, "rpc_recovery_v2");
  expect(direct.status, `rpc_recovery_v2 failed: ${direct.body}`).toBe(200);
  const rows = JSON.parse(direct.body) as Array<{
    subject: string; concept: string; recovery_need: number | null; consistency: number | null;
    evidence_strength: number | null; growth_trend: number | null; understanding: number | null;
    priority: number; reason: Record<string, number | null>;
  }>;
  console.log(`rpc_recovery_v2 returned ${rows.length} recommendation(s): ${rows.map((r) => r.concept).join(", ")}`);

  for (const row of rows) {
    expect(row.evidence_strength ?? 0).toBeGreaterThanOrEqual(50);
    expect(row.recovery_need ?? 0).toBeGreaterThanOrEqual(60);
    expect(row.consistency ?? 0).toBeGreaterThanOrEqual(50);
    expect(row.understanding ?? 100).toBeLessThan(65);
    expect(row.growth_trend ?? 1).toBeLessThanOrEqual(0);
    expect(row.reason.recovery_need).toBe(row.recovery_need);
  }
  for (let i = 1; i < rows.length; i++) {
    expect(rows[i - 1].priority).toBeGreaterThanOrEqual(rows[i].priority);
  }

  // Scenario 1 must qualify.
  const french = rows.find((r) => r.concept === "French");
  expect(french, "the stably-wrong, sufficiently-evidenced 'French' concept should qualify for Recovery").toBeTruthy();

  // Scenario 2 must NOT qualify (thin evidence).
  expect(rows.find((r) => r.concept === "Freedom"), "'Freedom' has only 1 attempt -- must not qualify (thin evidence)").toBeFalsy();

  // Scenario 3 must NOT qualify (stably correct, not stably wrong).
  expect(rows.find((r) => r.concept === "India"), "'India' is stably CORRECT -- must not qualify despite high consistency").toBeFalsy();

  // Cross-check the qualifying row's recovery_need against an independent
  // recompute from the raw concept_mastery row.
  if (french) {
    const cm = await readMastery(page, token, "Social Studies", "History", "French", "French");
    expect(cm, "could not find concept_mastery row for French").toBeTruthy();
    const understanding = cm!.confidence_score ?? Math.round((100 * cm!.correct_attempts / cm!.total_attempts) * 10) / 10;
    const expectedNeed = recoveryNeed(understanding, cm!.last_outcome_correct ?? true, cm!.forgetting_events_count);
    const expectedEvidence = wilsonEvidenceStrength(cm!.correct_attempts, cm!.total_attempts);
    console.log(`French: expected recovery_need=${expectedNeed} (RPC said ${french.recovery_need}), expected evidence_strength=${expectedEvidence} (RPC said ${french.evidence_strength})`);
    expect(Math.abs((french.recovery_need ?? -999) - expectedNeed)).toBeLessThan(0.2);
    expect(Math.abs((french.evidence_strength ?? -999) - expectedEvidence)).toBeLessThan(0.2);
  }
});
