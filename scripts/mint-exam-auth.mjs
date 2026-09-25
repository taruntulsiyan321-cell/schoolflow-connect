/**
 * Mint e2e-evidence/.auth/exam_cuet.json without launching a browser.
 * Same session shape auth.exam.setup.ts writes after OTP/refresh.
 *
 *   node scripts/mint-exam-auth.mjs
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";

function loadEnv(name) {
  if (!existsSync(name)) return;
  for (const line of readFileSync(name, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv(".env.local");
loadEnv(".env");

const REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const URL = process.env.VITE_SUPABASE_URL || `https://${REF}.supabase.co`;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";

const SP =
  process.env.E2E_EXAM_SESSIONS_JSON ||
  "C:/Users/Tarun/AppData/Local/Temp/claude/C--Users-Tarun-Documents-Default-Project-schoolflow-connect--claude-worktrees-rulings-artifact-worktree-40d771/7a42c032-dc70-46cc-aec6-c42fcf3b6a39/scratchpad/sessions.json";

function refreshFromScratch(key) {
  if (!existsSync(SP)) return null;
  const j = JSON.parse(readFileSync(SP, "utf8"));
  return j?.roles?.[key]?.refresh_token ?? null;
}

async function mint(role) {
  const envKey = `E2E_${role.toUpperCase()}_REFRESH_TOKEN`;
  const refresh = process.env[envKey] || refreshFromScratch(role);
  if (!refresh) {
    console.error(`no refresh for ${role}`);
    return false;
  }
  if (!ANON) {
    console.error("anon key missing");
    return false;
  }
  const r = await fetch(`${URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refresh }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) {
    console.error(`${role} refresh HTTP ${r.status}:`, j.error_description || j.msg || j);
    return false;
  }
  const storageKey = `sb-${REF}-auth-token`;
  const value = {
    access_token: j.access_token,
    refresh_token: j.refresh_token,
    expires_at: j.expires_at ?? Math.floor(Date.now() / 1000) + (j.expires_in ?? 3600),
    expires_in: j.expires_in ?? 3600,
    token_type: "bearer",
    user: j.user,
  };
  mkdirSync("e2e-evidence/.auth", { recursive: true });
  const state = {
    cookies: [],
    origins: [
      {
        origin: process.env.PLAYWRIGHT_BASE_URL || "http://localhost:8099",
        localStorage: [{ name: storageKey, value: JSON.stringify(value) }],
      },
    ],
  };
  writeFileSync(`e2e-evidence/.auth/${role}.json`, JSON.stringify(state, null, 2));
  try {
    if (existsSync(SP)) {
      const sp = JSON.parse(readFileSync(SP, "utf8"));
      if (sp.roles?.[role]) {
        sp.roles[role].refresh_token = j.refresh_token;
        sp.roles[role].access_token = j.access_token;
        writeFileSync(SP, JSON.stringify(sp, null, 2));
      }
    }
  } catch {
    /* ignore */
  }
  console.log(`minted ${role} as ${j.user?.email}`);
  return true;
}

const ok = await mint("exam_cuet");
process.exit(ok ? 0 : 1);
