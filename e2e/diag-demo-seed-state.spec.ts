import { test } from "@playwright/test";

/**
 * Is the Class 12 demo cohort actually seeded?
 *
 * supabase/SEED_CLASS12_DEMO.sql says every non-person part was already applied
 * live, and only the two auth users were blocked. This checks the live state:
 * can the new accounts sign in, and did the class/subject/exam data land?
 */

const NEW_ACCOUNTS = [
  { label: "Class 12 student", email: "aarav.sharma@wisdomcampus.com", expect: /\/student/ },
  { label: "Class 12 parent", email: "sharma.parent@wisdomcampus.com", expect: /\/parent/ },
];
const PASSWORD = "DemoPass123!";

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180000);

test("demo seed state", async ({ page }) => {
  const results: string[] = [];

  for (const acct of NEW_ACCOUNTS) {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await page.getByLabel("Email or Mobile").fill(acct.email);
    await page.locator("#signin-password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForTimeout(9000);
    const url = page.url();
    const body = (await page.locator("body").innerText()).replace(/\s*\n+\s*/g, " ⏎ ");
    const ok = acct.expect.test(url);
    results.push(
      `${ok ? "EXISTS  " : "MISSING "} ${acct.label} (${acct.email}) → ${url}` +
        (ok ? "" : `\n            page says: ${body.slice(0, 200)}`),
    );
    // Sign out state is irrelevant; next iteration re-navigates to /auth.
    await page.context().clearCookies();
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* ignore */ } });
  }

  // Now check the non-person data as an admin (who can read school-wide rows).
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email or Mobile").fill("admin@wisdomcampus.com");
  await page.locator("#signin-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForTimeout(9000);

  const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  const data = await page.evaluate(async (anon: string) => {
    let token = "";
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!/auth-token/.test(k)) continue;
      try { token = JSON.parse(localStorage.getItem(k)!)?.access_token ?? ""; } catch { /* ignore */ }
    }
    const base = "https://psqxykzqfvxgsvkmgurn.supabase.co/rest/v1";
    const q = async (p: string) => {
      const r = await fetch(`${base}/${p}`, {
        headers: { apikey: anon, Authorization: `Bearer ${token}`, Prefer: "count=exact" },
      });
      return { status: r.status, count: r.headers.get("content-range"), body: (await r.text()).slice(0, 300) };
    };
    return {
      class12: await q("classes?select=id,name,section,stream&name=eq.12"),
      class12Students: await q("students?select=id,full_name&class_id=eq.d2000001-0012-4000-8000-000000000012"),
      subjects: await q("subjects?select=id"),
      publishedExams: await q("exams?select=id&results_published_at=not.is.null"),
      calendar: await q("school_calendar_events?select=id"),
      class12Bank: await q("question_bank?select=id&is_active=is.true&class_level=eq.12&subject=eq.Mathematics"),
    };
  }, ANON);

  console.log("\n=== DEMO SEED STATE ===");
  for (const r of results) console.log("  " + r);
  console.log("");
  for (const [k, v] of Object.entries(data)) {
    const r = v as { status: number; count: string | null; body: string };
    console.log(`  ${k.padEnd(18)} HTTP ${r.status}  range=${r.count}  ${r.body.slice(0, 120)}`);
  }
  console.log("=======================\n");
});
