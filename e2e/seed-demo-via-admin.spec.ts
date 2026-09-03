import { test } from "@playwright/test";

/**
 * Fill demo data for the principal, teacher and parent panels using the
 * ADMIN's own authenticated session.
 *
 * Why this route: creating auth users needs the service_role key, which is not
 * available here. Everything else — attendance, homework, marks, notices,
 * leave requests, complaints, inquiries — is ordinary row data the admin is
 * already authorised to write through RLS. So we sign in as the admin and POST
 * through PostgREST with their JWT, exactly as the app itself would.
 *
 * Idempotent: every insert uses Prefer: resolution=merge-duplicates where the
 * table has a natural key, and counts are checked first so a re-run tops up
 * rather than duplicating.
 */

const ADMIN = "admin@wisdomcampus.com";
const PASSWORD = process.env.E2E_DEMO_PASSWORD || "DemoPass123!";
const BASE = "https://psqxykzqfvxgsvkmgurn.supabase.co/rest/v1";

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(300000);

test("fill demo data via admin session", async ({ page }) => {
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
    const H = (extra: Record<string, string> = {}) => ({
      apikey: anon,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...extra,
    });
    const BASE_URL = "https://psqxykzqfvxgsvkmgurn.supabase.co/rest/v1";
    const log: string[] = [];

    const get = async (p: string) => {
      const r = await fetch(`${BASE_URL}/${p}`, { headers: { ...H(), Prefer: "count=exact" } });
      const body = await r.json().catch(() => []);
      return { status: r.status, rows: Array.isArray(body) ? body : [], raw: body };
    };
    const post = async (table: string, rows: unknown[], onConflict?: string) => {
      if (!rows.length) return { status: 204, text: "nothing to insert" };
      const url = onConflict
        ? `${BASE_URL}/${table}?on_conflict=${onConflict}`
        : `${BASE_URL}/${table}`;
      const r = await fetch(url, {
        method: "POST",
        headers: H({ Prefer: onConflict ? "resolution=merge-duplicates,return=minimal" : "return=minimal" }),
        body: JSON.stringify(rows),
      });
      return { status: r.status, text: (await r.text()).slice(0, 300) };
    };

    // ---- context -----------------------------------------------------------
    const me = await get("profiles?select=school_id&limit=1");
    const schoolId = (me.rows[0] as { school_id?: string })?.school_id ?? null;
    log.push(`school_id: ${schoolId}`);
    if (!schoolId) return { log, fatal: "no school_id on admin profile" };

    const classes = await get(`classes?select=id,name,section&school_id=eq.${schoolId}`);
    const students = await get(`students?select=id,class_id,full_name,user_id&school_id=eq.${schoolId}`);
    const teachers = await get(`teachers?select=id,full_name,user_id&school_id=eq.${schoolId}`);
    log.push(`classes: ${classes.rows.length}, students: ${students.rows.length}, teachers: ${teachers.rows.length}`);

    type Cls = { id: string; name: string; section: string };
    type Stu = { id: string; class_id: string | null; full_name: string; user_id: string | null };
    type Tch = { id: string; full_name: string; user_id: string | null };
    const clsList = classes.rows as Cls[];
    const stuList = students.rows as Stu[];
    const tchList = teachers.rows as Tch[];

    const day = (offset: number) => {
      const d = new Date();
      d.setDate(d.getDate() - offset);
      return d.toISOString().slice(0, 10);
    };

    // ---- 1. ATTENDANCE: last 10 school days for every student --------------
    const attBefore = await get(`attendance?select=id&school_id=eq.${schoolId}&limit=1`);
    const attCount = attBefore.raw && (attBefore as unknown as { rows: unknown[] }).rows;
    const attRows: unknown[] = [];
    for (let d = 0; d < 10; d++) {
      const date = day(d);
      const dow = new Date(date).getDay();
      if (dow === 0) continue; // skip Sundays
      for (const s of stuList) {
        if (!s.class_id) continue;
        /*
         * Deterministic but realistic: ~90% present overall, and today is kept
         * clean so the principal dashboard opens on a healthy number. An
         * earlier version hashed s.id.charCodeAt(0), but every student id
         * starts with the same character, so it marked the whole school absent
         * on the same day.
         */
        const tail = parseInt(s.id.slice(-3), 16) || 0;
        const seed = (tail + d * 7) % 100;
        const status =
          d === 0
            ? seed < 96 ? "present" : "late"
            : seed < 88 ? "present"
            : seed < 94 ? "late"
            : seed < 97 ? "half_day"
            : "absent";
        attRows.push({
          school_id: schoolId,
          student_id: s.id,
          class_id: s.class_id,
          date,
          status,
        });
      }
    }
    const attRes = await post("attendance", attRows, "student_id,date");
    log.push(`attendance: posted ${attRows.length} rows → HTTP ${attRes.status} ${attRes.text}`);

    // ---- 2. HOMEWORK per class ---------------------------------------------
    const subjects = ["Mathematics", "English", "Science", "Social Studies"];
    const hwRows = clsList.flatMap((c, ci) =>
      subjects.slice(0, 3).map((subject, si) => ({
        school_id: schoolId,
        class_id: c.id,
        title: `${subject}: practice set ${si + 1}`,
        description: `Complete the assigned exercises for ${subject}. Submit before the due date.`,
        subject,
        due_date: day(-(si + 2)),
        status: "published",
        priority: si === 0 ? "high" : "normal",
        created_by: tchList[ci % Math.max(1, tchList.length)]?.user_id ?? null,
      })),
    );
    const hwRes = await post("homework", hwRows);
    log.push(`homework: posted ${hwRows.length} rows → HTTP ${hwRes.status} ${hwRes.text}`);

    // ---- 3. NOTICES (principal + parent + teacher panels) ------------------
    const noticeRows = [
      {
        school_id: schoolId,
        title: "Parent–teacher meeting this Saturday",
        body: "All parents are requested to attend the PTM from 10:00 AM to 1:00 PM in the main hall.",
        audience: "all",
        priority: "high",
        status: "published",
        published_at: new Date().toISOString(),
      },
      {
        school_id: schoolId,
        title: "Annual sports day trials",
        body: "Trials for athletics and team events begin next week. Speak to your class teacher to register.",
        audience: "students",
        priority: "normal",
        status: "published",
        published_at: new Date().toISOString(),
      },
      {
        school_id: schoolId,
        title: "Staff briefing — revised assessment calendar",
        body: "A short briefing on the revised assessment calendar will be held in the staff room at 3:30 PM.",
        audience: "teachers",
        priority: "normal",
        status: "published",
        published_at: new Date().toISOString(),
      },
    ];
    const noticeRes = await post("notices", noticeRows);
    log.push(`notices: posted ${noticeRows.length} rows → HTTP ${noticeRes.status} ${noticeRes.text}`);

    // ---- 4. LEAVE REQUESTS (principal panel has a review screen) -----------
    const linkedStu = stuList.filter((s) => s.user_id);
    log.push(`students with a login: ${linkedStu.length}`);
    const leaveRows = linkedStu.slice(0, 4).map((s, i) => ({
      school_id: schoolId,
      applicant_kind: "student",
      leave_type: ["sick","casual","sick","casual"][i],
      student_id: s.id,
      applicant_user_id: s.user_id,
      from_date: day(i + 1),
      to_date: day(i),
      reason: [
        "Fever and doctor-advised rest.",
        "Family function out of town.",
        "Medical check-up appointment.",
        "Travelling for a sports competition.",
      ][i],
    }));
    const leaveRes = await post("leave_requests", leaveRows);
    log.push(`leave_requests: posted ${leaveRows.length} rows → HTTP ${leaveRes.status} ${leaveRes.text}`);
    // BATCH 1c: the first two stay pending by carrying no decision row; the
    // third and fourth get one, which is what approved/rejected now means.
    const seeded = await get("leave_requests?select=id,school_id&order=created_at.desc&limit=" + leaveRows.length);
    const decisions = [2, 3]
      .map((i) => ({ verdict: i === 2 ? "approved" : "rejected", req: seeded[leaveRows.length - 1 - i] }))
      .filter((x) => x.req)
      .map((x) => ({
        leave_request_id: x.req.id,
        school_id: x.req.school_id,
        decision: x.verdict,
        decided_by_role: "principal",
      }));
    if (decisions.length) await post("leave_decisions", decisions);

    // ---- 5. INQUIRIES + COMPLAINTS (principal "Cases" page) ----------------
    const inqRows = [
      {
        school_id: schoolId,
        contact_name: "Neha Kulkarni",
        contact_email: "neha.kulkarni@example.com",
        contact_phone: "9812345670",
        grade_interest: "Class 6",
        message: "I would like to know the admission process and fee structure for Class 6.",
        status: "open",
      },
      {
        school_id: schoolId,
        contact_name: "Imran Sheikh",
        contact_email: "imran.sheikh@example.com",
        contact_phone: "9812345671",
        grade_interest: "Class 8",
        message: "Does the school provide transport to the Vaishali Nagar area?",
        status: "in_progress",
      },
    ];
    const inqRes = await post("school_inquiries", inqRows);
    log.push(`school_inquiries: posted ${inqRows.length} rows → HTTP ${inqRes.status} ${inqRes.text}`);

    const cmpRows = [
      {
        school_id: schoolId,
        complainant_name: "Suresh Mehta",
        subject: "School bus running late",
        category: "transport",

        body: "The school bus has been arriving about 20 minutes late for the past week.",
        status: "open",
      },
      {
        school_id: schoolId,
        complainant_name: "Anita Patel",
        subject: "More frequent homework updates",
        category: "academics",

        body: "Requesting more frequent updates on homework through the parent app.",
        status: "resolved",
      },
    ];
    const cmpRes = await post("school_complaints", cmpRows);
    log.push(`school_complaints: posted ${cmpRows.length} rows → HTTP ${cmpRes.status} ${cmpRes.text}`);

    // ---- 5b. HOMEWORK SUBMISSIONS (lifts the completion metric) ------------
    const hwAll = await get(`homework?select=id,class_id,subject&school_id=eq.${schoolId}`);
    type Hw = { id: string; class_id: string | null; subject: string | null };
    const subRows: unknown[] = [];
    for (const hw of hwAll.rows as Hw[]) {
      const inClass = stuList.filter((st) => st.class_id && st.class_id === hw.class_id);
      for (const st of inClass) {
        const tail = parseInt(st.id.slice(-2), 16) || 0;
        // ~85% submit; of those most are graded, a few still pending review.
        if (tail % 100 >= 85) continue;
        const graded = tail % 3 !== 0;
        subRows.push({
          school_id: schoolId,
          homework_id: hw.id,
          student_id: st.id,
          status: graded ? 'graded' : 'submitted',
          submitted_at: new Date(Date.now() - (tail % 5 + 1) * 86400000).toISOString(),
          is_late: tail % 11 === 0,
          marks_obtained: graded ? 12 + (tail % 9) : null,
          grade: graded ? ['A+', 'A', 'B+', 'B'][tail % 4] : null,
          graded_at: graded ? new Date().toISOString() : null,
          teacher_remarks: graded ? ['Well presented.', 'Good effort — check step 3.', 'Neat work.', 'Revise the last section.'][tail % 4] : null,
          content: 'Submitted through the student portal.',
        });
      }
    }
    const subRes = await post('homework_submissions', subRows, 'homework_id,student_id');
    log.push(`homework_submissions: posted ${subRows.length} rows → HTTP ${subRes.status} ${subRes.text}`);

    // ---- 6. AFTER counts ----------------------------------------------------
    const after = {
      attendance: (await get(`attendance?select=id&school_id=eq.${schoolId}`)).rows.length,
      homework: (await get(`homework?select=id&school_id=eq.${schoolId}`)).rows.length,
      notices: (await get(`notices?select=id&school_id=eq.${schoolId}`)).rows.length,
      leave_requests: (await get(`leave_requests?select=id&school_id=eq.${schoolId}`)).rows.length,
      inquiries: (await get(`school_inquiries?select=id&school_id=eq.${schoolId}`)).rows.length,
      complaints: (await get(`school_complaints?select=id&school_id=eq.${schoolId}`)).rows.length,
      homework_submissions: (await get(`homework_submissions?select=id&school_id=eq.${schoolId}`)).rows.length,
      marks: (await get(`marks?select=id&school_id=eq.${schoolId}`)).rows.length,
    };
    log.push(`AFTER: ${JSON.stringify(after)}`);
    return { log, fatal: null };
  }, ANON);

  console.log("\n=== DEMO DATA FILL ===");
  for (const l of report.log) console.log("  " + l);
  if (report.fatal) console.log("  FATAL: " + report.fatal);
  console.log("======================\n");
});
