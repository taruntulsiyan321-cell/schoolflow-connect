/**
 * The quality gate, measured subject by subject (docs/TODO.md A2: "done when a
 * refused draft never reaches the bank and the refusal reasons are measured
 * over a batch in each subject").
 *
 *   node scripts/measure-question-gate.mjs [--per-subject 2] [--count 8] [--exam cuet] [--subject "Economics"]
 *
 * For each subject of the exam's syllabus it asks chapter-supply to write
 * --count questions for --per-subject of its chapters (those with the fewest
 * active questions first — where supply is needed), then reads back every
 * draft the gate saw in those runs (question_gate_outcomes) and prints, per
 * subject, how many were gated, kept, and refused at each stage, which
 * criteria failed, and examples of why.
 *
 * It FAILS (exit 1) when it cannot show what A2 promises:
 *   - a subject in which no draft was gated (nothing was measured there);
 *   - a bank row these runs created that has no passing quality review, or no
 *     'kept' record pointing at it (a draft reached the bank around the gate);
 *   - a 'kept' record whose bank row is missing.
 * What passes the gate is stored in the bank — these are real questions.
 *
 * Needs SUPABASE_ACCESS_TOKEN (env or .env.local). The drain secret that
 * chapter-supply asks for is read from the vault at run time and held in
 * memory only; nothing secret is printed.
 */
import { readFileSync, existsSync } from "fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) { console.error("BLOCKED: no SUPABASE_ACCESS_TOKEN — nothing measured."); process.exit(2); }

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const PER_SUBJECT = Math.max(1, Number(arg("per-subject", 2)));
const COUNT = Math.max(1, Math.min(30, Number(arg("count", 8))));
const EXAM = String(arg("exam", "cuet"));
const ONLY = arg("subject", null);

async function sql(query, readOnly = true) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, read_only: readOnly }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

// The vault cannot be decrypted on the read-only connection; this is still only a read.
const [{ secret } = {}] = await sql("select decrypted_secret as secret from vault.decrypted_secrets where name = 'variant_generation_drain'", false);
if (!secret) { console.error("BLOCKED: the drain secret is not in the vault — nothing measured."); process.exit(2); }

// Each subject's chapters, those the bank serves least first.
const chapters = await sql(`
  select s.name as subject, c.id as chapter_id, c.name as chapter,
         (select count(*) from question_bank q where q.chapter_id = c.id and q.exam_id = e.id and q.is_active) as active
    from exam_syllabus_chapters esc
    join competitive_exams e on e.id = esc.exam_id
    join chapters c on c.id = esc.chapter_id
    join curriculum_subjects s on s.id = c.curriculum_subject_id
   where e.code = ${lit(EXAM)}
   order by s.name, active, esc.sequence`);
// Every chapter of each subject, in that order: a chapter no AI writes for
// (questionRubric.CHAPTERS_NOT_WRITTEN — chapter-supply answers 422) is passed
// over for the next one, so each subject still gets --per-subject runs.
const bySubject = new Map();
for (const c of chapters) {
  if (ONLY && c.subject !== ONLY) continue;
  if (!bySubject.has(c.subject)) bySubject.set(c.subject, []);
  bySubject.get(c.subject).push(c);
}
if (bySubject.size === 0) { console.error(`FAIL: no chapters for ${EXAM}${ONLY ? ` / ${ONLY}` : ""}`); process.exit(1); }

async function supply(subject, c) {
  const t0 = Date.now();
  const res = await fetch(`https://${REF}.supabase.co/functions/v1/chapter-supply`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-variant-drain": secret },
    body: JSON.stringify({ exam: EXAM, chapter_id: c.chapter_id, count: COUNT }),
  }).catch((e) => ({ ok: false, status: 0, text: async () => String(e) }));
  const body = await res.text();
  let json = null;
  try { json = JSON.parse(body); } catch { /* reported below */ }
  const secs = Math.round((Date.now() - t0) / 1000);
  if (res.status === 422 && json?.retryable === false) {
    console.log(`  ${subject} › ${c.chapter}: not written by rule — ${json.error}`);
    return { notWritten: true };
  }
  if (!res.ok || !json?.run_id) {
    console.log(`  ${subject} › ${c.chapter}: FAILED ${res.status} in ${secs}s — ${body.slice(0, 200)}`);
    return null;
  }
  console.log(`  ${subject} › ${c.chapter}: wrote ${json.written}/${json.requested}, gated ${json.gate.gated} in ${secs}s`);
  return { subject, chapter: c.chapter, run: json.run_id };
}

