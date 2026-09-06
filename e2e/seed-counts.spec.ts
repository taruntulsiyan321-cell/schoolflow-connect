import { test, expect } from "@playwright/test";

/** Count the tables the principal / parent / teacher panels read from. */
test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180000);

test("demo data counts", async ({ page }) => {
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email or Mobile").fill("admin@wisdomcampus.com");
  await page.locator("#signin-password").fill("DemoPass123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin/, { timeout: 60000 });
  await page.waitForTimeout(3000);

  const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  const out = await page.evaluate(async (anon: string) => {
    let token = "";
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!/auth-token/.test(k)) continue;
      try { token = JSON.parse(localStorage.getItem(k)!)?.access_token ?? ""; } catch { /* ignore */ }
    }
    const base = "https://psqxykzqfvxgsvkmgurn.supabase.co/rest/v1";
    const count = async (t: string) => {
      const r = await fetch(`${base}/${t}?select=id`, {
        headers: { apikey: anon, Authorization: `Bearer ${token}`, Prefer: "count=exact", Range: "0-0" },
      });
      return `${r.status} ${r.headers.get("content-range") ?? ""}`;
    };
    const tables = [
      "school_inquiries", "school_complaints", "leave_requests", "notices",
      "community_doubts", "homework", "homework_submissions", "marks",
      "attendance", "exams", "teacher_remarks", "school_calendar_events",
      "notifications", "students", "teachers", "classes", "parents", "parent_students",
    ];
    const res: Record<string, string> = {};
    for (const t of tables) res[t] = await count(t);
    return { token: token.slice(0, 12) + "…", res };
  }, ANON);

  console.log("\n=== DEMO DATA COUNTS (as admin) ===");
  for (const [k, v] of Object.entries(out.res)) console.log(`  ${k.padEnd(24)} ${v}`);
  console.log("===================================\n");
});
