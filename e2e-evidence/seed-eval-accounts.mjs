/**
 * Seed the two demo accounts the evidence harness needs but the product seed
 * omits: a super_admin, and a DUAL-ROLE teacher+parent at the same school.
 *
 * Same shape as SEED_DEMO_DATA.sql (fixed demo UUIDs, DemoPass123!, the owner-
 * only helpers `_demo_upsert_auth_user` and `_grant_membership`), so the same
 * email+password harness reaches them and `strip-demo-tenants.mjs` cleans them
 * up (both hold memberships in demo school ...001, which is that script's
 * coverage predicate). Idempotent. Runs via the Management API with the
 * SUPABASE_ACCESS_TOKEN in .env.local — no service key, no product-seed edit.
 *
 * Usage: node e2e-evidence/seed-eval-accounts.mjs
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
function loadEnv(name) {
  const p = join(ROOT, name)
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!m || process.env[m[1]] !== undefined) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    process.env[m[1]] = v
  }
}
loadEnv('.env.local')
loadEnv('.env')

const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || 'psqxykzqfvxgsvkmgurn'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN
if (!TOKEN) {
  console.error('BLOCKED: no SUPABASE_ACCESS_TOKEN in .env.local')
  process.exit(2)
}

async function sql(query, label) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${label}: API ${res.status}: ${text.slice(0, 500)}`)
  return JSON.parse(text)
}

const DEMO_SCHOOL = '00000000-0000-4000-8000-000000000001'
const U_SUPER = 'd1000005-0001-4000-8000-000000000001'
const U_DUAL = 'd1000005-0002-4000-8000-000000000002'
const T_DUAL = 'd3000002-0009-4000-8000-000000000009' // teachers.id for the dual account
const C10A = 'd2000001-0001-4000-8000-000000000001'

// Inline auth-user creation (the product seed's _demo_upsert_auth_user helper is
// not persisted in this project). Same columns; idempotent.
const authUser = (uid, email, name) => `
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token)
VALUES ('${uid}'::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  '${email}', extensions.crypt('DemoPass123!', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', '${name}'),
  now(), now(), '', '', '', '')
ON CONFLICT (id) DO UPDATE SET
  encrypted_password = EXCLUDED.encrypted_password,
  email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()),
  raw_user_meta_data = EXCLUDED.raw_user_meta_data, updated_at = now();
INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
SELECT extensions.gen_random_uuid(), '${uid}'::uuid,
  jsonb_build_object('sub', '${uid}', 'email', '${email}'), 'email', '${uid}', now(), now(), now()
WHERE NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = '${uid}'::uuid AND provider = 'email');
INSERT INTO public.profiles (id, full_name, email, school_id) VALUES ('${uid}'::uuid, '${name}', '${email}', '${DEMO_SCHOOL}'::uuid)
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email, school_id = EXCLUDED.school_id;
`

// Dual-role teacher+parent via the supported membership path (two grants).
const seedDual = `
BEGIN;
${authUser(U_DUAL, 'dual.role@wisdomcampus.com', 'Eval Dual TeacherParent')}
INSERT INTO public.teachers (id, school_id, user_id, full_name, subject, mobile, email, is_class_teacher, status)
  VALUES ('${T_DUAL}'::uuid, '${DEMO_SCHOOL}'::uuid, '${U_DUAL}'::uuid, 'Eval Dual TeacherParent', 'Computer Science', '9876509999', 'dual.role@wisdomcampus.com', false, 'active')
  ON CONFLICT (id) DO UPDATE SET user_id = EXCLUDED.user_id, full_name = EXCLUDED.full_name;
INSERT INTO public.teacher_classes (teacher_id, class_id, subject)
  VALUES ('${T_DUAL}'::uuid, '${C10A}'::uuid, 'Computer Science')
  ON CONFLICT (teacher_id, class_id, subject) DO NOTHING;
SELECT public._grant_membership('${U_DUAL}'::uuid, '${DEMO_SCHOOL}'::uuid, 'teacher'::public.app_role, '${T_DUAL}'::uuid);
SELECT public._grant_membership('${U_DUAL}'::uuid, '${DEMO_SCHOOL}'::uuid, 'parent'::public.app_role);
COMMIT;
`

// super_admin is a PLATFORM role in public.super_admins (memberships forbid it via
// CHECK memberships_role_not_super). Needs an accounts row + a super_admins row.
// profiles.school_id is set (above) so strip-demo-tenants still covers it.
const seedSuper = `
BEGIN;
${authUser(U_SUPER, 'superadmin@wisdomcampus.com', 'Eval Super Admin')}
INSERT INTO public.accounts (id) VALUES ('${U_SUPER}'::uuid) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.super_admins (account_id) VALUES ('${U_SUPER}'::uuid)
  ON CONFLICT (account_id) DO UPDATE SET revoked_at = NULL;
COMMIT;
`

// Exactly strip-demo-tenants.mjs's DEMO_ACCOUNTS predicate: northfield email OR
// a membership in a demo school OR a profile in a demo school.
const coverage = `
SELECT u.email,
  ( u.email LIKE '%@northfield.test'
    OR EXISTS (SELECT 1 FROM public.memberships m WHERE m.account_id = u.id AND m.school_id = '${DEMO_SCHOOL}'::uuid)
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u.id AND p.school_id = '${DEMO_SCHOOL}'::uuid)
  ) AS strip_covered,
  COALESCE((SELECT string_agg(role::text, '+' ORDER BY role::text) FROM public.memberships m WHERE m.account_id = u.id), '') AS memberships,
  EXISTS (SELECT 1 FROM public.super_admins sa WHERE sa.account_id = u.id AND sa.revoked_at IS NULL) AS is_super_admin
FROM auth.users u WHERE u.id IN ('${U_SUPER}'::uuid, '${U_DUAL}'::uuid) ORDER BY u.email;
`

console.log('Seeding dual-role teacher+parent…')
await sql(seedDual, 'seedDual')
console.log('Seeding super_admin (platform role)…')
await sql(seedSuper, 'seedSuper')

const rows = await sql(coverage, 'coverage')
console.log('\nResult:')
for (const r of rows) {
  const roles = [r.memberships, r.is_super_admin ? 'super_admin(platform)' : ''].filter(Boolean).join('+')
  console.log(`  ${r.email.padEnd(30)} roles=${roles.padEnd(34)} strip-demo-tenants covered=${r.strip_covered}`)
}
const allCovered = rows.every((r) => r.strip_covered === true)
console.log(`\n${allCovered ? 'PASS' : 'FAIL'}: both accounts ${allCovered ? 'fall inside' : 'are NOT inside'} strip-demo-tenants.mjs cleanup coverage.`)
process.exit(allCovered ? 0 : 1)
