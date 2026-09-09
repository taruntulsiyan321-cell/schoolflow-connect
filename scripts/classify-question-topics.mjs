#!/usr/bin/env node
/**
 * Give every question_bank row a `topic_group` — the canonical topic for its
 * (subject, chapter) — so a teacher picking a topic sees a list they can read.
 *
 * WHY THIS EXISTS.  `topic` was never a classification: 21,696 questions carry
 * 11,917 distinct topics, 8,360 of them used exactly once. Three defects made
 * that, and each needs a different rule, which is why one pass would not do:
 *
 *   1. spelling / exercise verbs  inference vs drawing_inferences
 *   2. per-question labels        anusvara_sandhi_k, anusvara_sandhi_kha, …
 *   3. transliteration variants   vyajan / vyanjan / vyanjana
 *
 * FOUR MERGE RULES, applied in this order. Each is narrower than the next is
 * broad, so the confident merges happen before the speculative ones:
 *
 *   1. LEXICAL KEY   strip exercise verbs and grammatical glue, stem what is
 *                    left, sort it. `identifying_main_idea` and `main_idea`
 *                    reduce to the same key.
 *   2. HEAD PREFIX   within a chapter, three or more topics sharing a leading
 *                    token prefix roll up to it. This is what collapses the
 *                    per-question labels.
 *   3. NEAR SPELLING same token count, at most one token differing and only
 *                    by a character or two; then the same rule again on the
 *                    surviving group labels. This is what collapses the
 *                    transliterations. Compared per TOKEN, never whole-string:
 *                    whole-string distance chains through a shared prefix and
 *                    swallows a chapter.
 *   4. SEMANTIC      cosine distance between the mean embedding of each
 *                    topic's questions, below --threshold (default 0.15).
 *                    Measured: the 0.15–0.20 band merges genuinely different
 *                    topics (`errors` with `preparation_of_brs`), so the cut
 *                    is deliberately tight and this rule runs last.
 *
 * EVERY RULE IS SCOPED TO (subject, chapter). `inference` in English and
 * `inference` in Mathematics never merge.
 *
 * `topic` is never written. This only fills `topic_group`.
 *
 *   node scripts/classify-question-topics.mjs --self-test   prove the rules
 *   node scripts/classify-question-topics.mjs               dry run + report
 *   node scripts/classify-question-topics.mjs --apply       write topic_group
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";

// ── the rules ──────────────────────────────────────────────────────────────

/** Slug that KEEPS Devanagari, so Hindi topics stay distinct and matchable. */
export function slugTopic(raw) {
  if (raw == null) return "";
  return String(raw)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    // Negated class keeping Devanagari; see src/academic/taxonomy/canonicalize.ts
    .replace(/[^a-z0-9ऀ-ॿ]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

/** The verb of the exercise, not its subject. Dropped from the key. */
export const EXERCISE_VERBS = new Set([
  "identifying", "identify", "understanding", "understand", "drawing", "draw",
  "finding", "find", "calculating", "calculate", "solving", "solve", "applying",
  "apply", "using", "use", "determining", "determine", "recognizing",
  "recognising", "recognize", "describing", "describe", "explaining", "explain",
  "comparing", "compare", "analyzing", "analysing", "analyze", "analyse",
  "evaluating", "evaluate", "interpreting", "interpret", "defining", "define",
  "listing", "list", "stating", "state", "naming", "classifying", "classify",
  "introduction", "intro", "basics", "basic", "concept", "concepts", "skill",
  "skills", "problem", "problems", "question", "questions", "type", "types",
  "example", "examples", "study", "general", "misc", "other", "various",
  "overview", "meaning",
]);

/** Grammatical glue. Dropped from the key, not held against a label. */
export const CONNECTORS = new Set([
  "in", "of", "the", "a", "an", "and", "or", "to", "for", "with", "on", "at",
  "by", "from", "vs", "versus", "its", "their", "as", "is", "are", "after", "before",
]);

/** Compact suffix reduction. ASCII only — Devanagari tokens pass through. */
export function stemToken(t) {
  if (!/^[a-z0-9]+$/.test(t) || t.length <= 3) return t;
  let s = t.replace(/ies$/, "y").replace(/sses$/, "ss").replace(/([^s])s$/, "$1");
  s = s.replace(
    /(ing|edly|edness|ement|ment|ation|ition|tion|sion|ance|ence|ally|able|ible|ness|ity|ive|ise|ize|ed|al|ic|ly)$/,
    "",
  );
  return s.length < 3 ? t : s;
}

export function contentTokens(raw) {
  return slugTopic(raw)
    .split("_")
    .filter(Boolean)
    .filter((p) => !EXERCISE_VERBS.has(p) && !CONNECTORS.has(p));
}

/** Rule 1. Order-insensitive so fact_opinion == opinion_fact. */
export function topicKey(raw) {
  const all = slugTopic(raw).split("_").filter(Boolean);
  const kept = contentTokens(raw);
  return [...new Set((kept.length ? kept : all).map(stemToken).filter(Boolean))].sort().join("_");
}

/** Bounded Levenshtein. Returns 99 once it cannot possibly be within budget. */
export function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** How far two spellings of the same WORD are allowed to be. */
export function spellingBudget(a, b) {
  return Math.min(2, Math.max(1, Math.ceil(0.3 * Math.max(a.length, b.length))));
}

/**
 * Are these two labels the same topic spelled differently?
 *
 * Compared TOKEN BY TOKEN, not as whole strings. Whole-string edit distance
 * chains catastrophically: in a chapter where every label starts
 * `probability_`, each label is a few edits from its neighbour, and
 * single-linkage union-find then swallows the entire chapter into one group
 * (measured: 60 unrelated topics, `probability_leap_year_sunday` merged with
 * `probability_bayes_three_machines`).
 *
 * Requiring the same token COUNT and at most ONE differing token keeps the
 * transliteration win — vyanjan/vyajan, svar/swar, deergh/dirgh — while
 * refusing `volume_cone` ~ `surface_area_cone`.
 */
export function isSpellingVariant(a, b) {
  const ta = slugTopic(a).split("_").filter(Boolean);
  const tb = slugTopic(b).split("_").filter(Boolean);
  if (ta.length === 0 || ta.length !== tb.length) return false;
  let diffs = 0;
  for (let i = 0; i < ta.length; i++) {
    if (ta[i] === tb[i]) continue;
    if (++diffs > 1) return false;
    if (editDistance(ta[i], tb[i]) > spellingBudget(ta[i], tb[i])) return false;
  }
  return diffs === 1;   // identical labels are already one group from rule 1
}

function makeUnionFind(ids, maxCluster) {
  const parent = new Map(), size = new Map();
  for (const k of ids) { parent.set(k, k); size.set(k, 1); }
  const find = (x) => {
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  const union = (a, b) => {
    let ra = find(a), rb = find(b);
    if (ra === rb) return true;
    if (size.get(ra) + size.get(rb) > maxCluster) return false;   // refuse runaway chains
    if (size.get(ra) < size.get(rb)) [ra, rb] = [rb, ra];
    parent.set(rb, ra);
    size.set(ra, size.get(ra) + size.get(rb));
    return true;
  };
  return { find, union };
}

/**
 * Group one chapter's topics.
 * @param topics [{ topic, n }]           n = how many questions carry it
 * @param semanticPairs [{ t1, t2, d }]   already filtered to this chapter
 * @returns Map<topic, groupLabel>
 */
export function groupChapterTopics(topics, semanticPairs = [], opts = {}) {
  const { minPrefixGroup = 3, maxShare = 0.4, maxCluster = 30, maxSemanticDistance = 0.15 } = opts;
  const names = topics.map((t) => t.topic);
  const nOf = new Map(topics.map((t) => [t.topic, t.n ?? 1]));
  const { find, union } = makeUnionFind(names, maxCluster);

  // 1. lexical key
  const byKey = new Map();
  for (const name of names) {
    const k = topicKey(name);
    if (byKey.has(k)) union(byKey.get(k), name);
    else byKey.set(k, name);
  }

  // 2. head prefix, longest first.
  //
  // Keyed by MEMBER, not by cluster root: rules 3 and 4 run afterwards and
  // change which member is the root, so a root-keyed map loses the label and
  // the cluster falls back to naming itself after an arbitrary member
  // (`anusvara_sandhi_k` instead of `anusvara_sandhi`).
  const prefixOfMember = new Map();
  const toks = new Map(names.map((t) => [t, contentTokens(t).map(stemToken)]));
  // A rollup must not swallow most of a LARGE chapter — that would leave the
  // teacher one category and no filter. On a small chapter the share is
  // meaningless (40% of five topics is two), so a floor exempts them.
  const cap = Math.max(minPrefixGroup * 2, Math.floor(names.length * maxShare));
  // k stops at 2. A ONE-token prefix is nearly always the chapter's own
  // subject word -- in a Probability chapter every label starts
  // `probability_`, and rolling up on it produced one 30-topic group holding
  // `probability_leap_year_sunday` next to `probability_bayes_three_machines`.
  // A rollup therefore needs a two-token prefix AND a third token to
  // distinguish the members, which is exactly the `anusvara_sandhi_*` shape.
  for (let k = 3; k >= 2; k--) {
    const groups = new Map();
    for (const [name, t] of toks) {
      if (t.length <= k) continue;                       // a prefix must be shorter than its label
      const p = t.slice(0, k).join("_");
      (groups.get(p) ?? groups.set(p, []).get(p)).push(name);
    }
    for (const [p, ids] of groups) {
      if (ids.length < minPrefixGroup || ids.length > cap) continue;
      if (new Set(ids.map(find)).size < 2) continue;
      const exact = names.find((t) => (toks.get(t) ?? []).join("_") === p);
      const all = exact ? [...ids, exact] : ids;
      let anchor = all[0];
      for (const m of all) if (union(anchor, m)) anchor = find(anchor);
      // Longest prefix wins: k counts down, so only record what is not set.
      for (const m of all) if (!prefixOfMember.has(m)) prefixOfMember.set(m, p);
    }
  }

  // 3a. near-identical spellings of the raw labels
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      if (isSpellingVariant(names[i], names[j])) union(names[i], names[j]);
    }
  }

  // 4. semantic, tightest pairs first so a tight pair wins before loose
  // chaining. The threshold is re-applied here rather than trusted from the
  // caller: passing an unfiltered pair list must not silently over-merge.
  for (const p of [...semanticPairs].filter((p) => p.d < maxSemanticDistance).sort((a, b) => a.d - b.d)) {
    if (nOf.has(p.t1) && nOf.has(p.t2)) union(p.t1, p.t2);
  }

  // choose each cluster's label
  const clusters = new Map();
  for (const name of names) (clusters.get(find(name)) ?? clusters.set(find(name), []).get(find(name))).push(name);

  // The cluster's prefix is the longest prefix any of its members carries.
  const prefixOfCluster = (members) => {
    const found = members.map((m) => prefixOfMember.get(m)).filter(Boolean);
    return found.sort((a, b) => b.split("_").length - a.split("_").length || b.length - a.length)[0];
  };

  const labelOf = new Map();
  for (const [root, members] of clusters) {
    labelOf.set(root, pickCanonicalLabel(members, nOf, prefixOfCluster(members)));
  }

  // 3b. the same spelling rule again, now on the surviving labels: a prefix
  // rollup can leave `anusvar` and `anusvara` as two groups, because rule 3a
  // only ever compared the long raw labels underneath them.
  const roots = [...clusters.keys()];
  const merged = new Map();
  for (const r of roots) {
    const lab = labelOf.get(r);
    let target = null;
    for (const [otherLabel, otherRoot] of merged) {
      if (isSpellingVariant(lab, otherLabel)) { target = otherRoot; break; }
    }
    if (target) {
      const winner = pickCanonicalLabel(
        [...clusters.get(target), ...clusters.get(r)], nOf,
        prefixOfCluster([...clusters.get(target), ...clusters.get(r)]),
      );
      clusters.set(target, [...clusters.get(target), ...clusters.get(r)]);
      labelOf.set(target, winner);
      clusters.delete(r);
    } else {
      merged.set(lab, r);
    }
  }

  const out = new Map();
  for (const [root, members] of clusters) for (const m of members) out.set(m, labelOf.get(root));
  return out;
}

/** Fewest exercise verbs, then most used, then shortest, then alphabetical. */
export function pickCanonicalLabel(members, nOf, prefix) {
  if (prefix) {
    const exact = members.find((t) => contentTokens(t).map(stemToken).join("_") === prefix);
    if (exact) return exact;
    return prefix;
  }
  const rank = (t) => {
    const all = slugTopic(t).split("_").filter(Boolean);
    return [all.filter((x) => EXERCISE_VERBS.has(x)).length, -(nOf.get(t) ?? 0), all.length, t];
  };
  return members.slice().sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < ra.length; i++) { if (ra[i] < rb[i]) return -1; if (ra[i] > rb[i]) return 1; }
    return 0;
  })[0];
}

