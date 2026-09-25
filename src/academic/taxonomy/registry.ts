import type { AcademicLabelKind, TaxonomyKind, TaxonomyTerm } from "./types";
import { CLASS_LEVELS_ASCENDING } from "@/lib/curriculumScope";
import { canonicalizeConceptId, looksLikeAcademicSlug, slugifyAcademicId } from "./canonicalize";
import {
  BOARD_DISPLAY,
  CONCEPT_DISPLAY_DICTIONARY,
  QUESTION_TYPE_DISPLAY,
  SUBJECT_DISPLAY,
} from "./dictionary";
import { commerceTaxonomyBundle } from "./seeds/commerceRbse";
import { scienceTaxonomyBundle } from "./seeds/sciencePlaceholders";

const BOARDS: TaxonomyTerm[] = [
  { id: "rbse", displayName: "RBSE", aliases: ["rajasthan board"], kind: "board" },
  { id: "cbse", displayName: "CBSE", aliases: [], kind: "board" },
  { id: "icse", displayName: "ICSE", aliases: [], kind: "board" },
  { id: "other", displayName: "Other", aliases: [], kind: "board" },
  { id: "both", displayName: "All Boards", aliases: ["all"], kind: "board" },
];

const QUESTION_TYPES: TaxonomyTerm[] = Object.entries(QUESTION_TYPE_DISPLAY).map(
  ([id, displayName]) => ({
    id,
    displayName,
    aliases: [displayName.toLowerCase()],
    kind: "question_type" as const,
  }),
);

// Ascending so the registry lists classes the way a person reads them. The set
// itself comes from `@/lib/curriculumScope` — this file used to carry its own
// `[6, 7, …, 12]` and its own widening cast, which is how Class 5 came to be
// missing from the taxonomy while sitting in the curriculum tree.
const CLASS_LEVEL_TERMS: TaxonomyTerm[] = CLASS_LEVELS_ASCENDING.map((n) => ({
  id: String(n),
  displayName: `Class ${n}`,
  aliases: [`${n}`, `class ${n}`, `std ${n}`],
  kind: "class_level" as const,
  classLevel: n,
}));

/**
 * TWO KEYS, KEPT APART: a NAME and an ID.
 *
 * A name is what a person wrote — a display name, or an alias written into a
 * seed ("BRS", "Marketing Mix"). An id is what a bank stored — `planning`,
 * `cash_book`. They used to share one map, keyed by the lower-cased string, so
 * a title that lower-cased to an id took that id's display name: the Business
 * Studies chapter "Planning" rendered as the Economics bank's "Economic
 * Planning", "Revaluation" as "Revaluation Account", "Environment" as
 * "Business Environment" (measured 2026-09-25: 44 renames across the 4,056
 * CUET chapter and topic names). A name now resolves only by a name; an id by
 * an id, or by the name it slugs to.
 */
function buildRegistry(): {
  byId: Map<string, TaxonomyTerm>;
  byName: Map<string, string>;
  byIdKey: Map<string, string>;
  all: TaxonomyTerm[];
} {
  const all: TaxonomyTerm[] = [
    ...BOARDS,
    ...CLASS_LEVEL_TERMS,
    ...QUESTION_TYPES,
    ...commerceTaxonomyBundle(),
    ...scienceTaxonomyBundle(),
  ];

  // Ensure every dictionary concept is registered even if seed missed it
  for (const [id, displayName] of Object.entries(CONCEPT_DISPLAY_DICTIONARY)) {
    if (!all.some((t) => t.kind === "concept" && t.id === id)) {
      all.push({ id, displayName, aliases: [displayName], kind: "concept" });
    }
  }

  const byId = new Map<string, TaxonomyTerm>();
  const byName = new Map<string, string>();
  const byIdKey = new Map<string, string>();

  // Both maps are keyed by the slug, so "Financial Statements – I" and
  // "Financial Statements - I" are one name. First registration wins unless forced.
  const remember = (map: Map<string, string>, label: string, id: string, force = false) => {
    const key = slugifyAcademicId(label);
    if (key && (force || !map.has(key))) map.set(key, id);
  };

  for (const term of all) {
    // Prefer first registration; commerce seeds load before science placeholders
    if (!byId.has(`${term.kind}:${term.id}`)) {
      byId.set(`${term.kind}:${term.id}`, term);
    }
    if (!byId.has(term.id)) {
      byId.set(term.id, term);
    }
    remember(byIdKey, term.id, term.id);
    remember(byName, term.displayName, term.id);
    for (const a of term.aliases) remember(byName, a, term.id);
  }

  // Explicit high-value aliases (force — win over near-match concept ids like brs_purpose)
  remember(byName, "BRS", "bank_reconciliation_statement", true);
  remember(byName, "Bank Reconciliation", "bank_reconciliation_statement", true);
  remember(byName, "Proper Journal", "journal_proper", true);
  remember(byName, "Double Entry System", "double_entry", true);

  return { byId, byName, byIdKey, all };
}

