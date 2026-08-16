/**
 * Generates RBSE Commerce question-bank content via OpenRouter (Gemini 2.5
 * Flash), one CHAPTER at a time, caching each chapter's result to disk the
 * moment it arrives. Safe to interrupt and re-run: already-cached chapters
 * are skipped, so nothing already generated is ever lost or redone.
 *
 * Usage:
 *   node scripts/rbse-commerce-full/gen-via-openrouter.mjs <subject-key>
 *
 * subject-key: accountancy | business_studies | economics | mathematics | english | hindi
 *
 * Reads OPENROUTER_API_KEY from .env.local (falls back to process.env).
 * Writes cache to scripts/rbse-commerce-full/.gen-cache/<subject>/<class>-<chapter-slug>.json
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const CACHE_DIR = path.join(__dirname, ".gen-cache");

function loadEnvLocal() {
  const p = path.join(ROOT, ".env.local");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    if (process.env[key] !== undefined) continue; // real env wins
    const val = rawVal.replace(/^["']|["']$/g, "");
    process.env[key] = val;
  }
}
// MUST run before MODEL is read below — a prior bug read process.env.OPENROUTER_MODEL
// before .env.local was loaded, so it silently fell back to the hardcoded default
// every time regardless of what .env.local said. Fixed by loading env first.
loadEnvLocal();

const MODEL = process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const API_KEY = process.env.OPENROUTER_API_KEY;
if (!API_KEY) {
  console.error("OPENROUTER_API_KEY not set (checked process.env and .env.local). Aborting.");
  process.exit(1);
}

// ---- Hard budget guard — real, authoritative spend from OpenRouter itself,
// not a local estimate. Checked before EVERY round; the whole run aborts
// (not just skips) the instant remaining budget is inside the safety margin. ----
const BUDGET_LIMIT_USD = Number(process.env.QB_BUDGET_LIMIT_USD || 3.0);
const SAFETY_MARGIN_USD = 0.2;

class BudgetExceededError extends Error {}

let lastKnownUsage = null;

async function getRemoteUsageUsdOnce() {
  const res = await fetch("https://openrouter.ai/api/v1/key", {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`OpenRouter /key check failed: ${res.status}`);
  const json = await res.json();
  const usage = json?.data?.usage;
  if (typeof usage !== "number") throw new Error("Could not read usage from /key response");
  return usage;
}

/** Retries transient network failures (DNS blips, timeouts) a few times before
 * falling back to the last known-good reading — a network hiccup during the
 * budget check must never crash the whole run when there's real, safely-saved
 * progress to protect. Only throws if we have NO prior reading to fall back on. */
async function getRemoteUsageUsd() {
  const delays = [1000, 3000, 6000];
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const usage = await getRemoteUsageUsdOnce();
      lastKnownUsage = usage;
      return usage;
    } catch (e) {
      lastErr = e;
      if (attempt < delays.length) await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  if (lastKnownUsage !== null) {
    console.log(`\n[budget check network error, using last known usage $${lastKnownUsage.toFixed(4)}: ${lastErr.message}]`);
    return lastKnownUsage;
  }
  throw lastErr;
}

async function assertBudgetOk() {
  const usage = await getRemoteUsageUsd();
  const remaining = BUDGET_LIMIT_USD - usage;
  if (remaining <= SAFETY_MARGIN_USD) {
    throw new BudgetExceededError(
      `Budget guard tripped: $${usage.toFixed(4)} spent of $${BUDGET_LIMIT_USD.toFixed(2)} limit ` +
        `(only $${remaining.toFixed(4)} remaining, safety margin is $${SAFETY_MARGIN_USD.toFixed(2)}). Stopping now.`,
    );
  }
  return { usage, remaining };
}

