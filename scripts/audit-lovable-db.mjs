/**
 * Audit Lovable live DB (kdmjipeksjdyojjdokbi) vs repo migrations.
 * Run: node scripts/audit-lovable-db.mjs
 */
const url = "https://kdmjipeksjdyojjdokbi.supabase.co";
const key =
  process.env.LOVABLE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtkbWppcGVrc2pkeW9qamRva2JpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3ODc3MDEsImV4cCI6MjA5MzM2MzcwMX0.f_AXEMCKhfzG116A5wu_QdR6oYZdgbFc46WyCZZwev4";
const h = { apikey: key, Authorization: `Bearer ${key}` };

async function table(t, sel = "id") {
  const r = await fetch(`${url}/rest/v1/${t}?select=${sel}&limit=1`, { headers: h });
  const b = await r.text();
  if (r.status === 404 || b.includes("schema cache") || b.includes("Could not find"))
    return { ok: false, rows: false };
  if (b.includes("column") && b.includes("does not exist")) return { ok: true, colMissing: true, rows: false };
  return { ok: true, rows: b !== "[]" };
}

async function rpc(fn, body = {}) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { ...h, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const b = await r.text();
  if (b.includes("no matches were found in the schema cache")) return false;
  if (b.includes("function") && b.includes("does not exist")) return false;
  return true;
}

async function rowCount(t) {
  const r = await fetch(`${url}/rest/v1/${t}?select=id`, {
    headers: { ...h, Prefer: "count=exact" },
    method: "HEAD",
  });
  const cr = r.headers.get("content-range");
  if (!cr) return null;
  const m = cr.match(/\/(\d+)/);
  return m ? Number(m[1]) : null;
}

