import { test, expect } from "@playwright/test";

/**
 * teacher_remarks is empty and is what the parent "Academic Insights" and the
 * teacher's student view read. RLS scopes writes to the owning teacher, so
 * this runs as the real class teacher rather than as admin.
 */
const BASE = "https://psqxykzqfvxgsvkmgurn.supabase.co/rest/v1";
const SCHOOL = "00000000-0000-4000-8000-000000000001";
const CLASS_10A = "d2000001-0001-4000-8000-000000000001";

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(180000);

test("seed teacher remarks", async ({ page }) => {
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email or Mobile").fill("priya.sharma@wisdomcampus.com");
  await page.locator("#signin-password").fill("DemoPass123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/teacher/, { timeout: 60000 });
  await page.waitForTimeout(3000);

  const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
  const log = await page.evaluate(
    async ([anon, BASE, SCHOOL, CLASS_10A]: string[]) => {
      let token = "";
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (!/auth-token/.test(k)) continue;
        try { token = JSON.parse(localStorage.getItem(k)!)?.access_token ?? ""; } catch { /* ignore */ }
      }
      const H = { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const out: string[] = [];
      const get = async (p: string) => {
        const r = await fetch(`${BASE}/${p}`, { headers: H });
        return r.ok ? JSON.parse(await r.text()) : [];
      };

      const existing = await get("teacher_remarks?select=id");
      if (existing.length >= 6) return [`teacher_remarks: already has ${existing.length}`];

      const uid = JSON.parse(atob(token.split(".")[1])).sub;
      const me = await get(`teachers?select=id,full_name&user_id=eq.${uid}`);
      if (!me.length) return ["could not resolve teacher row for " + uid];
      out.push(`teacher: ${me[0].full_name}`);

      const students = await get(
        `students?select=id,full_name&class_id=eq.${CLASS_10A}&order=roll_number`,
      );
      const BODIES = [
        "Consistently prepared for class and asks precise questions.",
        "Strong in algebra; encourage more geometry practice at home.",
        "Participation has improved noticeably this month.",
        "Work is neat but often submitted late — please monitor at home.",
        "Excellent progress since the last unit test. Keep it up.",
        "Confident with concepts; needs timed practice before exams.",
      ];
      const rows = students.slice(0, 6).map((s: { id: string }, i: number) => ({
        student_id: s.id,
        teacher_id: me[0].id,
        class_id: CLASS_10A,
        body: BODIES[i % BODIES.length],
        remark_type: i % 3 === 0 ? "concern" : "praise",
        visibility: "parent",
        school_id: SCHOOL,
      }));

      const r = await fetch(`${BASE}/teacher_remarks`, {
        method: "POST",
        headers: { ...H, Prefer: "return=minimal" },
        body: JSON.stringify(rows),
      });
      out.push(
        `teacher_remarks: +${rows.length} → HTTP ${r.status}` +
          (r.ok ? "" : " " + (await r.text()).slice(0, 300)),
      );
      return out;
    },
    [ANON, BASE, SCHOOL, CLASS_10A],
  );

  console.log("\n=== TEACHER REMARKS ===");
  for (const l of log) console.log("  " + l);
  console.log("");
});
