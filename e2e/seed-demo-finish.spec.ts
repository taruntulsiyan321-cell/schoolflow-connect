import { test } from "@playwright/test";

/**
 * Finishing pass for the demo data:
 *   1. Remove duplicate homework created by re-running the fill script (it had
 *      no natural key, so each run appended another copy of the same titles).
 *   2. Insert homework submissions in small batches — a single 263-row insert
 *      hit the statement timeout, because each row fans out through triggers.
 */

const ADMIN = "admin@wisdomcampus.com";
const PASSWORD = process.env.E2E_DEMO_PASSWORD || "DemoPass123!";

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(600000);

test("finish demo data", async ({ page }) => {
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email or Mobile").fill(ADMIN);
  await page.locator("#signin-password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/admin/, { timeout: 60000 });
  await page.waitForTimeout(3000);

  const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

  const report = await page.evaluate(async (anon: string) => {
    let token = "";
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)!;
      if (!/auth-token/.test(k)) continue;
      try { token = JSON.parse(localStorage.getItem(k)!)?.access_token ?? ""; } catch { /* ignore */ }
    }
    const B = "https://psqxykzqfvxgsvkmgurn.supabase.co/rest/v1";
    const H = (x: Record<string, string> = {}) => ({
      apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...x,
    });
    const log: string[] = [];
    const get = async (p: string) => {
      const r = await fetch(`${B}/${p}`, { headers: H() });
      const j = await r.json().catch(() => []);
      return Array.isArray(j) ? j : [];
    };

    const school = ((await get("profiles?select=school_id&limit=1"))[0] as { school_id: string })?.school_id;
    log.push(`school_id: ${school}`);

    // ---- 1. dedupe homework: keep the oldest row per (class_id, title) -----
    type Hw = { id: string; class_id: string | null; title: string; created_at: string };
    const hw = (await get(
      `homework?select=id,class_id,title,created_at&school_id=eq.${school}&order=created_at.asc`,
    )) as Hw[];
    const keep = new Map<string, string>();
    const dupes: string[] = [];
    for (const h of hw) {
      const key = `${h.class_id}|${h.title}`;
      if (keep.has(key)) dupes.push(h.id);
      else keep.set(key, h.id);
    }
    let deleted = 0;
    for (let i = 0; i < dupes.length; i += 20) {
      const batch = dupes.slice(i, i + 20);
      // Submissions reference homework; clear those for the doomed rows first.
      await fetch(`${B}/homework_submissions?homework_id=in.(${batch.join(",")})`, {
        method: "DELETE", headers: H({ Prefer: "return=minimal" }),
      });
      const r = await fetch(`${B}/homework?id=in.(${batch.join(",")})`, {
        method: "DELETE", headers: H({ Prefer: "return=minimal" }),
      });
      if (r.ok) deleted += batch.length;
      else log.push(`delete batch failed: ${r.status} ${(await r.text()).slice(0, 160)}`);
    }
    log.push(`homework: ${hw.length} rows → kept ${keep.size}, deleted ${deleted} duplicates`);

    // ---- 2. submissions, in small batches ---------------------------------
    const students = (await get(
      `students?select=id,class_id&school_id=eq.${school}`,
    )) as { id: string; class_id: string | null }[];
    const hwNow = (await get(
      `homework?select=id,class_id&school_id=eq.${school}`,
    )) as { id: string; class_id: string | null }[];
    const existing = new Set(
      ((await get(`homework_submissions?select=homework_id,student_id&school_id=eq.${school}`)) as {
        homework_id: string; student_id: string;
      }[]).map((r) => `${r.homework_id}|${r.student_id}`),
    );

    const rows: Record<string, unknown>[] = [];
    for (const h of hwNow) {
      for (const st of students.filter((s) => s.class_id && s.class_id === h.class_id)) {
        if (existing.has(`${h.id}|${st.id}`)) continue;
        const tail = parseInt(st.id.slice(-2), 16) || 0;
        if (tail % 100 >= 88) continue; // ~88% submit
        const graded = tail % 3 !== 0;
        rows.push({
          school_id: school,
          homework_id: h.id,
          student_id: st.id,
          status: graded ? "graded" : "submitted",
          submitted_at: new Date(Date.now() - ((tail % 5) + 1) * 86400000).toISOString(),
          is_late: tail % 11 === 0,
          marks_obtained: graded ? 12 + (tail % 9) : null,
          grade: graded ? ["A+", "A", "B+", "B"][tail % 4] : null,
          graded_at: graded ? new Date().toISOString() : null,
          teacher_remarks: graded
            ? ["Well presented.", "Good effort — check step 3.", "Neat work.", "Revise the last section."][tail % 4]
            : null,
          content: "Submitted through the student portal.",
        });
      }
    }

    let ok = 0;
    for (let i = 0; i < rows.length; i += 3) {
      const batch = rows.slice(i, i + 3);
      const r = await fetch(`${B}/homework_submissions`, {
        method: "POST",
        headers: H({ Prefer: "return=minimal" }),
        body: JSON.stringify(batch),
      });
      if (r.ok) ok += batch.length;
      else if (i < 6) log.push(`submission batch failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
    }
    log.push(`homework_submissions: inserted ${ok}/${rows.length}`);

    const after = {
      homework: (await get(`homework?select=id&school_id=eq.${school}`)).length,
      submissions: (await get(`homework_submissions?select=id&school_id=eq.${school}`)).length,
    };
    log.push(`AFTER: ${JSON.stringify(after)}`);
    return log;
  }, ANON);

  console.log("\n=== FINISH DEMO DATA ===");
  for (const l of report) console.log("  " + l);
  console.log("========================\n");
});
