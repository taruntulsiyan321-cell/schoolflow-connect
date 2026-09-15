/**
 * The measured generation run: 30 real variants, so the three open decisions
 * stop being estimates.
 *
 *   node scripts/run-variant-generation.mjs --dry-run          # nothing written
 *   node scripts/run-variant-generation.mjs --limit 30         # writes to the bank
 *   node scripts/run-variant-generation.mjs --limit 30 --tier 2
 *
 * WHY A RUN RATHER THAN AN ESTIMATE
 * Two of the three decisions blocking §4's AI path are economic — cost per
 * generated session and its ceiling, expected cache hit rate and what happens
 * below it. Neither is answerable in the abstract, and a guess written into a
 * spec becomes a number people plan against. Thirty real generations answer
 * both with measurements and hand over the twenty tier-2 variants a person
 * needs to read at the same time.
 *
 * WHAT IT NEEDS
 *   SUPABASE_URL              -- the project
 *   VARIANT_GENERATION_DRAIN  -- the shared secret the function checks. It is
 *                                held in the vault as variant_generation_drain
 *                                and set on the function as an environment
 *                                secret; this script is the third holder and
 *                                must be given it explicitly.
 *
 * The drain secret rather than the service-role key, since 20261012000000.
 * The function is called in production by a postgres cron over pg_net, and a
 * service-role key in a SQL function body is a master credential sitting in
 * pg_proc. One purpose-made secret opens exactly one door.
 *
 * ai-recovery-variants must be deployed. Until it is, this script cannot run,
 * and it says so rather than reporting zeros.
 *
 * NOTE: this script is the MANUAL path, for measuring cost and reading output.
 * The production path is the queue: a recovery session prepared at the end of
 * practice enqueues its missing rungs, and dispatch_variant_generation drains
 * them every minute. Running this by hand does not replace that and is not
 * needed for the feature to work.
 *
 * COST IS COMPUTED FROM REAL TOKEN COUNTS, and per model. One model is
 * configured -- Qwen 3.7 Flash, ruled 2026-09-07 -- so every call is billable
 * and the per-model split below has one row. It is KEPT per-model rather than
 * summed: the moment a second model is configured, a single total would be the
 * wrong answer to the exact question this run exists to settle.
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
import { queryRows, closeConnection } from "./lib/readonly-db.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const val = (f, d) => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const DRY = has("dry-run");
const LIMIT = Number(val("limit", 30));
const ONLY_TIER = val("tier", null);
const OUT = val("out", null);

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const BASE = (process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const KEY = process.env.VARIANT_GENERATION_DRAIN || "";
if (!BASE || !KEY) {
  console.error(
    [
      "Cannot run: SUPABASE_URL and VARIANT_GENERATION_DRAIN are both required.",
      "",
      "  ai-recovery-variants is a background endpoint (§4.1a) gated on a shared",
      "  secret, so there is no user-credential path to it by design. The value is",
      "  in the vault as variant_generation_drain and on the function as the",
      "  environment secret VARIANT_GENERATION_DRAIN.",
      "",
      "  This is a hard stop rather than a skip. A generation run that quietly",
      "  produced zero results would answer the cost question with 'free' and the",
      "  cache question with '100%', which are the two most expensive wrong answers",
      "  available here.",
    ].join("\n"),
  );
  process.exit(2);
}

// ── Pick real source questions ─────────────────────────────────────────────
//
// From actual student mistakes, not arbitrary bank rows. §4.2 is explicit that
// the session is built from the student's OWN wrong questions, and variant
// quality is a function of what it is varying — generating from a random bank
// row would measure a different system than the one being shipped.
//
// Falls back to bank rows in chapters where mistakes exist, and SAYS SO, so a
// thin mistake table shows up in the report rather than silently changing what
// was measured.
let sources = await queryRows(`
  SELECT DISTINCT ON (qb.id)
         qb.id, qb.question, qb.difficulty, qb.subject, qb.chapter, qb.topic,
         count(sm.id) OVER (PARTITION BY qb.id) AS times_missed
    FROM public.student_mistakes sm
    JOIN public.question_bank qb ON qb.id = sm.question_id
   WHERE sm.question_id IS NOT NULL
     AND qb.is_active
     AND qb.options IS NOT NULL
     AND qb.correct_index IS NOT NULL
   ORDER BY qb.id
   LIMIT ${Math.max(1, Math.ceil(LIMIT / 2))}`);

let sourceOrigin = "real student mistakes";
if (sources.length === 0) {
  sourceOrigin = "BANK FALLBACK — no student mistake points at a bank question";
  sources = await queryRows(`
    SELECT qb.id, qb.question, qb.difficulty, qb.subject, qb.chapter, qb.topic, 0 AS times_missed
      FROM public.question_bank qb
     WHERE qb.is_active AND qb.options IS NOT NULL AND qb.correct_index IS NOT NULL
       AND qb.chapter_id IS NOT NULL AND qb.source_question_id IS NULL
     ORDER BY qb.created_at
     LIMIT ${Math.max(1, Math.ceil(LIMIT / 2))}`);
}
await closeConnection();

if (sources.length === 0) {
  console.error("No usable source questions found. Nothing to measure.");
  process.exit(1);
}

// 1 and 2 only. Tier 3 comes from the bank (§4.2) and the generator refuses it
// — question_bank_variant_tier_check is `variant_tier IN (1, 2)`, so a tier-3
// request could never have been stored even when the branch existed.
const tiers = ONLY_TIER ? [Number(ONLY_TIER)] : [1, 2];
if (tiers.some((t) => t !== 1 && t !== 2)) {
  console.error(`--tier must be 1 or 2; got ${tiers.join(", ")}.`);
  process.exit(2);
}
console.log(`Sources: ${sources.length} (${sourceOrigin})`);
console.log(`Tiers: ${tiers.join(", ")}   Target: ${LIMIT} variant(s)   ${DRY ? "DRY RUN — nothing written" : "WRITING to question_bank"}`);
console.log("");

const results = [];
let made = 0;

outer: for (const tier of tiers) {
  for (const src of sources) {
    if (made >= LIMIT) break outer;
    const started = Date.now();
    let payload;
    try {
      const res = await fetch(`${BASE}/functions/v1/ai-recovery-variants`, {
        method: "POST",
        headers: { "x-variant-drain": KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ source_question_id: src.id, tier, count: 1, dry_run: DRY }),
      });
      payload = await res.json().catch(() => ({ error: `non-JSON response, HTTP ${res.status}` }));
      payload._http = res.status;
    } catch (e) {
      payload = { error: e.message, _http: 0 };
    }

    const n = DRY ? (payload.generated ?? 0) : (payload.inserted ?? 0);
    made += n;
    results.push({ tier, source_id: src.id, elapsed: Date.now() - started, n, payload });

    const label = payload.error
      ? `ERROR ${String(payload.error).slice(0, 70)}`
      : `${n} made` + (payload.skipped?.length ? `, ${payload.skipped.length} skipped (${payload.skipped[0]})` : "");
    console.log(
      `  tier ${tier}  ${String(src.chapter ?? "?").slice(0, 28).padEnd(28)} ${label}` +
        `  [${payload.usage?.source ?? "-"} ${payload.usage?.prompt_tokens ?? "?"}+${payload.usage?.completion_tokens ?? "?"}tok ${Date.now() - started}ms]`,
    );
  }
}

// ── The report the decisions actually need ─────────────────────────────────
const ok = results.filter((r) => !r.payload.error);
const failed = results.filter((r) => r.payload.error);
const byModel = {};
for (const r of ok) {
  const m = r.payload.usage?.source ?? "unknown";
  byModel[m] ??= { calls: 0, prompt: 0, completion: 0, made: 0, ms: 0 };
  byModel[m].calls++;
  byModel[m].prompt += r.payload.usage?.prompt_tokens ?? 0;
  byModel[m].completion += r.payload.usage?.completion_tokens ?? 0;
  byModel[m].made += r.n;
  byModel[m].ms += r.elapsed;
}

const totalSkipped = ok.reduce((a, r) => a + (r.payload.skipped?.length ?? 0), 0);

console.log("");
console.log("=".repeat(72));
console.log(`calls: ${results.length}   variants: ${made}   skipped: ${totalSkipped}   failed calls: ${failed.length}`);
for (const [m, s] of Object.entries(byModel)) {
  console.log(
    `  ${m}: ${s.calls} call(s), ${s.prompt} prompt + ${s.completion} completion tokens, ` +
      `${s.made} variant(s), median-ish ${Math.round(s.ms / Math.max(1, s.calls))}ms/call`,
  );
}
console.log("");
console.log("COST: token counts are printed per model rather than converted to money here.");
console.log("The primary model is a FREE tier and the fallback is paid, so multiply only the");
console.log("paid model's tokens by its current OpenRouter rate. Converting inside this script");
console.log("would bake a price that changes without notice into a number people plan against.");
console.log("");
const perSession = made > 0 ? (Object.values(byModel).reduce((a, s) => a + s.prompt + s.completion, 0) / made) * 6 : 0;
console.log(`A recovery session needs 6 generated questions (tiers 1 and 2). At the observed`);
console.log(`tokens-per-variant that is roughly ${Math.round(perSession)} tokens per first-time session,`);
console.log(`and ZERO for every later student who fails the same question -- that reuse is the`);
console.log(`whole of §4.2a's economics, and it is what the cache-rate decision turns on.`);
if (failed.length) {
  console.log("");
  console.log(`${failed.length} call(s) failed. §4.1a says failures retry in the background and the`);
  console.log(`student never sees them, so this rate is the input to the retry budget, not a`);
  console.log(`reason to treat the run as invalid:`);
  for (const f of failed.slice(0, 5)) console.log(`  - HTTP ${f.payload._http}: ${String(f.payload.error).slice(0, 100)}`);
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({ sourceOrigin, results }, null, 2));
  console.log(`\nfull payloads written to ${OUT}`);
}
console.log("");
console.log(DRY ? "DRY RUN — nothing was written. Re-run without --dry-run to populate the bank."
                : "Now read them: node scripts/dump-variants.mjs --tier 2 --limit 20");
