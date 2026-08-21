import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/**
 * Verifies the fix in
 * supabase/migrations/20260805060000_fix_recovery_assignments_duplicate_race.sql.
 *
 * Fires several genuinely concurrent calls to rpc_assign_concept_recovery
 * for the exact same (subject, chapter, concept, subconcept) -- the precise
 * condition that produced duplicate rows before the fix -- then confirms
 * exactly one open recovery_assignments row exists, and that every
 * concurrent call returned the same assignment id (not different ones).
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

test("Bug #10 fix: concurrent rpc_assign_concept_recovery calls never create duplicate assignments", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/student/practice");
  await expect(page.getByRole("button", { name: "Subject Practice" }).first()).toBeVisible({ timeout: 30000 });
  const token = await getAccessToken(page);
  const userId = JSON.parse(atob(token.split(".")[1])).sub;

  // Real subject/chapter with actual approved question_bank rows (confirmed
  // via direct query: subject="Social Studies", chapter="History",
  // concept="British", topic="British"). This matters: the RPC raises an
  // exception (and rolls back its own INSERT) when zero questions match,
  // which happens *before* the ON CONFLICT race behavior can be observed --
  // a fabricated concept name that matches no real content defeats this
  // test regardless of whether the concurrency fix works. Concept/subconcept
  // left undefined so _concept_f falls back to _chapter server-side, which
  // itself matches real question_bank rows via the chapter ILIKE clause.
  const args = {
    _subject: "Social Studies",
    _chapter: "History",
    _accuracy: 20,
    _source_type: "diagnostic",
    _source_id: null,
  };

  // Clean slate every run: delete any pending/in_progress assignment this
  // exact key may have left behind from a previous run of this diagnostic,
  // so every run exercises a genuine first-insert race, not a "conflict
  // against an already-existing row from last time" no-op. Scoped to this
  // account's own rows only (RLS: "recovery self" policy, user_id = auth.uid()).
  const cleanupParams = new URLSearchParams({
    user_id: `eq.${userId}`,
    subject: `eq.${args._subject}`,
    chapter: `eq.${args._chapter}`,
    status: "in.(pending,in_progress)",
  });
  await page.request.delete(`${SUPABASE_URL}/rest/v1/recovery_assignments?${cleanupParams.toString()}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });

  const callOnce = () =>
    page.request.post(`${SUPABASE_URL}/rest/v1/rpc/rpc_assign_concept_recovery`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      data: args,
    }).then(async (res) => ({ status: res.status(), body: await res.text() }));

  // Genuinely concurrent -- fired together, not awaited one at a time --
  // the exact condition (two overlapping calls, same key, neither committed
  // yet when the other's existence-check ran) that produced duplicates
  // before the fix.
  const results = await Promise.all([callOnce(), callOnce(), callOnce(), callOnce(), callOnce()]);

  console.log("Concurrent call results:");
  for (const r of results) console.log(`  status=${r.status} body=${r.body.slice(0, 200)}`);

  for (const r of results) {
    expect(r.status, `a concurrent call failed: ${r.body}`).toBe(200);
  }

  const ids = results.map((r) => JSON.parse(r.body));
  const uniqueIds = new Set(ids);
  console.log(`Returned assignment ids: ${JSON.stringify([...ids])}`);
  expect(uniqueIds.size, "concurrent calls returned different assignment ids -- duplicates were created").toBe(1);

  // Independently verify at the data layer, not just via the RPC's own claim.
  const params = new URLSearchParams({
    select: "id,status,created_at",
    user_id: `eq.${userId}`,
    subject: `eq.${args._subject}`,
    chapter: `eq.${args._chapter}`,
    status: "in.(pending,in_progress)",
  });
  const readRes = await page.request.get(`${SUPABASE_URL}/rest/v1/recovery_assignments?${params.toString()}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  const rows = JSON.parse(await readRes.text());
  console.log(`Rows actually in recovery_assignments for this concept: ${JSON.stringify(rows)}`);
  expect(rows.length, "more than one open recovery_assignments row exists for the same concept").toBe(1);
});