// ── the self-test ──────────────────────────────────────────────────────────

function selfTest() {
  let failed = 0;
  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (!ok) { failed++; console.error(`  FAIL ${name}\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`); }
    else console.log(`  ok   ${name}`);
  };
  const groupOf = (list, pairs) => {
    const m = groupChapterTopics(list.map((t) => (typeof t === "string" ? { topic: t, n: 1 } : t)), pairs);
    return [...new Set(m.values())].sort();
  };

  console.log("rule 1 — lexical key");
  check("exercise verb dropped", topicKey("identifying_main_idea"), topicKey("main_idea"));
  check("connector dropped", topicKey("fact_vs_opinion"), topicKey("fact_opinion"));
  check("order-insensitive", topicKey("cause_and_effect"), topicKey("effect_cause"));
  check("plural stemmed", topicKey("drawing_inferences"), topicKey("inference"));
  check("Devanagari survives slugging", slugTopic("स्वर संधि"), "स्वर_संधि");
  check("Devanagari not stemmed away", stemToken("संधि"), "संधि");

  console.log("rule 2 — head prefix");
  check("per-question labels roll up", groupOf([
    "anusvara_sandhi_k", "anusvara_sandhi_kha", "anusvara_sandhi_p", "anusvara_sandhi_ta",
  ]), ["anusvara_sandhi"]);
  // The guard that keeps a chapter filterable: rolling up on the chapter's own
  // word would put every question in one bucket.
  check("a one-token prefix does NOT roll up", groupOf([
    "probability_leap_year_sunday", "probability_bayes_machines", "probability_card_face",
  ]).length, 3);
  // Two is below minPrefixGroup, so they stay apart. A rollup needs three —
  // otherwise every pair sharing a first word would invent a category.
  check("two topics do NOT roll up (below minPrefixGroup)",
    groupOf(["light_reaction_photosystem_one", "light_reaction_photosystem_two"]).length, 2);
  check("three DO roll up", groupOf([
    "light_reaction_photosystem_one", "light_reaction_photosystem_two", "light_reaction_atp",
  ]).length, 1);

  console.log("rule 3 — near spelling");
  check("transliteration merges", groupOf([
    { topic: "vyanjan_sandhi", n: 5 }, { topic: "vyajan_sandhi", n: 1 }, { topic: "vyanjana_sandhi", n: 1 },
  ]), ["vyanjan_sandhi"]);
  check("different words do NOT merge", groupOf(["algebra", "geometry"]), ["algebra", "geometry"]);

  console.log("rule 4 — semantic");
  check("close pair merges", groupOf(
    [{ topic: "realisation_account", n: 4 }, { topic: "journal_entry_on_dissolution", n: 1 }],
    [{ t1: "realisation_account", t2: "journal_entry_on_dissolution", d: 0.11 }],
  ).length, 1);
  check("distant pair does not", groupOf(
    ["balance_sheet_presentation", "share_capital_basics"],
    [{ t1: "balance_sheet_presentation", t2: "share_capital_basics", d: 0.31 }],
  ).length, 2);

  console.log("label choice");
  check("prefers the label without the exercise verb",
    pickCanonicalLabel(["identifying_main_idea", "main_idea"], new Map([["identifying_main_idea", 9], ["main_idea", 1]])),
    "main_idea");
  check("among equals prefers the more used",
    pickCanonicalLabel(["inference", "inferences"], new Map([["inference", 2], ["inferences", 7]])),
    "inferences");

  console.log("scope");
  check("grouping never crosses a chapter — caller passes one chapter at a time",
    typeof groupChapterTopics([{ topic: "x", n: 1 }]).get("x"), "string");

  // The control: a broken implementation must fail this file.
  const sabotage = groupChapterTopics([{ topic: "a_b_c", n: 1 }, { topic: "totally_unrelated_thing", n: 1 }]);
  check("unrelated topics stay apart (control)", new Set(sabotage.values()).size, 2);

  console.log(failed ? `\nFAIL: ${failed} assertion(s)` : "\nPASS: every rule assertion held.");
  process.exit(failed ? 1 : 0);
}

