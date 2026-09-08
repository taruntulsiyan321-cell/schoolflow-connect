import { test, expect } from "@playwright/test";

/** Learn column shapes + reference ids so the seed inserts are correct. */
test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180000);

test("probe", async ({ page }) => {
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
    const g = async (p: string) => {
      const r = await fetch(`${base}/${p}`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
      return { s: r.status, b: (await r.text()).slice(0, 1200) };
    };
    return {
      sampleInquiry: await g("school_inquiries?select=*&limit=1"),
      sampleComplaint: await g("school_complaints?select=*&limit=1"),
      sampleLeave: await g("leave_requests?select=*&limit=1"),
      sampleMark: await g("marks?select=*&limit=1"),
      sampleSubmission: await g("homework_submissions?select=*&limit=1"),
      students: await g("students?select=id,full_name,class_id,school_id,user_id&order=roll_number"),
      classes: await g("classes?select=id,name,section,school_id"),
      exams: await g("exams?select=id,name,subject,class_id,max_marks,school_id"),
      teachers: await g("teachers?select=id,full_name,user_id,school_id"),
      homework: await g("homework?select=id,title,class_id,subject,school_id&limit=8"),
    };
  }, ANON);

  console.log("\n=== PROBE ===");
  for (const [k, v] of Object.entries(out)) {
    const r = v as { s: number; b: string };
    console.log(`\n--- ${k} [${r.s}] ---\n${r.b}`);
  }
  console.log("\n=============\n");
});