// ---- Subject -> chapter list (Class 11 / 12), taken from src/academic/taxonomy/seeds/commerceRbse.ts ----
const SUBJECTS = {
  accountancy: {
    name: "Accountancy",
    stream: "commerce",
    chapters: {
      11: [
        "Introduction to Accounting",
        "Theory Base of Accounting",
        "Recording of Transactions-I",
        "Recording of Transactions-II",
        "Bank Reconciliation Statement",
        "Trial Balance and Rectification of Errors",
        "Depreciation, Provisions and Reserves",
        "Financial Statements - I",
        "Financial Statements - II",
      ],
      12: [
        "Accounting for Partnership - Basic Concepts",
        "Reconstitution - Admission",
        "Reconstitution - Retirement/Death",
        "Dissolution of Partnership Firm",
        "Accounting for Share Capital",
        "Issue and Redemption of Debentures",
        "Financial Statements of a Company",
        "Analysis of Financial Statements",
        "Accounting Ratios",
        "Cash Flow Statement",
      ],
    },
  },
  business_studies: {
    name: "Business Studies",
    stream: "commerce",
    chapters: {
      11: [
        "Nature and Purpose of Business",
        "Forms of Business Organisation",
        "Private, Public and Global Enterprises",
        "Business Services",
        "Emerging Modes of Business",
        "Social Responsibilities of Business and Business Ethics",
        "Formation of a Company",
        "Sources of Business Finance",
        "Internal Trade",
        "International Business",
        "MSME and Business Entrepreneurship",
      ],
      12: [
        "Nature and Significance of Management",
        "Principles of Management",
        "Business Environment",
        "Planning",
        "Organising",
        "Staffing",
        "Directing",
        "Controlling",
        "Financial Management",
        "Marketing Management",
        "Consumer Protection",
      ],
    },
  },
  economics: {
    name: "Economics",
    stream: "commerce",
    chapters: {
      11: [
        "Indian Economy on the Eve of Independence",
        "Indian Economy 1950-1990",
        "LPG - An Appraisal",
        "Human Capital Formation",
        "Rural Development",
        "Employment",
        "Environment and Sustainable Development",
        "Comparative Development Experiences",
        "Collection of Data",
        "Organisation of Data",
        "Presentation of Data",
        "Measures of Central Tendency",
        "Correlation",
        "Index Numbers",
        "Use of Statistical Tools",
      ],
      12: [
        "Introduction to Macroeconomics",
        "National Income Accounting",
        "Money and Banking",
        "Determination of Income and Employment",
        "Government Budget and the Economy",
        "Open Economy Macroeconomics",
        "Introduction",
        "Theory of Consumer Behaviour",
        "Production and Costs",
        "The Theory of the Firm under Perfect Competition",
        "Market Equilibrium",
        "Non-competitive Markets",
      ],
    },
  },
  mathematics: {
    name: "Mathematics",
    stream: "commerce",
    chapters: {
      11: [
        "Sets",
        "Relations and Functions",
        "Trigonometric Functions",
        "Complex Numbers and Quadratic Equations",
        "Linear Inequalities",
        "Permutations and Combinations",
        "Binomial Theorem",
        "Sequences and Series",
        "Straight Lines",
        "Conic Sections",
        "Introduction to Three Dimensional Geometry",
        "Limits and Derivatives",
        "Statistics",
        "Probability",
      ],
      12: [
        "Relations and Functions",
        "Inverse Trigonometric Functions",
        "Matrices",
        "Determinants",
        "Continuity and Differentiability",
        "Application of Derivatives",
        "Integrals",
        "Application of Integrals",
        "Differential Equations",
        "Vector Algebra",
        "Three Dimensional Geometry",
        "Linear Programming",
        "Probability",
      ],
    },
  },
  english: {
    name: "English",
    stream: "commerce",
    chapters: {
      11: [
        "Comprehension Skills",
        "Vocabulary",
        "Grammar - Tenses",
        "Grammar - Articles",
        "Grammar - Prepositions",
        "Grammar - Subject-Verb Agreement",
        "Business English",
      ],
      12: [
        "Comprehension Skills",
        "Vocabulary",
        "Grammar - Modals",
        "Grammar - Reported Speech",
        "Business English",
      ],
    },
  },
  hindi: {
    name: "Hindi",
    stream: "commerce",
    chapters: {
      11: [
        "व्याकरण - संधि",
        "व्याकरण - समास",
        "व्याकरण - उपसर्ग",
        "व्याकरण - प्रत्यय",
        "व्याकरण - पर्यायवाची",
        "व्याकरण - विलोम",
        "व्याकरण - मुहावरा",
        "व्याकरण - काल",
        "व्याकरण - वाक्य",
        "व्याकरण - वर्तनी",
      ],
      12: [
        "व्याकरण - संधि",
        "व्याकरण - समास",
        "व्याकरण - काल",
        "व्याकरण - पर्यायवाची",
        "व्याकरण - विलोम",
        "व्याकरण - मुहावरा",
        "व्याकरण - अलंकार",
        "व्याकरण - रस",
        "व्याकरण - अव्यय",
        "व्याकरण - वाच्य",
        "व्याकरण - वाक्य शुद्धि",
        "व्याकरण - वर्तनी",
      ],
    },
  },
  mathematics_9: {
    name: "Mathematics",
    stream: null,
    chapters: {
      9: [
        "Number Systems",
        "Polynomials",
        "Coordinate Geometry",
        "Linear Equations in Two Variables",
        "Introduction to Euclid's Geometry",
        "Lines and Angles",
        "Triangles",
        "Quadrilaterals",
        "Areas of Parallelograms and Triangles",
        "Circles",
        "Constructions",
        "Heron's Formula",
        "Surface Areas and Volumes",
        "Statistics",
        "Probability",
      ],
    },
  },
  mathematics_10: {
    name: "Mathematics",
    stream: null,
    chapters: {
      10: [
        "Real Numbers",
        "Polynomials",
        "Pair of Linear Equations in Two Variables",
        "Quadratic Equations",
        "Arithmetic Progressions",
        "Triangles",
        "Coordinate Geometry",
        "Introduction to Trigonometry",
        "Some Applications of Trigonometry",
        "Circles",
        "Areas Related to Circles",
        "Surface Areas and Volumes",
        "Statistics",
        "Probability",
      ],
    },
  },
  science_9: {
    name: "Science",
    stream: null,
    chapters: {
      9: [
        "Matter in Our Surroundings",
        "Is Matter Around Us Pure",
        "Atoms and Molecules",
        "Structure of the Atom",
        "The Fundamental Unit of Life",
        "Tissues",
        "Diversity in Living Organisms",
        "Motion",
        "Force and Laws of Motion",
        "Gravitation",
        "Work and Energy",
        "Sound",
        "Why Do We Fall Ill",
        "Natural Resources",
        "Improvement in Food Resources",
      ],
    },
  },
  science_10: {
    name: "Science",
    stream: null,
    chapters: {
      10: [
        "Chemical Reactions and Equations",
        "Acids, Bases and Salts",
        "Metals and Non-metals",
        "Carbon and its Compounds",
        "Periodic Classification of Elements",
        "Life Processes",
        "Control and Coordination",
        "How do Organisms Reproduce",
        "Heredity and Evolution",
        "Light - Reflection and Refraction",
        "The Human Eye and the Colourful World",
        "Electricity",
        "Magnetic Effects of Electric Current",
        "Sources of Energy",
        "Our Environment",
        "Management of Natural Resources",
      ],
    },
  },
  social_science_9: {
    name: "Social Science",
    stream: null,
    chapters: {
      9: [
        "The French Revolution",
        "Socialism in Europe and the Russian Revolution",
        "Nazism and the Rise of Hitler",
        "Forest Society and Colonialism",
        "Pastoralists in the Modern World",
        "India - Size and Location",
        "Physical Features of India",
        "Drainage",
        "Climate",
        "Natural Vegetation and Wildlife",
        "Population",
        "What is Democracy? Why Democracy?",
        "Constitutional Design",
        "Electoral Politics",
        "Working of Institutions",
        "Democratic Rights",
        "The Story of Village Palampur",
        "People as Resource",
        "Poverty as a Challenge",
        "Food Security in India",
      ],
    },
  },
  social_science_10: {
    name: "Social Science",
    stream: null,
    chapters: {
      10: [
        "The Rise of Nationalism in Europe",
        "Nationalism in India",
        "The Making of a Global World",
        "The Age of Industrialisation",
        "Print Culture and the Modern World",
        "Resources and Development",
        "Forest and Wildlife Resources",
        "Water Resources",
        "Agriculture",
        "Minerals and Energy Resources",
        "Manufacturing Industries",
        "Lifelines of National Economy",
        "Power Sharing",
        "Federalism",
        "Democracy and Diversity",
        "Gender, Religion and Caste",
        "Popular Struggles and Movements",
        "Political Parties",
        "Outcomes of Democracy",
        "Development",
        "Sectors of the Indian Economy",
        "Money and Credit",
        "Globalisation and the Indian Economy",
        "Consumer Rights",
      ],
    },
  },
  english_9: {
    name: "English",
    stream: null,
    chapters: {
      9: [
        "Grammar - Tenses",
        "Grammar - Modals",
        "Grammar - Determiners",
        "Grammar - Subject-Verb Agreement",
        "Grammar - Prepositions",
        "Grammar - Articles",
        "Grammar - Reported Speech",
        "Grammar - Active and Passive Voice",
        "Grammar - Clauses",
        "Vocabulary",
        "Comprehension Skills",
      ],
    },
  },
  english_10: {
    name: "English",
    stream: null,
    chapters: {
      10: [
        "Grammar - Tenses",
        "Grammar - Modals",
        "Grammar - Determiners",
        "Grammar - Subject-Verb Agreement",
        "Grammar - Reported Speech",
        "Grammar - Active and Passive Voice",
        "Grammar - Clauses",
        "Grammar - Gap Filling and Editing",
        "Grammar - Sentence Reordering",
        "Vocabulary",
        "Comprehension Skills",
      ],
    },
  },
  hindi_9: {
    name: "Hindi",
    stream: null,
    chapters: {
      9: [
        "व्याकरण - संधि",
        "व्याकरण - समास",
        "व्याकरण - उपसर्ग",
        "व्याकरण - प्रत्यय",
        "व्याकरण - पर्यायवाची",
        "व्याकरण - विलोम",
        "व्याकरण - मुहावरा",
        "व्याकरण - काल",
        "व्याकरण - वाक्य",
        "व्याकरण - वर्तनी",
        "व्याकरण - अनेकार्थी शब्द",
      ],
    },
  },
  hindi_10: {
    name: "Hindi",
    stream: null,
    chapters: {
      10: [
        "व्याकरण - संधि",
        "व्याकरण - समास",
        "व्याकरण - उपसर्ग",
        "व्याकरण - प्रत्यय",
        "व्याकरण - पर्यायवाची",
        "व्याकरण - विलोम",
        "व्याकरण - मुहावरा",
        "व्याकरण - काल",
        "व्याकरण - वाक्य",
        "व्याकरण - वर्तनी",
        "व्याकरण - रस",
        "व्याकरण - अलंकार",
      ],
    },
  },
};