// ── the live run ───────────────────────────────────────────────────────────

function accessToken() {
  const envPath = join(ROOT, ".env.local");
  try {
    const m = readFileSync(envPath, "utf8").match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch { /* fall through */ }
  return process.env.SUPABASE_ACCESS_TOKEN || "";
}

async function runSql(sql) {
  const token = accessToken();
  if (!token) {
    console.error("No SUPABASE_ACCESS_TOKEN (.env.local or env). Cannot reach the database.");
    process.exit(2);
  }
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  try { return JSON.parse(text); } catch { return []; }
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function main() {
  const apply = process.argv.includes("--apply");
  const thrArg = process.argv.find((a) => a.startsWith("--threshold="));
  const threshold = thrArg ? Number(thrArg.split("=")[1]) : 0.15;

  console.log(`Project: ${PROJECT_REF}`);
  console.log(`Semantic threshold: ${threshold}   Mode: ${apply ? "APPLY" : "dry run"}\n`);

  const topics = await runSql(`
    SELECT subject, chapter, topic, count(*)::int AS n
      FROM public.question_bank
     WHERE topic IS NOT NULL AND btrim(topic) <> ''
     GROUP BY 1,2,3`);

  const pairs = await runSql(`
    WITH cent AS (
      SELECT subject, chapter, topic, avg(embedding) AS c
        FROM public.question_bank
       WHERE topic IS NOT NULL AND btrim(topic) <> '' AND embedding IS NOT NULL
       GROUP BY 1,2,3)
    SELECT a.subject, a.chapter, a.topic AS t1, b.topic AS t2,
           round((a.c <=> b.c)::numeric, 4)::float8 AS d
      FROM cent a JOIN cent b
        ON a.subject=b.subject AND a.chapter=b.chapter AND a.topic < b.topic
     WHERE (a.c <=> b.c) < ${threshold}`);

  console.log(`${topics.length} (subject, chapter, topic) triples`);
  console.log(`${pairs.length} semantic pairs under ${threshold}\n`);

  const byChapter = new Map();
  for (const r of topics) {
    const k = `${r.subject} ${r.chapter}`;
    (byChapter.get(k) ?? byChapter.set(k, { topics: [], pairs: [] }).get(k)).topics.push(r);
  }
  for (const p of pairs) {
    const k = `${p.subject} ${p.chapter}`;
    if (byChapter.has(k)) byChapter.get(k).pairs.push(p);
  }

  const assignments = [];
  let beforeTotal = 0, afterTotal = 0;
  const beforeCounts = [], afterCounts = [];
  for (const [k, { topics: ts, pairs: ps }] of byChapter) {
    const [subject, chapter] = k.split(" ");
    const m = groupChapterTopics(ts, ps);
    beforeCounts.push(ts.length);
    afterCounts.push(new Set(m.values()).size);
    beforeTotal += ts.length;
    afterTotal += new Set(m.values()).size;
    for (const t of ts) assignments.push({ subject, chapter, topic: t.topic, group: m.get(t.topic) ?? t.topic, n: t.n });
  }

  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  const changed = assignments.filter((a) => a.group !== a.topic);
  console.log(`chapters                 : ${byChapter.size}`);
  console.log(`distinct topics          : ${beforeTotal} -> ${afterTotal}`);
  console.log(`per chapter, median      : ${med(beforeCounts)} -> ${med(afterCounts)}`);
  console.log(`per chapter, worst       : ${Math.max(...beforeCounts)} -> ${Math.max(...afterCounts)}`);
  console.log(`chapters with >40 topics : ${beforeCounts.filter((n) => n > 40).length} -> ${afterCounts.filter((n) => n > 40).length}`);
  console.log(`labels changed           : ${changed.length} triples, ${changed.reduce((s, a) => s + a.n, 0)} questions\n`);

  console.log("── a sample of the merges ──");
  const byGroup = new Map();
  for (const a of assignments) {
    const k = `${a.subject} / ${a.chapter} / ${a.group}`;
    (byGroup.get(k) ?? byGroup.set(k, []).get(k)).push(a.topic);
  }
  [...byGroup.entries()].filter(([, v]) => v.length > 1)
    .sort((a, b) => b[1].length - a[1].length).slice(0, 12)
    .forEach(([k, v]) => console.log(`  ${k}\n     <= ${v.slice(0, 8).join(" | ")}${v.length > 8 ? ` … +${v.length - 8}` : ""}`));

  if (!apply) {
    console.log("\nDry run. Nothing was written. Re-run with --apply to fill topic_group.");
    return;
  }

  console.log("\nWriting topic_group…");
  const CHUNK = 400;
  let written = 0;
  for (let i = 0; i < assignments.length; i += CHUNK) {
    const slice = assignments.slice(i, i + CHUNK);
    const values = slice.map((a) => `(${q(a.subject)},${q(a.chapter)},${q(a.topic)},${q(a.group)})`).join(",");
    const rows = await runSql(`
      WITH m(subject, chapter, topic, grp) AS (VALUES ${values})
      UPDATE public.question_bank qb
         SET topic_group = m.grp
        FROM m
       WHERE qb.subject = m.subject AND qb.chapter = m.chapter AND qb.topic = m.topic
         AND qb.topic_group IS DISTINCT FROM m.grp
      RETURNING 1`);
    written += Array.isArray(rows) ? rows.length : 0;
    process.stdout.write(`\r  ${Math.min(i + CHUNK, assignments.length)}/${assignments.length} mappings, ${written} rows updated`);
  }
  console.log("");

  const [check] = await runSql(`
    SELECT count(*) FILTER (WHERE topic_group IS NOT NULL)::int AS grouped,
           count(*) FILTER (WHERE topic_group IS NULL AND topic IS NOT NULL AND btrim(topic) <> '')::int AS ungrouped,
           count(DISTINCT topic)::int AS raw_topics,
           count(DISTINCT topic_group)::int AS grouped_topics
      FROM public.question_bank`);
  console.log(`\ngrouped   : ${check.grouped}`);
  console.log(`ungrouped : ${check.ungrouped}`);
  console.log(`distinct  : ${check.raw_topics} raw -> ${check.grouped_topics} groups`);
  if (check.ungrouped > 0) {
    console.error(`\nFAIL: ${check.ungrouped} row(s) have a topic but no group.`);
    process.exit(1);
  }
  console.log("\nDone.");
}

if (process.argv.includes("--self-test")) selfTest();
else main().catch((e) => { console.error(e.message); process.exit(1); });
