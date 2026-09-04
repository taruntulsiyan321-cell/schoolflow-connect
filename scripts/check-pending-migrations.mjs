/**
 * Probe live Supabase for migration markers. No secrets printed.
 */
import { readFileSync, existsSync } from "fs";
import { queryRows } from "./lib/readonly-db.mjs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnvFile(name) {
  const path = join(ROOT, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";

const MARKERS = [
  { id: "20260509065137", label: "Admin connect student/teacher", sql: "SELECT proname FROM pg_proc WHERE proname = 'admin_connect_student_account' LIMIT 1" },
  { id: "20260516000000", label: "Inquiries & complaints", sql: "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='admission_enquiries' LIMIT 1" },
  // Marker was `dpps`, a table this migration never created and that the DPP
  // removal deliberately dropped. It reported an applied migration as pending
  // for as long as the drop stood. `student_question_history` IS its artifact.
  { id: "20260604000000", label: "Wisdom student engine", sql: "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='student_question_history' LIMIT 1" },
  { id: "20260604010000", label: "Leaderboard RPC", sql: "SELECT proname FROM pg_proc WHERE proname = 'rpc_leaderboard' LIMIT 1" },
  { id: "20260604020000", label: "Notifications", sql: "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='notifications' LIMIT 1" },
  { id: "20260604030000", label: "Student panel fixes", sql: "SELECT proname FROM pg_proc WHERE proname = 'rpc_classmates' LIMIT 1" },
  { id: "20260604040000", label: "App settings", sql: "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='app_settings' LIMIT 1" },
  { id: "20260604070000", label: "Battleground feed + AI", sql: "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='battle_events' LIMIT 1" },
  { id: "20260604080000", label: "Battle monitor", sql: "SELECT proname FROM pg_proc WHERE proname = 'rpc_battle_monitor' LIMIT 1" },
  { id: "20260604090000", label: "Battle reports", sql: "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='battle_reports' LIMIT 1" },
  { id: "20260604100000", label: "Battleground phase 4", sql: "SELECT proname FROM pg_proc WHERE proname = 'rpc_battle_curriculum' LIMIT 1" },
  { id: "20260604120000", label: "Demo data (has students)", sql: "SELECT count(*)::int AS n FROM public.students" },
  { id: "20260605000000", label: "Student portal login", sql: "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='students' AND column_name='portal_email' LIMIT 1" },
  { id: "20260606000000", label: "Student Success Phase 1", sql: "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='student_mistakes' LIMIT 1" },
  { id: "20260607000000", label: "Student Success Phase 2", sql: "SELECT proname FROM pg_proc WHERE proname = 'rpc_parent_weekly_digest' LIMIT 1" },
  { id: "20260608000000", label: "Student Success Phase 3", sql: "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='student_improvement_plans' LIMIT 1" },
  { id: "20260609000000", label: "Quick battle overload fix", sql: "SELECT proname FROM pg_proc WHERE proname = 'rpc_create_quick_battle' AND pg_get_function_arguments(oid) LIKE '%_topic%'" },
  { id: "20260610000000", label: "Battleground overhaul", sql: "SELECT proname FROM pg_proc WHERE proname = 'rpc_create_open_battle' LIMIT 1" },
  { id: "20260611000000", label: "Question template engine", sql: "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='question_templates' LIMIT 1" },
  { id: "20260612000000", label: "AI and audit fixes", sql: "SELECT proname FROM pg_proc WHERE proname = 'rpc_ensure_battle_report' LIMIT 1" },
  { id: "20260613000000", label: "Concept mastery recovery", sql: "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='concept_mastery' LIMIT 1" },
  { id: "20260614000000", label: "Unify practice analytics", sql: "SELECT proname FROM pg_proc WHERE proname = 'rpc_student_academic_snapshot' LIMIT 1" },
  { id: "20260615000000", label: "Battle template fallback", sql: "SELECT proname FROM pg_proc WHERE proname = 'rpc_create_template_solo_battle' LIMIT 1" },
  { id: "20260616000000", label: "Revision queue fix", sql: "SELECT proname FROM pg_proc WHERE proname = '_revision_recently_completed' LIMIT 1" },
  { id: "20260617000000", label: "Practice recovery quality", sql: "SELECT proname FROM pg_proc WHERE proname = 'rpc_assign_concept_recovery' AND pg_get_function_arguments(oid) LIKE '%_concept%' LIMIT 1" },
  // 20260618000000 "Mistake triggers recovery" HAS NO MARKER, deliberately.
  //
  // Its entire content is one CREATE OR REPLACE of rpc_record_concept_mistake,
  // and four later migrations (…613, …614, …619, 20260802330000) replace that
  // same function. Whatever is in pg_proc today was installed by the last of
  // them, so no probe of the function can distinguish "…618 ran" from "…618
  // never ran and a later one did". There is no artifact to look for.
  //
  // The two probes that were here both lied, in opposite directions. The SQL
  // path looked for an `_error_type` ARGUMENT, which the function has never
  // had — permanently pending. The REST path looked for the
  // student_mistakes.error_type COLUMN, which is added by 20260619000000, so
  // it reported this migration applied whenever the NEXT one was.
  //
  // A marker that cannot fail for the right reason is worse than no marker:
  // it makes a red gate routine. The ledger is the only thing that can answer
  // for this migration, and `npm run preflight` already reads it.
  { id: "20260619000000", label: "Academic intelligence system", sql: "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='student_academic_brain' LIMIT 1" },
  { id: "20260620000000", label: "Practice session persistence fix", sql: "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='question_attempts' AND column_name='template_id' AND is_nullable='YES' LIMIT 1" },
];

// Reads through scripts/lib/readonly-db.mjs, which prefers
// CI_READONLY_DATABASE_URL (the gurukul_ci_readonly role, read-only enforced by
// the database) and falls back to the Management API locally. The `token`
// parameter is kept so every existing call site stays valid; it is unused,
// because which credential to use is now the shared module's decision rather
// than each gate's.
async function queryManagement(_token, sql) {
  return queryRows(sql);
}

async function tableExists(url, key, table, select = "id") {
  const r = await fetch(`${url}/rest/v1/${table}?select=${select}&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const body = await r.text();
  if (r.ok) return { exists: true, hasRows: body !== "[]" };
  if (r.status === 404 || body.includes("does not exist") || body.includes("Could not find"))
    return { exists: false, hasRows: false };
  if (body.includes("column") && body.includes("does not exist"))
    return { exists: true, columnMissing: true, hasRows: false };
  return { exists: false, hasRows: false, status: r.status, hint: body.slice(0, 120) };
}

async function rpcExists(url, key, fn, payload = {}) {
  const r = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await r.text();
  if (body.includes("no matches were found in the schema cache")) return false;
  if (body.includes("function") && body.includes("does not exist")) return false;
  // PGRST202/203 = present (arg mismatch or overload ambiguity); P0001 = business logic error
  if (body.includes("PGRST202") || body.includes("PGRST203")) return true;
  if (body.includes("P0001")) return true;
  return true;
}

async function probeViaRest() {
  const url = process.env.VITE_SUPABASE_URL || `https://${PROJECT_REF}.supabase.co`;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!key) throw new Error("No VITE_SUPABASE_PUBLISHABLE_KEY in .env");

  const applied = [];
  const pending = [];
  const unknown = [];

  const tableMap = {
    "20260516000000": ["admission_enquiries"],
    "20260604000000": ["dpps"],
    "20260604020000": ["notifications"],
    "20260604040000": ["app_settings"],
    "20260604070000": ["battle_events"],
    "20260604090000": ["battle_reports"],
    "20260606000000": ["student_mistakes"],
    "20260607000000": ["parent_academic_alerts"],
    "20260608000000": ["student_improvement_plans"],
    "20260611000000": ["question_templates"],
    "20260613000000": ["concept_mastery"],
    "20260619000000": ["student_academic_brain"],
  };

  const rpcMap = {
    "20260614000000": ["rpc_student_academic_snapshot", {}],
    "20260615000000": ["rpc_create_template_solo_battle", { _subject: "Mathematics" }],
    "20260616000000": ["rpc_student_revision_queue", {}],
    "20260617000000": ["rpc_assign_concept_recovery", { _concept: "Determinants", _subject: "Mathematics" }],
    "20260619000000": ["rpc_get_academic_brain", {}],
    "20260609000000": ["rpc_create_quick_battle", { _subject: "Mathematics" }],
    "20260610000000": ["rpc_create_open_battle", { _subject: "Mathematics" }],
    "20260612000000": ["rpc_ensure_battle_report", { _participant_id: "00000000-0000-0000-0000-000000000000" }],
  };

  for (const m of MARKERS) {
    const label = m.label;
    if (m.id === "20260509065137") {
      const ok = await rpcExists(url, key, "admin_connect_student_account", {
        _student_id: "00000000-0000-0000-0000-000000000000",
        _identifier: "probe@example.com",
      });
      (ok ? applied : pending).push({ id: m.id, label });
      continue;
    }
    if (m.id === "20260604010000") {
      const ok = await rpcExists(url, key, "rpc_leaderboard");
      (ok ? applied : pending).push({ id: m.id, label });
      continue;
    }
    if (m.id === "20260604030000") {
      const ok = await rpcExists(url, key, "rpc_classmates");
      (ok ? applied : pending).push({ id: m.id, label });
      continue;
    }
    if (m.id === "20260604080000") {
      const ok = await rpcExists(url, key, "rpc_battle_monitor", {
        _battle_id: "00000000-0000-0000-0000-000000000000",
      });
      (ok ? applied : pending).push({ id: m.id, label });
      continue;
    }
    if (m.id === "20260604100000") {
      const ok = await rpcExists(url, key, "rpc_battle_curriculum", { _subject: "Mathematics" });
      (ok ? applied : pending).push({ id: m.id, label });
      continue;
    }
    if (m.id === "20260607000000") {
      const ok = await rpcExists(url, key, "rpc_parent_weekly_digest");
      (ok ? applied : pending).push({ id: m.id, label });
      continue;
    }
    if (m.id === "20260605000000") {
      const pe = await tableExists(url, key, "students", "portal_email");
      (pe.exists && !pe.columnMissing ? applied : pending).push({ id: m.id, label });
      continue;
    }
    // The 20260618000000 special case is gone with its marker — see MARKERS.
    // It probed student_mistakes.error_type, which 20260619000000 adds, so it
    // answered for a different migration than the one it named.
    if (m.id === "20260604120000") {
      const st = await tableExists(url, key, "students", "id");
      (st.exists && st.hasRows ? applied : pending).push({
        id: m.id,
        label: st.exists && !st.hasRows ? label + " (schema ok, 0 rows — run demo seed)" : label,
      });
      continue;
    }
    const rpcEntry = rpcMap[m.id];
    if (rpcEntry) {
      const [rpcFn, payload] = rpcEntry;
      const ok = await rpcExists(url, key, rpcFn, payload ?? {});
      (ok ? applied : pending).push({ id: m.id, label });
      continue;
    }
    const tables = tableMap[m.id];
    if (tables) {
      const t = await tableExists(url, key, tables[0]);
      (t.exists ? applied : pending).push({ id: m.id, label });
      continue;
    }
    unknown.push({ id: m.id, label });
  }

  return { mode: "rest_anon", project: PROJECT_REF, applied, pending, unknown };
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) {
    const rest = await probeViaRest();
    console.log(JSON.stringify(rest, null, 2));
    return;
  }

  const applied = [];
  const pending = [];

  for (const m of MARKERS) {
    try {
      const rows = await queryManagement(token, m.sql);
      const ok = Array.isArray(rows) && rows.length > 0;
      let isApplied = ok;
      if (m.id === "20260604120000" && ok) {
        const n = rows[0]?.n ?? rows[0]?.count ?? 0;
        isApplied = Number(n) > 0;
      }
      (isApplied ? applied : pending).push({ id: m.id, label: m.label });
    } catch (e) {
      pending.push({ id: m.id, label: m.label, note: "check failed" });
    }
  }

  console.log(JSON.stringify({ project: PROJECT_REF, applied, pending }, null, 2));
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