function slug(s) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9ऀ-ॿ]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/** Retries a raw network-level failure (DNS blip, connection reset) a couple
 * times before giving up — an HTTP error response (4xx/5xx) is NOT retried
 * here, it's returned normally so the caller's own round-retry logic handles it. */
async function fetchWithNetworkRetry(url, options) {
  const delays = [1000, 3000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      return await fetch(url, options);
    } catch (e) {
      if (attempt >= delays.length) throw e;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

async function callGemini(system, user) {
  const res = await fetchWithNetworkRetry(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://gurukul.app",
      "X-Title": "Gurukul RBSE Question Bank Generator",
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.4,
      max_tokens: 16000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`);
  }
  const json = await res.json();
  const text = json?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Empty model response: " + JSON.stringify(json).slice(0, 300));
  }
  return text.trim();
}

/** Repair raw (unescaped) control characters inside JSON string literals —
 * a common LLM mistake (embedding a literal newline/tab in a string value
 * instead of \n/\t). Valid JSON never contains a raw control char inside a
 * string, so this can only fix broken input, never break valid input. */
function repairControlCharsInStrings(s) {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const code = s.charCodeAt(i);
    if (inString && !escaped && code >= 0 && code < 0x20) {
      if (ch === "\n") out += "\\n";
      else if (ch === "\t") out += "\\t";
      else if (ch === "\r") out += "\\r";
      else out += " ";
      continue;
    }
    out += ch;
    if (inString && !escaped && ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"' && !escaped) inString = !inString;
    escaped = false;
  }
  return out;
}

function extractJson(text) {
  let t = text.trim();
  // Strip markdown code fences if present
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  const start = t.indexOf("[");
  const end = t.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("No JSON array found in model output. First 300 chars: " + t.slice(0, 300));
  }
  const candidate = t.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch {
    // Retry once after repairing raw control characters inside strings.
    return JSON.parse(repairControlCharsInStrings(candidate));
  }
}

const SYSTEM_PROMPT = `You are a subject-matter expert writing an RBSE (Rajasthan Board) school MCQ question bank for a real school app called Gurukul. You write ORIGINAL questions inspired by standard NCERT/RBSE syllabus topics — you must NEVER reproduce actual NCERT textbook question text verbatim (copyright). Output STRICT JSON ONLY, no markdown, no commentary, no code fences — just a raw JSON array.

Every question object must have exactly these fields:
{"concept": "short_snake_case_slug", "q": "question text", "o": ["option A","option B","option C","option D"], "c": 0, "e": "explanation text", "diff": "easy"|"medium"|"hard"}

Rules — follow exactly, these are non-negotiable:
- Exactly 4 options, exactly ONE unambiguously correct option. "c" is the 0-based index of the correct option.
- For ANY numerical/calculation question: solve it yourself step by step before writing the options. Never write a plausible-looking number you haven't actually verified.
- Never guess a specific fact, date, section number, or figure you are not confident about — write a safer question on the same topic instead.
- No duplicate or near-duplicate questions within your output.
- "explanation" must genuinely justify why the marked answer is correct, not just restate the question.
- Difficulty mix across your whole batch: roughly 30% easy, 45% medium, 25% hard.
- Write every question, option, and explanation in the SAME language as the chapter name given to you (English chapter name -> English content; Hindi/Devanagari chapter name -> full Hindi content, verified spelling/matras). Do not switch language.
- Do not include any text before or after the JSON array. The entire response must be valid JSON starting with [ and ending with ].`;

const DEVANAGARI_RE = /[ऀ-ॿ]/;

async function generateChapter(subjectKey, subjectName, classLevel, chapter, count, existingItems = [], stream = null) {
  const topUp = existingItems.length > 0;
  const existingBlock = topUp
    ? `\n\nThis chapter ALREADY has ${existingItems.length} questions covering these concepts: ${[...new Set(existingItems.map((i) => i.concept))].join(", ")}.\nExisting question texts (do NOT repeat or closely rephrase any of these):\n${existingItems.map((i) => "- " + i.q).join("\n")}\n\nWrite ${count} MORE questions that either go deeper on an existing concept (different angle, different numbers/scenario) or cover a genuinely new sub-topic within this chapter not yet represented.`
    : `\n\nWrite ${count} original MCQ questions for this exact chapter, spread across 3-6 real sub-topics within it (put a genuine short topic identifier as the "concept" field, snake_case, e.g. "journal_entries", "depreciation_methods" — group multiple questions under the same concept slug when they share a sub-topic).`;

  const streamLabel = stream ? ` (RBSE ${stream[0].toUpperCase()}${stream.slice(1)} stream)` : "";
  const user = `Subject: ${subjectName}
Class: ${classLevel}${streamLabel}
Chapter: "${chapter}"${existingBlock}

Return the JSON array now.`;

  const raw = await callGemini(SYSTEM_PROMPT, user);
  const parsed = extractJson(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Parsed JSON was not a non-empty array");
  }
  // Basic structural validation — reject the whole chapter response if shape is wrong
  for (const item of parsed) {
    if (
      typeof item.q !== "string" ||
      !Array.isArray(item.o) ||
      item.o.length !== 4 ||
      typeof item.c !== "number" ||
      item.c < 0 ||
      item.c > 3 ||
      typeof item.e !== "string" ||
      typeof item.concept !== "string"
    ) {
      throw new Error("Malformed question object: " + JSON.stringify(item).slice(0, 300));
    }
    // Language-purity gate: only the "hindi" subject may contain Devanagari.
    // Every other Commerce subject in this seed is English-medium — a model
    // that switches language mid-batch (seen from google/gemini-2.5-flash-lite)
    // must have its WHOLE chapter response rejected, not silently kept.
    if (subjectKey !== "hindi") {
      const blob = item.q + " " + item.o.join(" ") + " " + item.e;
      if (DEVANAGARI_RE.test(blob)) {
        throw new Error(
          "Language contamination: Devanagari text in a non-Hindi subject. Item: " +
            JSON.stringify(item).slice(0, 200),
        );
      }
    } else {
      // Inverse check: Hindi subject content must actually BE in Devanagari —
      // catches the model silently falling back to English despite the
      // language instruction, which would otherwise pass structural validation.
      if (!DEVANAGARI_RE.test(item.q)) {
        throw new Error(
          "Hindi subject produced non-Devanagari question text: " + JSON.stringify(item).slice(0, 200),
        );
      }
    }
  }
  return parsed;
}

async function main() {
  const subjectKey = process.argv[2];
  const subject = SUBJECTS[subjectKey];
  if (!subject) {
    console.error("Usage: node gen-via-openrouter.mjs <subject-key>");
    console.error("Valid keys:", Object.keys(SUBJECTS).join(", "));
    process.exit(1);
  }

  const cacheSubjectDir = path.join(CACHE_DIR, subjectKey);
  fs.mkdirSync(cacheSubjectDir, { recursive: true });

  const TARGET_PER_CHAPTER = Number(process.env.QB_TARGET_PER_CHAPTER || 40);
  // Smaller batches per call = shorter JSON responses = fewer malformed-JSON
  // retries (Mathematics specifically was failing ~50% of rounds at 14/call,
  // likely from notation-heavy content tripping up JSON string escaping).
  const ROUND_SIZE = Number(process.env.QB_ROUND_SIZE || 10);

  console.log(`=== Generating ${subject.name} via ${MODEL} (target ${TARGET_PER_CHAPTER}/chapter) ===`);

  try {
    const startBudget = await assertBudgetOk();
    console.log(
      `Budget: $${startBudget.usage.toFixed(4)} spent of $${BUDGET_LIMIT_USD.toFixed(2)} limit ($${startBudget.remaining.toFixed(4)} remaining, will stop with $${SAFETY_MARGIN_USD.toFixed(2)} margin left)`,
    );
  } catch (e) {
    if (e instanceof BudgetExceededError) {
      console.log(`\nBUDGET LIMIT ALREADY REACHED before starting: ${e.message}`);
      return;
    }
    throw e;
  }

  let chaptersAtTarget = 0;
  let chaptersBelowTarget = 0;
  const classLevels = Object.keys(subject.chapters).map(Number).sort((a, b) => a - b);
  const totalChapters = classLevels.reduce((sum, cl) => sum + (subject.chapters[cl]?.length || 0), 0);
  let budgetStopped = false;

  const jobs = [];
  for (const classLevel of classLevels) {
    for (const chapter of subject.chapters[classLevel] || []) jobs.push({ classLevel, chapter });
  }
  jobs.forEach((j, i) => (j.idx = i + 1));

  /** Process one chapter to target, fully self-contained (own cache file,
   * own round loop) — safe to run several of these concurrently since each
   * touches a different file and the only shared state (budgetStopped) is
   * a plain boolean checked/set between awaits, which is race-free in JS's
   * single-threaded event loop. */
  async function processChapter({ classLevel, chapter, idx }) {
    if (budgetStopped) return;
    const cacheFile = path.join(cacheSubjectDir, `${classLevel}-${slug(chapter)}.json`);
    let existing = [];
    if (fs.existsSync(cacheFile)) {
      existing = JSON.parse(fs.readFileSync(cacheFile, "utf8")).items;
      if (subjectKey !== "hindi") {
        const before = existing.length;
        existing = existing.filter((it) => !DEVANAGARI_RE.test(it.q + " " + it.o.join(" ") + " " + it.e));
        const removed = before - existing.length;
        if (removed > 0) {
          console.log(`  [purged ${removed} pre-existing Devanagari-contaminated item(s) from cache — will regenerate]`);
          fs.writeFileSync(cacheFile, JSON.stringify({ subject: subject.name, stream: subject.stream ?? null, classLevel, chapter, items: existing }, null, 2), "utf8");
        }
      }
    }

    let stalledRounds = 0;
    while (existing.length < TARGET_PER_CHAPTER && stalledRounds < 3 && !budgetStopped) {
      try {
        await assertBudgetOk();
      } catch (e) {
        if (e instanceof BudgetExceededError) {
          console.log(`\nBUDGET LIMIT REACHED: ${e.message}`);
          console.log("Stopping the whole run now. Everything generated so far is already saved to disk.");
          budgetStopped = true;
          return;
        }
        throw e;
      }
      const remaining = TARGET_PER_CHAPTER - existing.length;
      const askFor = Math.min(ROUND_SIZE, remaining);
      process.stdout.write(
        `[${idx}/${totalChapters}] ${classLevel} — ${chapter} (${existing.length}/${TARGET_PER_CHAPTER}, +${askFor}) ... `,
      );
      try {
        const newItems = await generateChapter(subjectKey, subject.name, classLevel, chapter, askFor, existing, subject.stream ?? null);
        // De-dup against existing by exact question text before merging.
        const existingTexts = new Set(existing.map((i) => i.q.trim().toLowerCase()));
        const merged = [...existing];
        let addedCount = 0;
        for (const it of newItems) {
          const key = it.q.trim().toLowerCase();
          if (existingTexts.has(key)) continue;
          existingTexts.add(key);
          merged.push(it);
          addedCount++;
        }
        existing = merged;
        fs.writeFileSync(cacheFile, JSON.stringify({ subject: subject.name, stream: subject.stream ?? null, classLevel, chapter, items: existing }, null, 2), "utf8");
        console.log(`OK (+${addedCount} new, ${existing.length}/${TARGET_PER_CHAPTER} total, saved)`);
        if (addedCount === 0) stalledRounds++;
        else stalledRounds = 0;
      } catch (e) {
        console.log(`round FAILED: ${e.message}`);
        stalledRounds++;
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    if (existing.length >= TARGET_PER_CHAPTER) chaptersAtTarget++;
    else if (!budgetStopped) {
      chaptersBelowTarget++;
      console.log(`  [chapter below target after retries: ${existing.length}/${TARGET_PER_CHAPTER} — will retry on next run]`);
    }
  }

  // Concurrency-limited worker pool: several chapters generate at once
  // (independent API calls, independent cache files) instead of strictly
  // one at a time — same per-question rigor, more wall-clock throughput.
  const CONCURRENCY = Number(process.env.QB_CONCURRENCY || 3);
  let nextJob = 0;
  async function worker() {
    while (nextJob < jobs.length && !budgetStopped) {
      const job = jobs[nextJob++];
      await processChapter(job);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()));

  console.log(
    `\n=== ${subject.name}: ${chaptersAtTarget}/${totalChapters} chapters at target, ${chaptersBelowTarget} below target ===`,
  );
  console.log(`Cache dir: ${cacheSubjectDir}`);
  if (budgetStopped) {
    const final = await getRemoteUsageUsd().catch(() => null);
    console.log(
      `\n*** RUN STOPPED EARLY — BUDGET LIMIT ***${final !== null ? ` ($${final.toFixed(4)} of $${BUDGET_LIMIT_USD.toFixed(2)} spent)` : ""}`,
    );
  } else if (chaptersBelowTarget > 0) {
    console.log(`Re-run the same command to top up chapters still below target.`);
  }
}

/** main() is fully resumable (already-cached/at-target chapters are skipped),
 * so an unattended run auto-restarts on any uncaught crash instead of just
 * dying — a transient failure should cost a retry, not require someone to
 * come back and re-run the command by hand. */
async function runWithAutoRestart() {
  const MAX_RESTARTS = 15;
  for (let attempt = 1; attempt <= MAX_RESTARTS; attempt++) {
    try {
      await main();
      return;
    } catch (e) {
      console.error(`\nCRASHED (attempt ${attempt}/${MAX_RESTARTS}): ${e.message}`);
      if (attempt >= MAX_RESTARTS) {
        console.error("Giving up after max restarts. Everything generated so far is saved — re-run manually to continue.");
        process.exit(1);
      }
      const delay = Math.min(30000, 2000 * attempt);
      console.error(`Restarting in ${delay / 1000}s...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

runWithAutoRestart();
