#!/usr/bin/env node
/**
 * THE HOMEWORK CLOSURE AGAINST A DECISION OR A HAND-IN IN FLIGHT, with two real
 * connections, against the local replica.
 *
 * resolve_closed_homework() charges the missed-homework XP from what it reads:
 * nothing handed in, or rejected. A teacher's rejection or a student's hand-in
 * that interleaves with it would lose a charge, or charge a student who did hand
 * in. rpc_homework_decide and rpc_homework_submit hold the homework FOR SHARE,
 * the closure takes it FOR UPDATE SKIP LOCKED, and a hand-in refuses resolved
 * homework (20260925110000).
 *
 * Only one ordering really races: the CLOSURE in flight, then the call. The other
 * way round the closure already waits without any lock of ours — its INSERT …
 * ON CONFLICT meets the submission row the call has written.
 *
 * Phase 1 runs the orderings on the migrations as written: every claim must hold.
 * Phase 2 is the positive control: FOR SHARE is taken out of both functions and
 * the racing orderings must then go wrong — the claims can fail. The functions
 * are put back exactly afterwards.
 *
 *   node race.mjs
 */
import pg from "pg";

const PORT = Number(process.env.GK_PORT || "5433");
const DB = process.env.GK_DB || "gurukul";
const connect = async () => {
  const c = new pg.Client({ host: "127.0.0.1", port: PORT, user: "postgres", database: DB, statement_timeout: 20000 });
  c.on("notice", () => {});
  await c.connect();
  return c;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const one = async (c, sql, args) => (await c.query(sql, args)).rows[0];
const as = async (c, uid) => {
  await c.query("SET ROLE authenticated");
  await c.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
};
const server = async (c) => {
  await c.query("RESET ROLE");
  await c.query("SELECT set_config('request.jwt.claims', '', false)");
};
const settle = (p) => p.then(() => null, (e) => e);
const LOCKED = ["public.rpc_homework_submit(uuid,jsonb)", "public.rpc_homework_decide(uuid,text)"];

const admin = await connect();
const f = await one(
  admin,
  `SELECT s.school_id, s.class_id, s.user_id AS student_user, t.user_id AS teacher
     FROM public.students s
     JOIN public.teacher_classes tc ON tc.class_id = s.class_id
     JOIN public.teachers t ON t.id = tc.teacher_id AND t.user_id IS NOT NULL AND t.deleted_at IS NULL
     JOIN public.memberships m ON m.local_person_id = t.id AND m.role = 'teacher' AND m.status = 'active' AND m.school_id = s.school_id
    WHERE s.user_id IS NOT NULL AND s.deleted_at IS NULL
    ORDER BY s.id LIMIT 1`,
);
if (!f) throw new Error("no signed-in student with a signed-in teacher in the replica");
const file = `${f.student_user}/race-${Date.now()}.pdf`;
await admin.query("INSERT INTO storage.objects (bucket_id, name) VALUES ('academic-files', $1)", [file]);
const hand = { path: file, name: "w.pdf", mime: "application/pdf" };
const newHomework = async (title, closesIn) =>
  (
    await one(
      admin,
      `INSERT INTO public.homework (school_id, class_id, subject, title, description, closes_at, status, created_by)
       VALUES ($1, $2, 'Mathematics', $3, 'q', now() + $4::interval, 'published', $5) RETURNING id`,
      [f.school_id, f.class_id, `[race] ${title}`, closesIn, f.teacher],
    )
  ).id;
const charges = async (sub) =>
  Number((await one(admin, "SELECT count(*) AS n FROM public.progression_history WHERE idempotency_key = 'homework.missed:' || $1", [sub])).n);
const status = async (sub) => (await one(admin, "SELECT status FROM public.homework_submissions WHERE id = $1", [sub])).status;

async function orderings(label) {
  const A = await connect();
  const B = await connect();
  const out = [];
  const claim = (name, ok, detail) => {
    out.push(ok);
    console.log(`  ${ok ? "holds " : "broken"}  ${label}: ${name}${detail ? ` — ${detail}` : ""}`);
  };

  // 1. The closure is resolving the homework when the teacher rejects.
  {
    const hw = await newHomework(`${label} rejected during closure`, "1 hour");
    await as(A, f.student_user);
    const sub = (await one(A, "SELECT public.rpc_homework_submit($1, $2) AS r", [hw, hand])).r.id;
    await server(A);
    await admin.query("UPDATE public.homework SET closes_at = now() - interval '1 minute' WHERE id = $1", [hw]);
    await B.query("BEGIN");
    await server(B);
    await B.query("SELECT public.resolve_closed_homework()");
    await as(A, f.teacher);
    const decided = settle(A.query("SELECT public.rpc_homework_decide($1, 'rejected')", [sub]));
    await sleep(1000);
    await B.query("COMMIT");
    const err = await decided;
    await server(A);
    claim("a rejection taken as the closure resolves is charged, once", !err && (await charges(sub)) === 1,
      err ? `${err.code} ${err.message}` : `charges=${await charges(sub)}`);
  }

  // 2. The closure is resolving the homework when a rejected student, whose call
  //    began before the deadline, hands in again.
  {
    const hw = await newHomework(`${label} resubmitted during closure`, "4 seconds");
    await as(A, f.student_user);
    const sub = (await one(A, "SELECT public.rpc_homework_submit($1, $2) AS r", [hw, hand])).r.id;
    await as(B, f.teacher);
    await B.query("SELECT public.rpc_homework_decide($1, 'rejected')", [sub]);
    await server(B);
    await A.query("BEGIN");
    await A.query("SELECT now()");
    await sleep(5000);
    await B.query("BEGIN");
    await B.query("SELECT public.resolve_closed_homework()");
    const handed = settle(A.query("SELECT public.rpc_homework_submit($1, $2)", [hw, hand]));
    await sleep(1000);
    await B.query("COMMIT");
    const err = await handed;
    await A.query(err ? "ROLLBACK" : "COMMIT");
    await server(A);
    const s = await status(sub);
    claim("a hand-in reaching resolved homework is refused, so the charge stands on work not given",
      err?.code === "55000" && s === "rejected" && (await charges(sub)) === 1,
      `${err ? err.code : "it went in"}; status=${s} charges=${await charges(sub)}`);
  }

  // 3. The decision is in flight when the closure runs — correct without our
  //    lock too; shown so it is not assumed.
  {
    const hw = await newHomework(`${label} closure during decision`, "1 hour");
    await as(A, f.student_user);
    const sub = (await one(A, "SELECT public.rpc_homework_submit($1, $2) AS r", [hw, hand])).r.id;
    await server(A);
    await admin.query("UPDATE public.homework SET closes_at = now() - interval '1 minute' WHERE id = $1", [hw]);
    await A.query("BEGIN");
    await as(A, f.teacher);
    await A.query("SELECT public.rpc_homework_decide($1, 'rejected')", [sub]);
    await server(B);
    const closing = settle(B.query("SELECT public.resolve_closed_homework()"));
    await sleep(1000);
    await A.query("COMMIT");
    await server(A);
    await closing;
    await B.query("SELECT public.resolve_closed_homework()");
    claim("a rejection the closure meets in flight is charged, once", (await charges(sub)) === 1, `charges=${await charges(sub)}`);
  }

  await A.end();
  await B.end();
  return out;
}

console.log("\n══ homework closure against calls in flight ═══════════════════════");
const locked = await orderings("locked");

const originals = [];
for (const fn of LOCKED) {
  const { d } = await one(admin, "SELECT pg_get_functiondef($1::regprocedure) AS d", [fn]);
  if (d.split(" FOR SHARE;").length - 1 !== 1) throw new Error(`${fn}: FOR SHARE is not where this proof expects it`);
  originals.push(d);
  await admin.query(d.replace(" FOR SHARE;", ";"));
}
let unlocked;
try {
  unlocked = await orderings("UNLOCKED control");
} finally {
  for (const d of originals) await admin.query(d);
}
for (const [i, fn] of LOCKED.entries()) {
  const { d } = await one(admin, "SELECT pg_get_functiondef($1::regprocedure) AS d", [fn]);
  if (d !== originals[i]) throw new Error(`${fn} was not put back exactly`);
}
await admin.end();

const held = locked.every(Boolean);
const controlFailed = unlocked[0] === false && unlocked[1] === false;
console.log(`\n  ${locked.filter(Boolean).length} of ${locked.length} claims hold with the locks;` +
  ` without them the racing orderings ${controlFailed ? "go wrong, so the claims can fail" : "STILL HOLD — this proof proves nothing"}\n`);
process.exit(held && controlFailed ? 0 : 1);
