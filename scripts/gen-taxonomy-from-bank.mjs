/**
 * One-shot generator: bank topic/chapter → taxonomy seed files.
 * Run: node scripts/gen-taxonomy-from-bank.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const files = [
  "supabase/migrations/20260802230000_rbse_commerce_full_accountancy_bst.sql",
  "supabase/migrations/20260802230100_rbse_commerce_full_economics_math.sql",
  "supabase/migrations/20260802230200_rbse_commerce_full_english_hindi.sql",
  "supabase/migrations/20260802220100_rbse_commerce_11_12_question_seed.sql",
].map((f) => path.join(root, f));

const topics = new Set();
const byKey = new Map();

for (const f of files) {
  const t = fs.readFileSync(f, "utf8");
  const re =
    /\(\s*(\d+)\s*,\s*'((?:\\'|[^'])*)'\s*,\s*'((?:\\'|[^'])*)'\s*,\s*'((?:\\'|[^'])*)'\s*,\s*'((?:easy|medium|hard)[^']*)'/gi;
  let m;
  while ((m = re.exec(t))) {
    const cls = +m[1];
    const subject = m[2];
    const chapter = m[3];
    const topic = m[4];
    topics.add(topic);
    const key = `${subject}||${chapter}`;
    if (!byKey.has(key)) byKey.set(key, { subject, chapter, classes: new Set() });
    byKey.get(key).classes.add(cls);
  }
}

const dictSrc = fs.readFileSync(path.join(root, "src/academic/taxonomy/dictionary.ts"), "utf8");
const existing = new Set([...dictSrc.matchAll(/^\s{2}([a-z0-9_]+):/gm)].map((x) => x[1]));

const curated = {
  "4ps": "4Ps (Marketing Mix)",
  aoa: "Articles of Association",
  moa: "Memorandum of Association",
  huf: "Hindu Undivided Family",
  mnc: "Multinational Corporation",
  ppp: "Public-Private Partnership",
  csr: "Corporate Social Responsibility",
  fayol: "Fayol's Principles",
  taylor: "Taylor's Scientific Management",
  esprit: "Esprit de Corps",
  wto_etc: "WTO and International Organisations",
  epayments: "Electronic Payments",
  ecommerce: "e-Commerce",
  sole_prop: "Sole Proprietorship",
  features_pse: "Features of Public Sector Enterprises",
  insurance_types: "Types of Insurance",
  resources_ebusiness: "Resources for e-Business",
  online_trading: "Online Trading",
  import_doc: "Import Documents",
  equity_vs_debt: "Equity vs Debt",
  trade_credit: "Trade Credit",
  problems_msme: "Problems of MSMEs",
  gst_trade: "GST in Trade",
  nature_principles: "Nature and Principles",
  discipline_unity: "Discipline and Unity of Command",
  economic_env: "Economic Environment",
  objectives_policies: "Objectives and Policies",
  relationship_planning: "Relationship of Planning",
  capital_structure: "Capital Structure",
  working_capital: "Working Capital",
  marketing_vs_selling: "Marketing vs Selling",
  act_scope: "Scope of the Act",
  ngo_role: "Role of NGOs",
  economic_activity: "Economic Activity",
  msme: "MSME",
  startup: "Startup",
  entrepreneur: "Entrepreneurship",
  banking: "Banking",
  insurance: "Insurance",
  partnership: "Partnership",
  company: "Company",
  cooperative: "Cooperative Society",
  commerce: "Commerce",
  industry: "Industry",
  risk: "Business Risk",
  pse: "Public Sector Enterprise",
  disinvestment: "Disinvestment",
  liberalisation: "Liberalisation",
  delegation: "Delegation",
  decentralisation: "Decentralisation",
  redressal: "Consumer Redressal",
  leadership: "Leadership",
  motivation: "Motivation",
  communication: "Communication",
  supervision: "Supervision",
  training: "Training",
  appraisal: "Performance Appraisal",
  dividend: "Dividend Decision",
  retained: "Retained Earnings",
  promotion: "Promotion",
  product: "Product",
  wholesale: "Wholesale Trade",
  retail: "Retail Trade",
  itinerant: "Itinerant Retailers",
  transport: "Transport",
  chambers: "Chambers of Commerce",
  outsourcing: "Outsourcing",
  stakeholders: "Stakeholders",
  ethics: "Business Ethics",
  responsibilities: "Social Responsibilities",
  environment: "Business Environment",
  dimensions: "Dimensions of Business Environment",
  deviations: "Deviations",
  span: "Span of Management",
  structure: "Organisational Structure",
  levels: "Levels of Management",
  functions: "Functions of Management",
  characteristics: "Characteristics",
  definition: "Definition",
  importance: "Importance",
  limitations: "Limitations",
  objectives: "Objectives",
  objective: "Objective",
  process: "Process",
  nature: "Nature",
  role: "Role",
  types: "Types",
  sources: "Sources",
  features: "Features",
  arguments: "Arguments",
  benefits: "Benefits",
  elements: "Elements",
  techniques: "Techniques",
  modes: "Modes",
  long_term: "Long-term Sources",
  short_term: "Short-term Sources",
  export: "Export",
  incorporation: "Incorporation",
  capital_subscription: "Capital Subscription",
  adjustments: "Adjustments",
  authorised: "Authorised Capital",
  branches: "Branches of Accounting",
  capital: "Capital",
  cogs: "Cost of Goods Sold",
  compensating: "Compensating Errors",
  consistency: "Consistency Concept",
  depreciation: "Depreciation",
  errors: "Errors",
  financing: "Financing Activities",
  goodwill: "Goodwill",
  horizontal: "Horizontal Analysis",
  insolvency: "Insolvency",
  interest: "Interest",
  interpretation: "Interpretation",
  investing: "Investing Activities",
  marshalling: "Marshalling of Assets",
  matching: "Matching Concept",
  methods: "Methods",
  notes: "Notes to Accounts",
  operating: "Operating Activities",
  outstanding: "Outstanding Expenses",
  overdraft: "Bank Overdraft",
  premium: "Share Premium",
  provisions: "Provisions",
  realisation: "Realisation Account",
  reserves: "Reserves",
  reserves_dist: "Distribution of Reserves",
  revaluation: "Revaluation Account",
  settlement: "Settlement of Accounts",
  suspense: "Suspense Account",
  timing: "Timing Differences",
  tools: "Tools of Analysis",
  turnover: "Turnover Ratios",
  vertical: "Vertical Analysis",
  wdv: "Written Down Value Method",
  "1991": "1991 Economic Reforms",
  ad: "Aggregate Demand",
  as: "Aggregate Supply",
  aggregates: "National Income Aggregates",
  agriculture: "Agriculture",
  analysis: "Analysis",
  bivariate: "Bivariate Data",
  bop: "Balance of Payments",
  budget: "Budget",
  categories: "Categories",
  classification: "Classification",
  colonial: "Colonial Economy",
  comparison: "Comparison",
  concepts: "Concepts",
  costs: "Costs",
  credit: "Credit",
  crr: "Cash Reserve Ratio",
  deadweight: "Deadweight Loss",
  deficit: "Budget Deficit",
  demand: "Demand",
  demographic: "Demographic Profile",
  direction: "Direction of Trade",
  education: "Education",
  efficiency: "Efficiency",
  elasticity: "Elasticity",
  equilibrium: "Equilibrium",
  frequency: "Frequency Distribution",
  gdp: "GDP",
  global_warming: "Global Warming",
  globalisation: "Globalisation",
  growth: "Economic Growth",
  health: "Health",
  histogram: "Histogram",
  industrial: "Industrial Sector",
  infrastructure: "Infrastructure",
  intermediate: "Intermediate Goods",
  issues: "Issues",
  marketing: "Marketing",
  mc: "Marginal Cost",
  meaning: "Meaning",
  median: "Median",
  mode: "Mode",
  monopolistic: "Monopolistic Competition",
  monopoly: "Monopoly",
  multiplier: "Multiplier",
  ogive: "Ogive",
  oligopoly: "Oligopoly",
  pakistan: "Pakistan Comparison",
  paradox: "Paradox of Thrift",
  participation: "Labour Force Participation",
  planning: "Economic Planning",
  policy: "Policy",
  policy_open: "Open Market Operations",
  pollution: "Pollution",
  poverty: "Poverty",
  ppf: "Production Possibility Frontier",
  primary: "Primary Data",
  privatisation: "Privatisation",
  problems: "Problems",
  project: "Project Work",
  purpose: "Purpose",
  reforms: "Economic Reforms",
  relationship: "Relationship",
  report: "Report",
  resources: "Resources",
  revenue: "Revenue",
  scatter: "Scatter Diagram",
  scope: "Scope",
  secondary: "Secondary Data",
  sectors: "Sectors of Economy",
  shapes: "Shapes of Curves",
  shifts: "Shifts in Demand and Supply",
  supply: "Supply",
  sustainable: "Sustainable Development",
  trade: "Foreign Trade",
  utility: "Utility",
  variables: "Variables",
  variables_types: "Types of Variables",
  welfare: "Welfare",
  agreement: "Subject-Verb Agreement",
  articles: "Articles",
  character: "Character",
  concept: "Concept",
  concision: "Concision",
  device: "Literary Device",
  dilemma: "Dilemma",
  focus: "Focus",
  formal: "Formal Writing",
  formal_email: "Formal Email",
  idea: "Central Idea",
  inference: "Inference",
  irony: "Irony",
  literary_device: "Literary Device",
  memo: "Memo",
  minutes: "Minutes of Meeting",
  modals: "Modals",
  plot: "Plot",
  prepositions: "Prepositions",
  present_perfect: "Present Perfect",
  reporting: "Reported Speech",
  setting: "Setting",
  symbol: "Symbolism",
  synonym: "Synonyms",
  theme: "Theme",
  tone: "Tone",
  vocabulary_in_context: "Vocabulary in Context",
  nCr: "Combinations (nCr)",
  nPr: "Permutations (nPr)",
  ap: "Arithmetic Progression",
  gp_basics: "Geometric Progression Basics",
  ap_basics: "Arithmetic Progression Basics",
  ap_sum: "Sum of an AP",
  gp_sum: "Sum of a GP",
  lpp_basics: "LPP Basics",
  i_squared: "i Squared",
  det2: "2×2 Determinant",
  bayes: "Bayes' Theorem",
  bayes_setup: "Bayes' Theorem Setup",
};

const ACR = new Set([
  "gdp", "crr", "bop", "ppf", "lpp", "gst", "gaap", "msme", "csr", "huf", "mnc", "ppp", "aoa",
  "moa", "pse", "wto", "cogs", "wdv", "ncr", "npr", "roa", "roe", "brs", "bst",
]);
const SMALL = new Set(["vs", "of", "the", "and", "in", "on", "to", "for", "a", "an", "or", "via"]);

function titleFromSlug(t) {
  return t
    .split("_")
    .map((p, i, a) => {
      if (SMALL.has(p) && i > 0 && i < a.length - 1) return p;
      if (ACR.has(p)) return p.toUpperCase();
      if (/^\d+[a-z]?$/i.test(p)) return p.toUpperCase();
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join(" ");
}

const missing = [...topics].filter((t) => !existing.has(t)).sort();
const bankLines = [];
for (const t of missing) {
  if (/[\u0900-\u097F]/.test(t)) {
    bankLines.push(`  ${JSON.stringify(t)}: ${JSON.stringify(t)},`);
    continue;
  }
  const display = curated[t] || titleFromSlug(t);
  const key = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(t) ? t : JSON.stringify(t);
  bankLines.push(`  ${key}: ${JSON.stringify(display)},`);
}

const bankOut = `/**
 * Concept display map derived from live RBSE commerce question_bank topic slugs.
 * Merged into taxonomy registry — never render these ids raw in UI.
 * Regenerated by: node scripts/gen-taxonomy-from-bank.mjs
 */
