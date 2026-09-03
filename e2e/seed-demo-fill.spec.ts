import { test, expect } from "@playwright/test";

/**
 * Fill demo data for the principal, parent and teacher panels.
 *
 * Writes through the real PostgREST API as the real demo users, so every row
 * goes through the same RLS the app does — no service-role key involved (none
 * is available in this environment).
 *
 * Idempotent: it reads what already exists and inserts only what is missing,
 * so re-running adds nothing.
 */

const PASSWORD = "DemoPass123!";
const BASE = "https://psqxykzqfvxgsvkmgurn.supabase.co/rest/v1";
const SCHOOL = "00000000-0000-4000-8000-000000000001";
const CLASS_10A = "d2000001-0001-4000-8000-000000000001";

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(300000);

async function login(page: import("@playwright/test").Page, email: string, url: RegExp, pw = PASSWORD) {
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Email or Mobile").fill(email);
  await page.locator("#signin-password").fill(pw);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page, `sign-in ${email}`).toHaveURL(url, { timeout: 60000 });
  await page.waitForTimeout(2500);
}

test("fill demo data", async ({ page }) => {
  const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";

  // ---- pass 1: admin writes everything RLS lets an admin write ----------
  await login(page, "admin@wisdomcampus.com", /\/admin/);

  const adminLog = await page.evaluate(
    async ([anon, BASE, SCHOOL, CLASS_10A]: string[]) => {
      let token = "";
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (!/auth-token/.test(k)) continue;
        try { token = JSON.parse(localStorage.getItem(k)!)?.access_token ?? ""; } catch { /* ignore */ }
      }
      const H = { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const log: string[] = [];

      const get = async (p: string) => {
        const r = await fetch(`${BASE}/${p}`, { headers: H });
        return r.ok ? JSON.parse(await r.text()) : [];
      };
      const post = async (table: string, rows: unknown[]) => {
        if (!rows.length) return log.push(`${table}: nothing to add`);
        const r = await fetch(`${BASE}/${table}`, {
          method: "POST",
          headers: { ...H, Prefer: "return=minimal" },
          body: JSON.stringify(rows),
        });
        log.push(`${table}: +${rows.length} → HTTP ${r.status}${r.ok ? "" : " " + (await r.text()).slice(0, 240)}`);
      };

      const students: Array<{ id: string; full_name: string; class_id: string | null; user_id: string | null }> =
        await get(`students?select=id,full_name,class_id,user_id&class_id=eq.${CLASS_10A}&order=roll_number`);
      const exams: Array<{ id: string; name: string; max_marks: number; class_id: string }> =
        await get(`exams?select=id,name,max_marks,class_id&class_id=eq.${CLASS_10A}`);
      const homework: Array<{ id: string; title: string }> =
        await get(`homework?select=id,title&class_id=eq.${CLASS_10A}`);
      log.push(`refs: ${students.length} students, ${exams.length} exams, ${homework.length} homework`);

      // ---- marks: every 10-A student in every 10-A exam -------------------
      const existingMarks: Array<{ exam_id: string; student_id: string }> =
        await get("marks?select=exam_id,student_id");
      const haveMark = new Set(existingMarks.map((m) => `${m.exam_id}|${m.student_id}`));
      const REMARKS = [
        "Excellent grasp of fundamentals.",
        "Good effort — watch calculation slips.",
        "Solid work. Revise the last chapter.",
        "Improving steadily. Keep practising.",
        "Needs more practice on word problems.",
        "Strong reasoning, presentation can improve.",
      ];
      const newMarks: unknown[] = [];
      exams.forEach((ex) => {
        students.forEach((s, i) => {
          if (haveMark.has(`${ex.id}|${s.id}`)) return;
          // Spread 55%–95% deterministically so charts look real, not random.
          const pct = 55 + ((i * 7 + ex.max_marks) % 41);
          newMarks.push({
            exam_id: ex.id,
            student_id: s.id,
            marks_obtained: Math.round((pct / 100) * ex.max_marks),
            remarks: REMARKS[i % REMARKS.length],
            school_id: SCHOOL,
          });
        });
      });
      await post("marks", newMarks);

      // ---- homework submissions: mix of submitted / graded ----------------
      const existingSubs: Array<{ homework_id: string; student_id: string }> =
        await get("homework_submissions?select=homework_id,student_id");
      const haveSub = new Set(existingSubs.map((s) => `${s.homework_id}|${s.student_id}`));
      const GRADES = ["A+", "A", "B+", "B", "A", "B+"];
      const newSubs: unknown[] = [];
      homework.slice(0, 3).forEach((hw, hi) => {
        students.forEach((s, i) => {
          if (haveSub.has(`${hw.id}|${s.id}`)) return;
          const graded = (i + hi) % 3 !== 0;
          newSubs.push({
            homework_id: hw.id,
            student_id: s.id,
            content: graded ? "Completed all questions with working shown." : "Submitted — pending review",
            status: graded ? "graded" : "submitted",
            grade: graded ? GRADES[i % GRADES.length] : null,
            teacher_remarks: graded ? "Well presented. Check step 3 in Q4." : null,
            submitted_at: new Date(Date.now() - (i + 1) * 36e5).toISOString(),
            graded_at: graded ? new Date(Date.now() - i * 18e5).toISOString() : null,
            is_late: i % 5 === 0,
            school_id: SCHOOL,
          });
        });
      });
      await post("homework_submissions", newSubs);

      // ---- principal: Inquiries & Complaints ------------------------------
      const inqCount = (await get("admission_enquiries?select=id")).length;
      if (inqCount < 5) {
        await post("admission_enquiries", [
          { contact_name: "Meena Kulkarni", contact_phone: "9822011223", contact_email: "meena.k@example.com", grade_interest: "Class 6", message: "Looking for admission for my daughter from next session. Do you offer a bus route to Kothrud?", status: "open", school_id: SCHOOL },
          { contact_name: "Farhan Qureshi", contact_phone: "9700456712", contact_email: "farhan.q@example.com", grade_interest: "Class 11 Commerce", message: "Enquiring about the commerce stream and Accountancy faculty.", status: "in_progress", school_id: SCHOOL },
          { contact_name: "Lata Menon", contact_phone: "9611223344", contact_email: "lata.menon@example.com", grade_interest: "Class 1", message: "What documents are needed for first-standard admission?", status: "resolved", school_id: SCHOOL },
          { contact_name: "Devendra Rathore", contact_phone: "9945667788", contact_email: "d.rathore@example.com", grade_interest: "Class 9", message: "Transfer case from Jaipur. Is a mid-session seat available?", status: "open", school_id: SCHOOL },
        ]);
      } else log.push("admission_enquiries: already has " + inqCount);

      const compCount = (await get("school_complaints?select=id")).length;
      if (compCount < 4) {
        await post("school_complaints", [
          { subject: "School bus running late", body: "Route 4 has arrived 20+ minutes late three times this week.", category: "transport", complainant_name: "Suresh Mehta", status: "open", school_id: SCHOOL },
          { subject: "Maths homework load", body: "Requesting a review of daily homework volume for Class 10-A.", category: "academics", complainant_name: "Anita Patel", status: "in_progress", school_id: SCHOOL },
          { subject: "Broken water cooler on 2nd floor", body: "The cooler outside the science lab has been out of order since Monday.", category: "facilities", complainant_name: "Rajesh Verma", status: "resolved", resolution_notes: "Replaced on 22 Aug; verified working.", school_id: SCHOOL },
        ]);
      } else log.push("school_complaints: already has " + compCount);

      // ---- principal + teacher: leave requests ----------------------------
      const leaveCount = (await get("leave_requests?select=id")).length;
      if (leaveCount < 7) {
        const withUser = students.filter((s) => s.user_id);
        const rows: unknown[] = [];
        const specs = [
          { kind: "student", type: "sick", from: "2026-08-25", to: "2026-08-26", reason: "Viral fever, advised rest by doctor.", status: "pending" },
          { kind: "student", type: "family", from: "2026-08-28", to: "2026-08-29", reason: "Elder sister's wedding, out of town.", status: "pending" },
          { kind: "student", type: "sick", from: "2026-08-19", to: "2026-08-19", reason: "Dental surgery appointment.", status: "approved" },
          { kind: "student", type: "other", from: "2026-08-14", to: "2026-08-16", reason: "Inter-school chess championship.", status: "approved" },
        ];
        withUser.slice(0, specs.length).forEach((s, i) => {
          const sp = specs[i];
          rows.push({
            applicant_user_id: s.user_id,
            applicant_kind: "student",
            student_id: s.id,
            class_id: CLASS_10A,
            leave_type: sp.type,
            from_date: sp.from,
            to_date: sp.to,
            reason: sp.reason,
            school_id: SCHOOL,
          });
        });
        await post("leave_requests", rows);
        // BATCH 1c: a verdict is a row in leave_decisions, and pending is the
        // absence of one — so only the two decided specs get a decision row.
        const created = await get("leave_requests?select=id,school_id&order=created_at.desc&limit=" + rows.length);
        const decided = specs
          .map((sp, i) => ({ sp, req: created[rows.length - 1 - i] }))
          .filter((x) => x.sp.status !== "pending" && x.req)
          .map((x) => ({
            leave_request_id: x.req.id,
            school_id: x.req.school_id,
            decision: x.sp.status,
            decided_by_role: "principal",
          }));
        if (decided.length) await post("leave_decisions", decided);
      } else log.push("leave_requests: already has " + leaveCount);

      return log;
    },
    [ANON, BASE, SCHOOL, CLASS_10A],
  );

  console.log("\n=== ADMIN PASS ===");
  for (const l of adminLog) console.log("  " + l);

  // ---- pass 2: teacher writes teacher_remarks (RLS is teacher-scoped) ----
  await login(page, "priya.sharma@wisdomcampus.com", /\/teacher/);
  const teacherLog = await page.evaluate(
    async ([anon, BASE, SCHOOL, CLASS_10A]: string[]) => {
      let token = "";
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (!/auth-token/.test(k)) continue;
        try { token = JSON.parse(localStorage.getItem(k)!)?.access_token ?? ""; } catch { /* ignore */ }
      }
      const H = { apikey: anon, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
      const log: string[] = [];
      const get = async (p: string) => {
        const r = await fetch(`${BASE}/${p}`, { headers: H });
        return r.ok ? JSON.parse(await r.text()) : [];
      };

      const existing = await get("teacher_remarks?select=id");
      if (existing.length >= 6) return [`teacher_remarks: already has ${existing.length}`];

      const me = await get("teachers?select=id,full_name&user_id=eq." +
        JSON.parse(atob(token.split(".")[1])).sub);
      if (!me.length) return ["teacher_remarks: could not resolve teacher row"];
      const teacherId = me[0].id;

      const students = await get(`students?select=id,full_name&class_id=eq.${CLASS_10A}&order=roll_number`);
      const BODIES = [
        "Consistently prepared for class. Asks precise questions.",
        "Strong in algebra; encourage more geometry practice.",
        "Participation has improved noticeably this month.",
        "Homework is neat but often submitted late — please monitor.",
        "Excellent progress since the last unit test.",
        "Confident with concepts, needs speed practice for exams.",
      ];
      const rows = students.slice(0, 6).map((s: { id: string }, i: number) => ({
        student_id: s.id,
        teacher_id: teacherId,
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
      log.push(`teacher_remarks: +${rows.length} → HTTP ${r.status}${r.ok ? "" : " " + (await r.text()).slice(0, 240)}`);
      return log;
    },
    [ANON, BASE, SCHOOL, CLASS_10A],
  );

  console.log("\n=== TEACHER PASS ===");
  for (const l of teacherLog) console.log("  " + l);
  console.log("");
});