const REG = buildRegistry();

export function listTaxonomyTerms(kind?: TaxonomyKind): TaxonomyTerm[] {
  if (!kind) return [...REG.all];
  return REG.all.filter((t) => t.kind === kind);
}

export function getTaxonomyTerm(
  idOrAlias: string | null | undefined,
  kind?: TaxonomyKind | AcademicLabelKind,
): TaxonomyTerm | null {
  if (idOrAlias == null || !String(idOrAlias).trim()) return null;
  const raw = String(idOrAlias).trim();
  const slug = slugifyAcademicId(raw);
  // A name a person wrote resolves by a name only (see buildRegistry).
  const isId = looksLikeAcademicSlug(raw);

  if (kind && isId) {
    const keyed = REG.byId.get(`${kind}:${raw}`);
    if (keyed) return keyed;
    const canon = kind === "concept" || kind === "topic" ? canonicalizeConceptId(raw) : slug;
    const byCanon = REG.byId.get(`${kind}:${canon}`);
    if (byCanon) return byCanon;
  }

  const aliasId = (isId ? REG.byIdKey.get(slug) : undefined) ?? REG.byName.get(slug);
  if (aliasId) {
    if (kind) {
      const typed = REG.byId.get(`${kind}:${aliasId}`);
      if (typed) return typed;
    }
    return REG.byId.get(aliasId) ?? null;
  }
  if (!isId) return null;

  if (kind === "concept" || kind === "topic") {
    const canon = canonicalizeConceptId(raw);
    return REG.byId.get(`concept:${canon}`) ?? REG.byId.get(canon) ?? null;
  }

  return REG.byId.get(raw) ?? null;
}

/** Lookup display name from registry without humanize fallback. */
export function lookupDisplayName(
  idOrAlias: string | null | undefined,
  kind?: TaxonomyKind | AcademicLabelKind,
): string | null {
  const term = getTaxonomyTerm(idOrAlias, kind);
  if (term) return term.displayName;

  if (!idOrAlias) return null;
  const slug = slugifyAcademicId(idOrAlias);
  if (kind === "subject" || !kind) {
    if (SUBJECT_DISPLAY[slug]) return SUBJECT_DISPLAY[slug];
  }
  if (kind === "board") {
    if (BOARD_DISPLAY[slug]) return BOARD_DISPLAY[slug];
  }
  if (kind === "question_type") {
    if (QUESTION_TYPE_DISPLAY[slug]) return QUESTION_TYPE_DISPLAY[slug];
  }
  if ((kind === "concept" || kind === "topic" || !kind) && looksLikeAcademicSlug(idOrAlias)) {
    const canon = canonicalizeConceptId(idOrAlias);
    if (CONCEPT_DISPLAY_DICTIONARY[canon]) return CONCEPT_DISPLAY_DICTIONARY[canon];
  }
  return null;
}

export function searchTaxonomyByAlias(query: string, kind?: TaxonomyKind): TaxonomyTerm[] {
  const q = slugifyAcademicId(query);
  if (!q) return [];
  const hits: TaxonomyTerm[] = [];
  const seen = new Set<string>();
  for (const [key, id] of [...REG.byName, ...REG.byIdKey]) {
    if (!key.includes(q)) continue;
    const term = (kind ? REG.byId.get(`${kind}:${id}`) : null) ?? REG.byId.get(id);
    if (!term) continue;
    if (kind && term.kind !== kind) continue;
    const k = `${term.kind}:${term.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    hits.push(term);
  }
  return hits;
}
