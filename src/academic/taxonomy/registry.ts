import type { AcademicLabelKind, TaxonomyKind, TaxonomyTerm } from "./types";
import { canonicalizeConceptId, slugifyAcademicId } from "./canonicalize";
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

const CLASS_LEVELS: TaxonomyTerm[] = [6, 7, 8, 9, 10, 11, 12].map((n) => ({
  id: String(n),
  displayName: `Class ${n}`,
  aliases: [`${n}`, `class ${n}`, `std ${n}`],
  kind: "class_level" as const,
  classLevel: n as 6 | 7 | 8 | 9 | 10 | 11 | 12,
}));

function buildRegistry(): {
  byId: Map<string, TaxonomyTerm>;
  byAlias: Map<string, string>;
  all: TaxonomyTerm[];
} {
  const all: TaxonomyTerm[] = [
    ...BOARDS,
    ...CLASS_LEVELS,
    ...QUESTION_TYPES,
    ...commerceTaxonomyBundle(),
    ...scienceTaxonomyBundle(),
  ];

  // Ensure every dictionary concept is registered even if seed missed it
  for (const [id, displayName] of Object.entries(CONCEPT_DISPLAY_DICTIONARY)) {
    if (!all.some((t) => t.kind === "concept" && t.id === id)) {
      all.push({
        id,
        displayName,
        aliases: [displayName, id.replace(/_/g, " ")],
        kind: "concept",
      });
    }
  }

  const byId = new Map<string, TaxonomyTerm>();
  const byAlias = new Map<string, string>();

  const rememberAlias = (alias: string, id: string, force = false) => {
    const key = alias.trim().toLowerCase();
    if (!key) return;
    if (force || !byAlias.has(key)) byAlias.set(key, id);
    const slug = slugifyAcademicId(alias);
    if (slug && (force || !byAlias.has(slug))) byAlias.set(slug, id);
  };

  for (const term of all) {
    // Prefer first registration; commerce seeds load before science placeholders
    if (!byId.has(`${term.kind}:${term.id}`)) {
      byId.set(`${term.kind}:${term.id}`, term);
    }
    if (!byId.has(term.id)) {
      byId.set(term.id, term);
    }
    rememberAlias(term.id, term.id);
    rememberAlias(term.displayName, term.id);
    for (const a of term.aliases) rememberAlias(a, term.id);
  }

  // Explicit high-value aliases (force — win over near-match concept ids like brs_purpose)
  rememberAlias("BRS", "bank_reconciliation_statement", true);
  rememberAlias("brs", "bank_reconciliation_statement", true);
  rememberAlias("Bank Reconciliation", "bank_reconciliation_statement", true);
  rememberAlias("Proper Journal", "journal_proper", true);
  rememberAlias("Double Entry System", "double_entry", true);

  return { byId, byAlias, all };
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
  const lower = raw.toLowerCase();

  if (kind) {
    const keyed = REG.byId.get(`${kind}:${raw}`) ?? REG.byId.get(`${kind}:${lower}`);
    if (keyed) return keyed;
    const canon = kind === "concept" || kind === "topic" ? canonicalizeConceptId(raw) : slugifyAcademicId(raw);
    const byCanon = REG.byId.get(`${kind}:${canon}`);
    if (byCanon) return byCanon;
  }

  const aliasId = REG.byAlias.get(lower) ?? REG.byAlias.get(slugifyAcademicId(raw));
  if (aliasId) {
    if (kind) {
      const typed = REG.byId.get(`${kind}:${aliasId}`);
      if (typed) return typed;
    }
    return REG.byId.get(aliasId) ?? null;
  }

  if (kind === "concept" || kind === "topic") {
    const canon = canonicalizeConceptId(raw);
    return REG.byId.get(`concept:${canon}`) ?? REG.byId.get(canon) ?? null;
  }

  return REG.byId.get(raw) ?? REG.byId.get(lower) ?? null;
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
  if (kind === "concept" || kind === "topic" || !kind) {
    const canon = canonicalizeConceptId(idOrAlias);
    if (CONCEPT_DISPLAY_DICTIONARY[canon]) return CONCEPT_DISPLAY_DICTIONARY[canon];
  }
  return null;
}

export function searchTaxonomyByAlias(query: string, kind?: TaxonomyKind): TaxonomyTerm[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: TaxonomyTerm[] = [];
  const seen = new Set<string>();
  for (const [alias, id] of REG.byAlias) {
    if (!alias.includes(q) && q !== alias) continue;
    const term = (kind ? REG.byId.get(`${kind}:${id}`) : null) ?? REG.byId.get(id);
    if (!term) continue;
    if (kind && term.kind !== kind) continue;
    const key = `${term.kind}:${term.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(term);
  }
  return hits;
}