const started = new Date(Date.now() - 1000).toISOString();
const runs = [];
const notWritten = [];
console.log(`Gate measurement — ${EXAM}, ${PER_SUBJECT} chapter(s) a subject, ${COUNT} questions each\n`);
for (const [subject, list] of bySubject) {
  // A subject's chapters in parallel; subjects one after another.
  let next = 0, done = 0;
  while (done < PER_SUBJECT && next < list.length) {
    const wave = list.slice(next, next + (PER_SUBJECT - done));
    next += wave.length;
    const got = await Promise.all(wave.map((c) => supply(subject, c)));
    for (const [k, g] of got.entries()) {
      if (g?.notWritten) notWritten.push(`${subject} › ${wave[k].chapter}`);
      else if (g) { runs.push(g); done++; } else done++;
    }
  }
}
if (runs.length === 0) { console.error("\nFAIL: no run finished — nothing measured."); process.exit(1); }

const refs = runs.map((r) => lit(r.run)).join(", ");
// The rubric function is closed to the read-only connection (20261148000000), so these reads run as the owner.
const outcomes = await sql(`
  select o.subject, o.stage, o.reason, o.failed, o.form, o.question_id, o.question,
         (q.id is not null) as row_exists, coalesce(public._quality_review_passes(q.quality_review), false) as row_review_passes
    from question_gate_outcomes o
    left join question_bank q on q.id = o.question_id
   where o.ref in (${refs})`, false);
// Every bank row these runs could have made: written by chapter_supply since the start.
const bankRows = await sql(`
  select q.id, q.subject, coalesce(public._quality_review_passes(q.quality_review), false) as passes,
         exists (select 1 from question_gate_outcomes o where o.question_id = q.id and o.stage = 'kept' and o.ref in (${refs})) as recorded
    from question_bank q
   where q.source = 'chapter_supply' and q.created_at >= ${lit(started)}`, false);

const problems = [];
console.log("");
for (const subject of bySubject.keys()) {
  const mine = outcomes.filter((o) => o.subject === subject);
  const kept = mine.filter((o) => o.stage === "kept");
  const at = (stage) => mine.filter((o) => o.stage === stage);
  const criteria = {};
  for (const o of mine) for (const c of o.failed ?? []) criteria[c] = (criteria[c] ?? 0) + 1;
  const rules = {};
  for (const o of at("rule")) rules[o.reason] = (rules[o.reason] ?? 0) + 1;
  const forms = {};
  for (const o of kept) forms[o.form] = (forms[o.form] ?? 0) + 1;
  const pct = (n) => (mine.length ? `${Math.round((100 * n) / mine.length)}%` : "-");
  console.log(`${subject}: gated ${mine.length}, kept ${kept.length} (${pct(kept.length)}), refused at rule ${at("rule").length}, answer ${at("answer").length}, review ${at("review").length}`);
  if (Object.keys(criteria).length) console.log(`  criteria failed: ${Object.entries(criteria).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  if (Object.keys(rules).length) console.log(`  rules broken: ${Object.entries(rules).map(([k, v]) => `${v}× ${k}`).join("; ")}`);
  if (Object.keys(forms).length) console.log(`  kept by form: ${Object.entries(forms).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  for (const o of [...at("answer"), ...at("review")].slice(0, 3)) console.log(`  · ${o.stage}: ${String(o.reason).slice(0, 220)}`);
  if (mine.length === 0) problems.push(`${subject}: no draft was gated — nothing measured`);
  for (const o of kept) {
    if (o.question_id && !o.row_exists) problems.push(`${subject}: a kept record points at a bank row that does not exist`);
    if (o.question_id && !o.row_review_passes) problems.push(`${subject}: a stored question has no passing review`);
  }
}
for (const r of bankRows) {
  if (!r.passes) problems.push(`bank row ${r.id} (${r.subject}) has no passing quality review`);
  if (!r.recorded) problems.push(`bank row ${r.id} (${r.subject}) has no kept gate record in these runs`);
}
if (notWritten.length) console.log(`\nNot written, by rule: ${notWritten.join("; ")}`);
console.log(`\nBank rows these runs created: ${bankRows.length}, every one with a passing review and a kept record: ${problems.filter((p) => p.startsWith("bank row")).length === 0}`);
console.log(`Runs: ${runs.map((r) => r.run).join(", ")}`);
if (problems.length) {
  console.error(`\nFAIL — ${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
console.log("\nPASS: every subject measured; nothing reached the bank without passing the gate.");