export const BANK_CONCEPT_DISPLAY: Record<string, string> = {
${bankLines.join("\n")}
};
`;

fs.writeFileSync(path.join(root, "src/academic/taxonomy/seeds/bankConcepts.ts"), bankOut);

const subjectId = {
  Accountancy: "accountancy",
  "Business Studies": "business_studies",
  Economics: "economics",
  Mathematics: "mathematics",
  English: "english",
  Hindi: "hindi",
};

function slugify(s) {
  return String(s)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u0900-\u097f]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

const chapterRows = [];
for (const { subject, chapter, classes } of [...byKey.values()].sort(
  (a, b) => a.subject.localeCompare(b.subject) || a.chapter.localeCompare(b.chapter, "en"),
)) {
  const sid = subjectId[subject];
  if (!sid) continue;
  const display = chapter.replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\s+/g, " ").trim();
  for (const cl of [...classes].sort()) {
    chapterRows.push({ sid, cl, display, orig: chapter });
  }
}

const seen = new Set();
const uniq = [];
for (const row of chapterRows) {
  const k = `${row.sid}|${row.cl}|${slugify(row.display)}`;
  if (seen.has(k)) continue;
  seen.add(k);
  uniq.push(row);
}

const chapterLines = uniq.map((row) => {
  const aliases = new Set();
  if (row.orig !== row.display) aliases.add(row.orig);
  const em = row.display.replace(/ - /g, " — ");
  const en = row.display.replace(/ - /g, " – ");
  if (em !== row.display) aliases.add(em);
  if (en !== row.display) aliases.add(en);
  const aliasLit =
    aliases.size > 0 ? `, [${[...aliases].map((a) => JSON.stringify(a)).join(", ")}]` : "";
  return `  chapter(${JSON.stringify(row.display)}, "${row.sid}", ${row.cl}${aliasLit}),`;
});

const commerceOut = `import type { BoardId, Chapter, ClassLevel, Concept, Subject, TaxonomyTerm } from "../types";
import { slugifyAcademicId } from "../canonicalize";
import { CONCEPT_DISPLAY_DICTIONARY } from "../dictionary";
import { BANK_CONCEPT_DISPLAY } from "./bankConcepts";

