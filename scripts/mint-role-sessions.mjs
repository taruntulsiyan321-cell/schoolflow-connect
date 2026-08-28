/**
 * G8 live-smoke gate: mint a real session per role, programmatically.
 *
 * Never types a password. Uses the auth admin API: generate_link produces a
 * one-time hashed token for an existing user, and /verify exchanges it for a
 * genuine GoTrue session. That session is what the browser is given, so the
 * smoke test exercises the app under real RLS as that role -- not as a
 * bypassing superuser (G11: never verify under a role that bypasses RLS).
 *
 * The service_role key is fetched from the management API at runtime and held
 * in memory only. It is never written to disk or printed.
 *
 * Sessions are written to the path given as argv[2] (use a scratch dir, never
 * the repo). Tokens are short-lived but are still credentials -- do not commit
 * that file.
 *
 * Exit code is non-zero if ANY role's session could not be created, so the gate
 * reports incomplete rather than passing on a partial result.
 */
import { readFileSync, existsSync, writeFileSync } from "fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const URL_BASE = process.env.VITE_SUPABASE_URL || `https://${REF}.supabase.co`;
const MGMT = process.env.SUPABASE_ACCESS_TOKEN;
const OUT = process.argv[2];

if (!MGMT) { console.error("No SUPABASE_ACCESS_TOKEN in .env.local"); process.exit(2); }
if (!OUT)  { console.error("usage: mint-role-sessions.mjs <output-json-path>"); process.exit(2); }

const ROLES = [
  ["admin",     "admin@wisdomcampus.com"],
  ["principal", "principal@wisdomcampus.com"],
  ["teacher",   "priya.sharma@wisdomcampus.com"],
  ["student",   "arjun.mehta@wisdomcampus.com"],
  ["parent",    "mehta.parent@wisdomcampus.com"],
];

const keyRes = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${MGMT}` },
});
if (!keyRes.ok) { console.error(`Could not read project API keys: HTTP ${keyRes.status}`); process.exit(1); }
const KEYS = await keyRes.json();
const SERVICE = KEYS.find((k) => k.name === "service_role")?.api_key;
// Needed as the apikey header when probing PostgREST as the minted USER:
// the service key would answer as service_role and prove nothing.
const ANON = KEYS.find((k) => k.name === "anon")?.api_key;
if (!SERVICE) { console.error("No service_role key returned"); process.exit(1); }
if (!ANON) { console.error("No anon key returned"); process.exit(1); }

const authHeaders = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  "Content-Type": "application/json",
};

async function mint(email) {
  const gen = await fetch(`${URL_BASE}/auth/v1/admin/generate_link`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ type: "magiclink", email }),
  });
  if (!gen.ok) return { error: `generate_link ${gen.status}: ${(await gen.text()).slice(0, 160)}` };

  const link = await gen.json();
  const hashed = link?.properties?.hashed_token ?? link?.hashed_token;
  const otp = link?.properties?.email_otp;
  if (!hashed && !otp) return { error: "generate_link returned no token" };

  // GoTrue takes either {type, token_hash} -- the hashed form, with NO email --
  // or {type, token, email} using the plain OTP. Mixing them returns
  // "Only an email address or phone number should be provided on verify".
  let ver = await fetch(`${URL_BASE}/auth/v1/verify`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ type: "magiclink", token_hash: hashed }),
  });

  if (!ver.ok && otp) {
    ver = await fetch(`${URL_BASE}/auth/v1/verify`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ type: "magiclink", token: otp, email }),
    });
  }
  if (!ver.ok) return { error: `verify ${ver.status}: ${(await ver.text()).slice(0, 160)}` };

  const s = await ver.json();
  if (!s?.access_token) return { error: "verify returned no access_token" };
  return { session: s };
}

/**
 * A minted token was being handed back without ever being used, so the first
 * thing to try it was the browser — and roughly once in ten runs that first
 * request came back 401 PGRST303 "JWT issued at future", failing the smoke
 * gate for a reason that had nothing to do with the app.
 *
 * The cause is not this machine's clock. Nothing here signs a token: GoTrue
 * stamps `iat`, so the local clock never enters it (measured: this machine is
 * ~1.5s BEHIND Supabase, which would make `iat` look PAST, not future).
 *
 * Measured across 16 mints, `iat` minus the validator's own Date header was
 * exactly 0 ms on nine of them and -1000 ms on the rest — the token is stamped
 * in the same second the validator is in, with no margin at all. GoTrue mints
 * and PostgREST validates on different hosts, and PostgREST rejects `iat > now`
 * with zero leeway, so a few tens of milliseconds of divergence between those
 * two hosts is enough to tip it.
 *
 * So prove the token before returning it. This is not a retry that hides a
 * failure: it retries the PROOF, inside the mint step, and if a token cannot
 * be made to work within the budget the role is reported FAILED and the script
 * exits non-zero. A gate that cannot run must fail, not skip.
 */
async function proveUsable(token, budgetMs = 4000) {
  const started = Date.now();
  let last = "";
  for (;;) {
    const r = await fetch(`${URL_BASE}/rest/v1/schools?select=id&limit=1`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    });
    if (r.ok) return { ok: true, waitedMs: Date.now() - started };
    const body = await r.json().catch(() => ({}));
    last = `HTTP ${r.status} ${body.code ?? ""} ${body.message ?? ""}`.trim();
    // Only the not-yet-valid-here case is worth waiting out. Anything else is
    // a real failure and must surface immediately rather than burn the budget.
    if (body.code !== "PGRST303") return { ok: false, error: last };
    if (Date.now() - started > budgetMs) return { ok: false, error: `${last} (still after ${budgetMs}ms)` };
    await new Promise((res) => setTimeout(res, 400));
  }
}

const out = {};
let failed = 0;
for (const [role, email] of ROLES) {
  const r = await mint(email);
  if (r.error) {
    console.log(`FAIL  ${role.padEnd(10)} ${email.padEnd(32)} ${r.error}`);
    failed++;
    continue;
  }
  const proof = await proveUsable(r.session.access_token);
  if (!proof.ok) {
    console.log(`FAIL  ${role.padEnd(10)} ${email.padEnd(32)} minted but unusable: ${proof.error}`);
    failed++;
    continue;
  }

  out[role] = {
    email,
    user_id: r.session.user?.id,
    access_token: r.session.access_token,
    refresh_token: r.session.refresh_token,
    expires_at: r.session.expires_at,
  };
  const waited = proof.waitedMs > 500 ? `, usable after ${proof.waitedMs}ms` : "";
  console.log(`OK    ${role.padEnd(10)} ${email.padEnd(32)} session minted and proven (user ${r.session.user?.id}${waited})`);
}

writeFileSync(OUT, JSON.stringify({ ref: REF, url: URL_BASE, roles: out }, null, 2));
console.log(`\n${Object.keys(out).length} of ${ROLES.length} role sessions minted -> ${OUT}`);
process.exit(failed === 0 ? 0 : 1);
