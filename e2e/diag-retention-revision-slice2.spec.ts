import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Diagnostic verifying Decision Engine Slice 2 (half_life_estimate,
 * _dim_retention, rpc_revision_plan_v2) end to end, against real live data.
 *
 * Strategy, deterministic rather than UI-click-and-hope (Slice 1's approach
 * didn't need this because it only read final aggregate state; Slice 2's
 * half-life is a *stateful, per-attempt* update, so this test needs to know
 * the exact correct/wrong sequence it produced to replay-verify it):
 *
 *   1. question_bank.correct_index is readable by an authenticated student
 *      (confirmed live -- a pre-existing RLS looseness, not something this
 *      diagnostic introduces or should paper over). That makes it possible
 *      to call the *real* rpc_start_practice_session / rpc_record_question_
 *      attempt pair with fully controlled correctness, by choosing
 *      _selected_answer.index to equal or differ from correct_index.
 *   2. Fire five real attempts against one fixed bank question, in a
 *      correct/correct/correct/wrong/correct sequence, each in its own
 *      session (rpc_record_question_attempt only dedupes re-entry within
 *      the *same* session_id, so separate sessions avoid that branch).
 *   3. After each attempt, independently re-implement the exact incremental
 *      formula from 20260805070000_decision_engine_slice2_retention_revision.sql
 *      in this test and compare to the real concept_mastery row -- not just
 *      the final state, every step, so a divergence is caught at the exact
 *      attempt that caused it.
 *   4. Call _dim_retention directly (granted to authenticated, same as
 *      Slice 1's dimension functions) right after the sequence (days~0,
 *      retention should be ~100) and again after backdating last_attempt_at
 *      by 20 days via a direct self-row REST PATCH (RLS: "mastery self"
 *      policy allows it) -- proving retention is derived fresh at read
 *      time, the single most load-bearing property of this design.
 *   5. Call rpc_revision_plan_v2 after backdating and confirm the concept
 *      appears with a retention value matching the independent computation,
 *      confirm it does NOT appear before backdating, and independently
 *      cross-check understanding/evidence_strength the same way Slice 1's
 *      diagnostic did.
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

async function rpc(page: Page, token: string, name: string, body: Record<string, unknown> = {}) {
  const res = await page.request.post(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: body,
  });
  return { status: res.status(), body: await res.text() };
}

type MasteryRow = {
  half_life_estimate: number;
  forgetting_events_count: number;
  last_outcome_correct: boolean | null;
  last_attempt_at: string;
  total_attempts: number;
  correct_attempts: number;
  confidence_score: number | null;
};