const BOARD: BoardId = "rbse";

function subject(id: string, displayName: string, aliases: string[] = []): Subject {
  return { id, displayName, aliases, kind: "subject", board: BOARD };
}

function chapter(
  displayName: string,
  subjectId: string,
  classLevel: ClassLevel,
  aliases: string[] = [],
): Chapter {
  const id = slugifyAcademicId(displayName);
  return {
    id,
    displayName,
    aliases,
    kind: "chapter",
    board: BOARD,
    classLevel,
    subjectId,
    parentId: subjectId,
  };
}

export const COMMERCE_SUBJECTS: Subject[] = [
  subject("accountancy", "Accountancy", ["accounts", "accounting"]),
  subject("business_studies", "Business Studies", ["bst", "business studies (bst)"]),
  subject("economics", "Economics", ["eco"]),
  subject("mathematics", "Mathematics", ["maths", "math"]),
  subject("english", "English", ["english core"]),
  subject("hindi", "Hindi", ["hindi core"]),
];

/** NCERT-aligned RBSE commerce chapters (11–12) from live question_bank seeds. */
export const COMMERCE_CHAPTERS: Chapter[] = [
${chapterLines.join("\n")}
];

/** Concept terms from seed slugs with curated (or dictionary) display names. */
export function buildCommerceConceptTerms(): Concept[] {
  const merged: Record<string, string> = { ...CONCEPT_DISPLAY_DICTIONARY, ...BANK_CONCEPT_DISPLAY };
  return Object.entries(merged).map(([id, displayName]) => ({
    id,
    displayName,
    aliases: buildConceptAliases(id, displayName),
    kind: "concept" as const,
    board: BOARD,
  }));
}

