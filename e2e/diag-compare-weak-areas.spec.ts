import { test, expect, type Page } from "@playwright/test";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

/** Slice 1 review: compare rpc_weak_areas_v2 against every existing
 * weak-concept-adjacent implementation, on the same account, same moment. */

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

async function callRpc(page: Page, name: string) {
  const token = await getAccessToken(page);
  const res = await page.request.post(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data: {},
  });
  return { status: res.status(), body: await res.text() };
}

test("review: compare rpc_weak_areas_v2 against existing weak-concept implementations", async ({ page }) => {
  test.setTimeout(60000);
  await page.goto("/student/practice");
  await expect(page.getByRole("button", { name: "Subject Practice" }).first()).toBeVisible({ timeout: 30000 });

  const [v2, recoveryZone, revisionPlan] = await Promise.all([
    callRpc(page, "rpc_weak_areas_v2"),
    callRpc(page, "rpc_student_recovery_zone"),
    callRpc(page, "rpc_academic_revision_plan"),
  ]);

  console.log("\n=== rpc_weak_areas_v2 (new policy) ===");
  console.log(v2.status, v2.body);

  console.log("\n=== rpc_student_recovery_zone (existing, mastery_score < 60) ===");
  console.log(recoveryZone.status, recoveryZone.body);

  console.log("\n=== rpc_academic_revision_plan (existing, brain weak_concepts + revision_queue) ===");
  console.log(revisionPlan.status, revisionPlan.body);

  expect(v2.status).toBe(200);
  expect(recoveryZone.status).toBe(200);
  expect(revisionPlan.status).toBe(200);
});
