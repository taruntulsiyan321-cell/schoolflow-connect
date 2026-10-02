/**
 * Organisation accounts cannot sign in to the live app (ruled 2026-10-01).
 *
 *   node scripts/organisation-logins.mjs             status — reads only
 *   node scripts/organisation-logins.mjs --block     ban them and end their sessions
 *   node scripts/organisation-logins.mjs --unblock   lift exactly that ban
 *
 * The live app is the individual student panel; the school side (admin,
 * principal, teacher, parent, super admin and school students) is kept on the
 * `organisation` branch. Its screens are gone from the app, but its accounts
 * could still sign in and call the database directly, so they are blocked at
 * the server too. Nothing is deleted: the accounts, their rows and their
 * memberships all stay, and --unblock restores sign-in exactly.
 *
 * WHO — computed from the database each run, never listed by hand:
 *   · every account with a membership or a profile in a school of kind 'school';
 *   · every account holding admin, principal, teacher, parent or super_admin in
 *     user_roles;
 *   · every active super admin (public.super_admins, revoked_at null).
 * It refuses to block if any of them is also an individual account.
 *
 * HOW — auth.users.banned_until, the column the Auth admin API's ban_duration
 * sets; Auth refuses sign-in and token refresh while it is in the future.
 * --block sets it to BAN_MARK and deletes the accounts' sessions (their refresh
 * tokens go with them), so a session open now ends at its next refresh — at
 * most one access-token lifetime (an hour) later. BAN_MARK is a fixed instant,
 * so --unblock lifts this ban and no other: a ban set by anyone else for any
 * other reason is left alone.
 *
 * Credentials: SUPABASE_ACCESS_TOKEN from the environment or .env.local (the
 * same lookup as apply-one-migration.mjs). The token is never printed.
 */
import { existsSync, readFileSync } from "node:fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
const PROJECT_REF = process.env.PROJECT_REF || process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const BAN_MARK = "2126-10-01 00:00:00+00";

const args = process.argv.slice(2);
const MODE = args.includes("--block") ? "block" : args.includes("--unblock") ? "unblock" : "status";

async function sql(query) {
  if (!TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN is not set (environment or .env.local).");
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

const TARGETS = `
  select distinct t.user_id from (
    select m.account_id as user_id from public.memberships m
      join public.schools s on s.id = m.school_id where s.kind = 'school'
    union select p.id from public.profiles p
      join public.schools s on s.id = p.school_id where s.kind = 'school'
    union select ur.user_id from public.user_roles ur
      where ur.role::text in ('admin', 'principal', 'teacher', 'parent', 'super_admin')
    union select sa.account_id from public.super_admins sa where sa.revoked_at is null
  ) t where exists (select 1 from auth.users u where u.id = t.user_id)`;

const INDIVIDUALS = `
  select m.account_id as user_id from public.memberships m
    join public.schools s on s.id = m.school_id where s.kind = 'individual'
  union select p.id from public.profiles p
    join public.schools s on s.id = p.school_id where s.kind = 'individual'`;

async function status() {
  const [row] = await sql(`
    with org as (${TARGETS}), ind as (${INDIVIDUALS})
    select json_build_object(
      'organisation_accounts', (select count(*) from org),
      'blocked_by_this', (select count(*) from auth.users u join org on org.user_id = u.id where u.banned_until = '${BAN_MARK}'),
      'banned_otherwise', (select count(*) from auth.users u join org on org.user_id = u.id
                             where u.banned_until > now() and u.banned_until <> '${BAN_MARK}'),
      'with_sessions', (select count(distinct s.user_id) from auth.sessions s join org on org.user_id = s.user_id),
      'also_individual', (select count(*) from org join ind using (user_id)),
      'individual_accounts', (select count(*) from (select distinct user_id from ind) i),
      'individual_banned', (select count(*) from auth.users u join (select distinct user_id from ind) i on i.user_id = u.id
                              where u.banned_until > now()),
      'marked_total', (select count(*) from auth.users where banned_until = '${BAN_MARK}')
    ) as r`);
  return row.r;
}

function show(s, label) {
  console.log(`${label}:`);
  for (const [k, v] of Object.entries(s)) console.log(`  ${k.padEnd(22)} ${v}`);
}

/**
 * The run. Returns the exit code rather than calling process.exit(): exiting
 * right after a fetch aborts on Windows with a libuv assertion, so the shell
 * would see 127 instead of the code chosen here (readonly-db.mjs, same trap).
 */
async function main() {
  const before = await status();
  show(before, "before");

  if (before.individual_accounts === 0) {
    // The control: the individual set is what the refusal below protects. If it
    // reads empty, the query is wrong, not the database.
    console.error("FAIL: no individual accounts were found — the queries are not seeing the data. Nothing done.");
    return 1;
  }

  if (MODE === "status") return 0;

  if (MODE === "block") {
    if (before.also_individual > 0) {
      console.error(`FAIL: ${before.also_individual} organisation account(s) are also individual accounts. Nothing done.`);
      return 1;
    }
    const n = before.organisation_accounts;
    // One request, one transaction: the guard refuses before anything is
    // written if the set moved since the read above.
    await sql(`
      create temp table _org on commit drop as ${TARGETS};
      do $$ declare n int; o int; begin
        select count(*) into n from _org;
        if n <> ${Number(n)} then raise exception 'expected % organisation accounts, found %', ${Number(n)}, n; end if;
        select count(*) into o from _org join (${INDIVIDUALS}) i using (user_id);
        if o > 0 then raise exception '% organisation account(s) are also individual accounts', o; end if;
      end $$;
      update auth.users set banned_until = '${BAN_MARK}'
        where id in (select user_id from _org) and (banned_until is null or banned_until <= now());
      delete from auth.sessions where user_id in (select user_id from _org);
      select 1 as done;`);
  } else {
    await sql(`update auth.users set banned_until = null where banned_until = '${BAN_MARK}'; select 1 as done;`);
  }

  const after = await status();
  show(after, "after");

  // Measured, not assumed: each line below can fail.
  const problems = [];
  if (MODE === "block") {
    const expected = before.organisation_accounts - before.banned_otherwise;
    if (after.blocked_by_this !== expected) problems.push(`blocked ${after.blocked_by_this}, expected ${expected}`);
    if (after.with_sessions !== 0) problems.push(`${after.with_sessions} organisation account(s) still hold a session`);
  } else if (after.marked_total !== 0) {
    problems.push(`${after.marked_total} account(s) still carry this script's ban`);
  }
  if (after.individual_banned !== 0) problems.push(`${after.individual_banned} individual account(s) are banned`);
  if (after.individual_accounts !== before.individual_accounts) problems.push("the individual set changed during the run");

  if (problems.length) {
    console.error("FAIL:\n  " + problems.join("\n  "));
    return 1;
  }
  console.log(MODE === "block"
    ? `OK: ${after.blocked_by_this} organisation account(s) blocked, no sessions left, ${after.individual_accounts} individual account(s) untouched.`
    : `OK: this script's ban is lifted; ${after.individual_accounts} individual account(s) untouched.`);
  return 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; },
);