async function readMastery(page: Page, token: string, subject: string, chapter: string, concept: string, subconcept: string): Promise<MasteryRow | null> {
  const params = new URLSearchParams({
    select: "half_life_estimate,forgetting_events_count,last_outcome_correct,last_attempt_at,total_attempts,correct_attempts,confidence_score",
    subject: `eq.${subject}`,
    chapter: `eq.${chapter}`,
    concept: `eq.${concept}`,
    subconcept: `eq.${subconcept}`,
  });
  const res = await page.request.get(`${SUPABASE_URL}/rest/v1/concept_mastery?${params.toString()}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const rows = JSON.parse(await res.text()) as MasteryRow[];
  return rows[0] ?? null;
}

/** Independent re-implementation of the incremental half-life update in
 * _upsert_concept_mastery -- not a call into the same code. */
function replayStep(
  prev: { halfLife: number | null; forgetCount: number; lastCorrect: boolean | null },
  isCorrect: boolean,
): { halfLife: number; forgetCount: number; lastCorrect: boolean } {
  if (prev.halfLife === null) {
    // First-ever attempt: seed, not a recall event.
    return { halfLife: 1.0, forgetCount: 0, lastCorrect: isCorrect };
  }
  const halfLife = isCorrect
    ? Math.min(180, prev.halfLife * 1.8)
    : Math.max(0.5, prev.halfLife * 0.3);
  const forgetCount = prev.forgetCount + (!isCorrect && prev.lastCorrect === true ? 1 : 0);
  return { halfLife, forgetCount, lastCorrect: isCorrect };
}

/** Independent re-implementation of _dim_retention's formula. */
function retentionEstimate(halfLifeDays: number, daysSinceLastPractice: number): number {
  return Math.round(Math.pow(2, -daysSinceLastPractice / halfLifeDays) * 100 * 10) / 10;
}

/** Wilson score interval, mirrored from _dim_evidence_strength (same
 * reimplementation diag-weak-areas-v2.spec.ts already validated). */
function wilsonEvidenceStrength(correct: number, n: number): number {
  if (n <= 0) return 0;
  const z = 1.96;
  const p = correct / n;
  const denom = 1 + (z * z) / n;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  const width = Math.min(1, 2 * margin);
  return Math.round((1 - width) * 100 * 10) / 10;
}

const BANK_QUESTION_ID = "627a736e-2564-429b-b93c-91a5627c4ea8"; // "Indian constitution came into effect on", correct_index=1
const CORRECT_INDEX = 1;
const WRONG_INDEX = 0;
const SUBJECT = "Social Studies";
const CHAPTER = "Civics";
const CONCEPT = "Constitution";
const SUBCONCEPT = "Constitution";

test("diagnostic: Slice 2 half_life_estimate, _dim_retention, rpc_revision_plan_v2 match independently-recomputed formulas", async ({ page }) => {
  test.setTimeout(120000);
  expect(SUPABASE_ANON_KEY, "VITE_SUPABASE_PUBLISHABLE_KEY not set -- check .env").not.toBe("");

  await page.goto("/student/practice");
  await expect(page.getByRole("button", { name: "Subject Practice" }).first()).toBeVisible({ timeout: 30000 });
  const token = await getAccessToken(page);

  // Starting point: whatever this concept's real state already is (handles
  // both "never touched before" and "touched by an earlier run of this
  // diagnostic" -- the replay always starts from ground truth, never an
  // assumption of freshness).
  const before = await readMastery(page, token, SUBJECT, CHAPTER, CONCEPT, SUBCONCEPT);
  let replay = {
    halfLife: before?.half_life_estimate ?? null,
    forgetCount: before?.forgetting_events_count ?? 0,
    lastCorrect: before?.last_outcome_correct ?? null,
  };
  console.log(`Before: ${JSON.stringify(before)}`);

  const sequence = [true, true, true, false, true];
  for (const isCorrect of sequence) {
    const session = await rpc(page, token, "rpc_start_practice_session", {
      _subject: SUBJECT, _chapter: CHAPTER, _count: 1,
    });
    expect(session.status, `rpc_start_practice_session failed: ${session.body}`).toBe(200);
    const sessionId = JSON.parse(session.body);

    const attempt = await rpc(page, token, "rpc_record_question_attempt", {
      _correct_answer: {},
      _generated_question: {},
      _is_correct: isCorrect,
      _selected_answer: { index: isCorrect ? CORRECT_INDEX : WRONG_INDEX },
      _session_id: sessionId,
      _bank_question_id: BANK_QUESTION_ID,
    });
    expect(attempt.status, `rpc_record_question_attempt failed: ${attempt.body}`).toBe(200);

    replay = replayStep(replay, isCorrect);
    const actual = await readMastery(page, token, SUBJECT, CHAPTER, CONCEPT, SUBCONCEPT);
    expect(actual, "concept_mastery row missing after a recorded attempt").not.toBeNull();
    console.log(
      `attempt correct=${isCorrect}: expected half_life=${replay.halfLife.toFixed(4)} forget=${replay.forgetCount} ` +
      `| actual half_life=${actual!.half_life_estimate} forget=${actual!.forgetting_events_count}`,
    );
    expect(Math.abs(actual!.half_life_estimate - replay.halfLife), "half_life_estimate diverged from the independently-replayed formula").toBeLessThan(0.01);
    expect(actual!.forgetting_events_count, "forgetting_events_count diverged from the independently-replayed formula").toBe(replay.forgetCount);
    expect(actual!.last_outcome_correct, "last_outcome_correct diverged").toBe(replay.lastCorrect);
  }

  const afterSequence = await readMastery(page, token, SUBJECT, CHAPTER, CONCEPT, SUBCONCEPT);
  expect(afterSequence).not.toBeNull();
  const finalHalfLife = afterSequence!.half_life_estimate;

  // Retention right after practicing should be ~100% (days_since_practice ~0).
  const dimFresh = await rpc(page, token, "_dim_retention", {
    _user_id: JSON.parse(atob(token.split(".")[1])).sub,
    _subject: SUBJECT, _chapter: CHAPTER, _concept: CONCEPT, _subconcept: SUBCONCEPT,
  });
  expect(dimFresh.status, `_dim_retention failed: ${dimFresh.body}`).toBe(200);
  const freshRetention = JSON.parse(dimFresh.body) as number;
  console.log(`_dim_retention immediately after practice: ${freshRetention} (expect close to 100)`);
  expect(freshRetention).toBeGreaterThan(95);

  // rpc_revision_plan_v2 must NOT surface a concept just practiced.
  const planBefore = await rpc(page, token, "rpc_revision_plan_v2");
  expect(planBefore.status).toBe(200);
  const rowsBefore = JSON.parse(planBefore.body) as Array<{ concept: string; subject: string }>;
  expect(
    rowsBefore.some((r) => r.concept === CONCEPT && r.subject === SUBJECT),
    "a concept practiced seconds ago should never qualify for Revision (retention should be near 100)",
  ).toBe(false);

  // Backdate last_attempt_at by 20 days -- a direct self-row REST PATCH,
  // RLS-permitted ("mastery self": user_id = auth.uid()). This simulates
  // elapsed time without needing to wait 20 real days, and is the only way
  // to test "derived fresh at read time" without a clock-mocking harness.
  const backdated = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();
  const patchParams = new URLSearchParams({
    subject: `eq.${SUBJECT}`, chapter: `eq.${CHAPTER}`, concept: `eq.${CONCEPT}`, subconcept: `eq.${SUBCONCEPT}`,
  });
  const patchRes = await page.request.patch(`${SUPABASE_URL}/rest/v1/concept_mastery?${patchParams.toString()}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=minimal" },
    data: { last_attempt_at: backdated },
  });
  expect(patchRes.status(), `backdating last_attempt_at failed: ${await patchRes.text()}`).toBeLessThan(300);

  const dimBackdated = await rpc(page, token, "_dim_retention", {
    _user_id: JSON.parse(atob(token.split(".")[1])).sub,
    _subject: SUBJECT, _chapter: CHAPTER, _concept: CONCEPT, _subconcept: SUBCONCEPT,
  });
  expect(dimBackdated.status).toBe(200);
  const backdatedRetention = JSON.parse(dimBackdated.body) as number;
  const expectedRetention = retentionEstimate(finalHalfLife, 20);
  console.log(`_dim_retention after 20-day backdate: actual=${backdatedRetention} expected=${expectedRetention} (half_life=${finalHalfLife})`);
  expect(Math.abs(backdatedRetention - expectedRetention), "retention_estimate diverged from the independently-recomputed 2^(-days/half_life) formula").toBeLessThan(0.2);

  // Independent understanding/evidence_strength cross-check, same method as
  // Slice 1's diagnostic, to confirm the Revision policy's gate is reading
  // real, correct dimension values.
  const finalRead = await readMastery(page, token, SUBJECT, CHAPTER, CONCEPT, SUBCONCEPT);
  expect(finalRead).not.toBeNull();
  const expectedEvidence = wilsonEvidenceStrength(finalRead!.correct_attempts, finalRead!.total_attempts);
  const expectedUnderstanding = finalRead!.confidence_score ?? Math.round((100 * finalRead!.correct_attempts / finalRead!.total_attempts) * 10) / 10;
  console.log(`Independent: understanding=${expectedUnderstanding} evidence_strength=${expectedEvidence} retention=${backdatedRetention}`);

  const planAfter = await rpc(page, token, "rpc_revision_plan_v2");
  expect(planAfter.status, `rpc_revision_plan_v2 failed: ${planAfter.body}`).toBe(200);
  const rowsAfter = JSON.parse(planAfter.body) as Array<{
    subject: string; chapter: string; concept: string; subconcept: string;
    understanding: number | null; evidence_strength: number | null; retention: number | null;
    forgetting_events_count: number; priority: number; reason: Record<string, number | null>;
  }>;
  const target = rowsAfter.find((r) => r.concept === CONCEPT && r.subject === SUBJECT);

  const qualifies = expectedEvidence >= 30 && expectedUnderstanding >= 65 && backdatedRetention < 70;
  console.log(`Expected to qualify for Revision: ${qualifies} (evidence>=30: ${expectedEvidence >= 30}, understanding>=65: ${expectedUnderstanding >= 65}, retention<70: ${backdatedRetention < 70})`);

  if (qualifies) {
    expect(target, "concept satisfies Revision's own qualifying thresholds but rpc_revision_plan_v2 did not return it").toBeTruthy();
    expect(Math.abs((target!.retention ?? -999) - backdatedRetention), "policy's retention value diverges from _dim_retention's own output").toBeLessThan(0.2);
    expect(target!.reason.retention).toBe(target!.retention);
    expect(target!.reason.forgetting_events_count).toBe(target!.forgetting_events_count);
  } else {
    expect(target, "concept does not satisfy Revision's own qualifying thresholds but rpc_revision_plan_v2 returned it anyway").toBeFalsy();
  }

  for (let i = 1; i < rowsAfter.length; i++) {
    expect(rowsAfter[i - 1].priority, "rows are not sorted by priority DESC").toBeGreaterThanOrEqual(rowsAfter[i].priority);
  }
});