const CHECKS = [
  { file: "20260503084352_e68c54b3-....sql", label: "Core schema", test: async () => (await table("profiles")).ok },
  { file: "20260503085055_....sql", label: "Fees", test: async () => (await table("fees")).ok },
  { file: "20260503093058_....sql", label: "Phone OTP", test: async () => (await table("phone_otps")).ok },
  { file: "20260504001143_....sql", label: "Admin assign role", test: async () => rpc("admin_assign_role") },
  { file: "20260505005850_....sql", label: "Leave requests", test: async () => (await table("leave_requests")).ok },
  { file: "20260507070000_homework_tables.sql", label: "Homework", test: async () => (await table("homework")).ok },
  { file: "20260507070100_library_tables.sql", label: "Library", test: async () => (await table("library_books")).ok },
  { file: "20260507070200_messages_table.sql", label: "Messages", test: async () => (await table("messages")).ok },
  { file: "20260507070300_chat_rpc.sql", label: "Chat RPC", test: async () => rpc("get_chat_contacts") },
  { file: "20260507070600_notices_expiration.sql", label: "Notices expires_at", test: async () => !(await table("notices", "expires_at")).colMissing },
  { file: "20260508000000_auto_link_user.sql", label: "Portal auto-link", test: async () => rpc("link_portal_on_auth") },
  { file: "20260509043436_....sql", label: "Teacher employee_id", test: async () => !(await table("teachers", "employee_id")).colMissing },
  { file: "20260509063855_....sql", label: "ensure_default_role", test: async () => rpc("ensure_default_role") },
  { file: "20260509064250_....sql", label: "Attendance locks", test: async () => (await table("attendance_locks")).ok },
  { file: "20260509065137_....sql", label: "Admin connect student", test: async () =>
    rpc("admin_connect_student_account", { _student_id: "00000000-0000-0000-0000-000000000000", _identifier: "x@y.com" }) },
  { file: "20260511074536_....sql", label: "Classes batch kind", test: async () => !(await table("classes", "kind")).colMissing },
  { file: "20260512000319_....sql", label: "Battles + XP", test: async () => (await table("battles")).ok && (await table("student_xp")).ok },
  { file: "20260513003852_....sql", label: "Question bank", test: async () => (await table("question_bank")).ok },
  { file: "20260514005018_....sql", label: "DPP tables", test: async () => (await table("dpps")).ok },
  { file: "20260516000000_inquiries_complaints.sql", label: "Inquiries", test: async () => (await table("school_inquiries")).ok },
  { file: "20260604000000_wisdom_student_engine.sql", label: "Wisdom engine", test: async () => (await table("student_question_history")).ok },
  { file: "20260604010000_leaderboard_rpc.sql", label: "Leaderboard", test: async () => rpc("rpc_leaderboard") },
  { file: "20260604020000_notifications.sql", label: "Notifications", test: async () => (await table("notifications")).ok },
  { file: "20260604030000_student_panel_fixes.sql", label: "Student panel", test: async () => rpc("rpc_classmates") },
  { file: "20260604040000_app_settings.sql", label: "App settings", test: async () => (await table("app_settings")).ok },
  { file: "20260604060340_....sql", label: "Class timetables", test: async () => (await table("class_timetables")).ok },
  { file: "20260604070000_battleground_feed_ai.sql", label: "Battle events", test: async () => (await table("battle_events")).ok },
  { file: "20260604080000_battle_monitor.sql", label: "Battle monitor", test: async () =>
    rpc("rpc_battle_monitor", { _battle_id: "00000000-0000-0000-0000-000000000000" }) },
  { file: "20260604090000_battle_reports.sql", label: "Battle reports", test: async () => (await table("battle_reports")).ok },
  { file: "20260604100000_battleground_phase4.sql", label: "Battle curriculum", test: async () => rpc("rpc_battle_curriculum", { _subject: "Mathematics" }) },
  { file: "20260604120000_demo_data.sql", label: "Demo data (5+ students)", test: async () => { const n = await rowCount("students"); return n !== null && n >= 5; } },
  { file: "20260605000000_student_portal_login.sql", label: "Portal email column", test: async () => !(await table("students", "portal_email")).colMissing },
  { file: "20260606000000_student_success_platform.sql", label: "Mistake bank", test: async () => (await table("student_mistakes")).ok },
  { file: "20260607000000_student_success_phase2.sql", label: "Parent alerts", test: async () => (await table("parent_academic_alerts")).ok },
  { file: "20260608000000_student_success_phase3.sql", label: "Improvement plans", test: async () => (await table("student_improvement_plans")).ok },
  { file: "20260609000000_fix_quick_battle_overload.sql", label: "Quick battle RPC", test: async () => rpc("rpc_create_quick_battle", { _subject: "Mathematics" }) },
  { file: "20260610000000_battleground_overhaul.sql", label: "Open battle RPC", test: async () => rpc("rpc_create_open_battle", { _subject: "Mathematics" }) },
  { file: "20260611000000_question_template_engine.sql", label: "Question templates table", test: async () => (await table("question_templates")).ok },
  { file: "20260612000000_ai_and_audit_fixes.sql", label: "Ensure battle report", test: async () =>
    rpc("rpc_ensure_battle_report", { _participant_id: "00000000-0000-0000-0000-000000000000" }) },
  { file: "20260613000000_concept_mastery_recovery.sql", label: "Concept mastery", test: async () =>
    (await table("concept_mastery")).ok && (await table("recovery_assignments")).ok },
  { file: "class12_math_templates.sql (seed)", label: "Math templates 1000+ rows", test: async () => { const n = await rowCount("question_templates"); return n !== null && n >= 1000; } },
];

const DUPLICATE_ONLY = [
  "20260605020836_303936bd-af31-4eec-ab35-ea5bfa218d76.sql",
  "20260605020942_caa2600b-6a56-4160-8082-76061a292656.sql",
  "20260605021012_d4548514-27d6-4672-8071-0c7450589756.sql",
  "20260605021124_d3dea4be-7879-412e-a009-253499a419b5.sql",
  "20260605021158_51deddcd-c034-45ed-85fd-57a9d1bfacdd.sql",
  "20260607033426_44e6c2c6-c95e-4dc5-9444-9cf9ce5a4758.sql",
];

const applied = [];
const pending = [];

for (const c of CHECKS) {
  let ok = false;
  try {
    ok = await c.test();
  } catch {
    ok = false;
  }
  (ok ? applied : pending).push({ file: c.file, label: c.label });
}

console.log(
  JSON.stringify(
    {
      project: "kdmjipeksjdyojjdokbi",
      lovable: true,
      appliedCount: applied.length,
      pendingCount: pending.length,
      applied,
      pending,
      duplicateFilesInRepo_skipThese: DUPLICATE_ONLY,
      repoTotalMigrationFiles: 53,
    },
    null,
    2,
  ),
);