function buildConceptAliases(id: string, displayName: string): string[] {
  const aliases = new Set<string>();
  aliases.add(displayName);
  aliases.add(displayName.toLowerCase());
  aliases.add(id.replace(/_/g, " "));
  if (id === "brs_purpose" || id === "bank_reconciliation_statement") {
    aliases.add("BRS");
    aliases.add("brs");
    aliases.add("Bank Reconciliation");
  }
  if (id === "journal_proper") aliases.add("Proper Journal");
  if (id === "double_entry") {
    aliases.add("Double Entry");
    aliases.add("Double-Entry System");
  }
  if (id === "cash_book") aliases.add("Cashbook");
  if (id === "4ps") {
    aliases.add("4Ps");
    aliases.add("4 ps");
    aliases.add("marketing mix");
  }
  if (id === "moa") aliases.add("Memorandum of Association");
  if (id === "aoa") aliases.add("Articles of Association");
  return [...aliases];
}

export function commerceTaxonomyBundle(): TaxonomyTerm[] {
  return [...COMMERCE_SUBJECTS, ...COMMERCE_CHAPTERS, ...buildCommerceConceptTerms()];
}
`;

fs.writeFileSync(path.join(root, "src/academic/taxonomy/seeds/commerceRbse.ts"), commerceOut);

console.log(
  JSON.stringify(
    {
      bankConcepts: missing.length,
      chapters: uniq.length,
      topics: topics.size,
    },
    null,
    2,
  ),
);
