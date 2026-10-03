/**
 * AI Practice (owner's ruling 2026-10-02): a student asks in their own words —
 * "20 medium questions on goodwill" — and gets a practice session of it. The
 * bank answers first; AI writes only the shortfall, and a question it writes
 * is kept only if a second, independent solve reaches the same answer. What is
 * kept enters the shared bank (store_generated_questions), tagged.
 *
 * This module is the pure half: prompts, and the reading and checking of what
 * the model returns. The ai-practice function does the calls. No Deno, no
 * network — aiPractice.test.ts runs it.
 */
import type { SyllabusChapter } from "./syllabusTag.ts";
import { extractJson } from "./structuredJson.ts";
import { composeExplanation, explanationShortfall, indexOfLetter, letterOf, readExplanationParts } from "./explanationFormat.ts";
import {
  AR_OPTIONS,
  canonicalMatch,
  canonicalOrder,
  composeQuestion,
  FORM_JSON_GUIDE,
  FORM_LABELS,
  isQuestionForm,
  optionsShortfall,
  QUESTION_FORMS,
  type QuestionForm,
  readQuestionParts,
} from "./questionForms.ts";

/** Owner: up to 30 questions in one request. */
export const MAX_QUESTIONS = 30;
export const DEFAULT_QUESTIONS = 10;
export const PROMPT_MAX_CHARS = 500;
export const OPTION_COUNT = 4;
export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

// ── 1. Reading the request ─────────────────────────────────────────────────

export type ReadRequest =
  | {
      kind: "practice";
      chapter: SyllabusChapter;
      topicId: string | null;
      focus: string;
      count: number;
      difficulty: Difficulty | null;
      /** The form the student asked for — "assertion reason questions", "long case questions" — or null for a mix. */
      form: QuestionForm | null;
    }
  | { kind: "refuse"; message: string };

function syllabusLines(syllabus: ReadonlyArray<SyllabusChapter>): string {
  return syllabus
    .map((c) => {
      const topics = c.topics.length ? ` [topics: ${c.topics.map((t, i) => `T${i + 1} ${t.name}`).join("; ")}]` : "";
      return `${c.code} · ${c.subject} › ${c.chapter}${topics}`;
    })
    .join("\n");
}

export function requestSystemPrompt(examLabel: string, syllabus: ReadonlyArray<SyllabusChapter>): string {
  return [
    `A ${examLabel} student types what they want to practise. Read it into ONE chapter of their syllabus.`,
    "",
    "The syllabus, one chapter per line (code · subject › chapter [topics: code name; …]):",
    syllabusLines(syllabus),
    "",
    "Reply with JSON only:",
    `{"kind":"practice","chapter":"C<n>","topic":"T<n>" or null,"focus":"<the exact idea asked for, max 12 words>","count":<1-${MAX_QUESTIONS} or null>,"difficulty":"easy"|"medium"|"hard"|null,"form":${QUESTION_FORMS.map((f) => `"${f}"`).join("|")}|null}`,
    'or {"kind":"refuse","reason":"<one plain sentence to the student>"}',
    "",
    "Rules:",
    "- chapter is the code of the ONE chapter the request is about. A request naming a topic picks that topic's chapter.",
    "- topic is set only when the request is about one listed topic of that chapter; otherwise null.",
    "- count is the number of questions asked for; null when none is said.",
    "- difficulty only when the student said it.",
    '- form only when the student asked for one kind of question: assertion–reason → "assertion_reason"; statement-based → "statements"; match the following → "match"; case-based, passage-based or long questions → "case_based"; chronological order or sequence → "sequence"; direct or one-line questions → "mcq". Otherwise null.',
    "- refuse when the request is not about practising questions, is about a subject not in this syllabus, or spans several chapters with no single one to choose — and say which, kindly, naming chapters by their names, never by their codes.",
  ].join("\n");
}

export function readRequestReply(raw: unknown, syllabus: ReadonlyArray<SyllabusChapter>): ReadRequest {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (r.kind === "refuse") {
    // A refusal is the student's to read: the syllabus codes it was given are
    // turned back into chapter names ("covered in C2, C3…", measured 2026-10-03).
    const named = (s: string) => s.replace(/\bC(\d+)\b/g, (code) => {
      const c = syllabus.find((x) => x.code === code);
      return c ? `“${c.chapter}”` : code;
    });
    const reason = typeof r.reason === "string" && r.reason.trim() ? named(r.reason.trim()) : null;
    return { kind: "refuse", message: reason ?? "That isn't something AI Practice can make a session of. Name a chapter or topic from your syllabus." };
  }
  const chapter = syllabus.find((c) => c.code === String(r.chapter ?? "").trim().toUpperCase());
  if (!chapter) {
    return { kind: "refuse", message: "I couldn't match that to a chapter of your syllabus. Try naming the chapter or topic." };
  }
  const tm = String(r.topic ?? "").trim().toUpperCase().match(/^T(\d+)$/);
  const topic = tm ? chapter.topics[Number(tm[1]) - 1] ?? null : null;
  const n = typeof r.count === "number" ? Math.round(r.count) : Number.NaN;
  const count = Number.isFinite(n) && n >= 1 ? Math.min(MAX_QUESTIONS, n) : DEFAULT_QUESTIONS;
  const d = String(r.difficulty ?? "").trim().toLowerCase();
  const difficulty = (DIFFICULTIES as readonly string[]).includes(d) ? (d as Difficulty) : null;
  const focus = typeof r.focus === "string" ? r.focus.replace(/\s+/g, " ").trim().slice(0, 120) : "";
  const form = isQuestionForm(r.form) ? r.form : null;
  return { kind: "practice", chapter, topicId: topic?.id ?? null, focus: focus || topic?.name || chapter.chapter, count, difficulty, form };
}

// ── 2. A chapter with no topics gets its topic list drafted once ────────────

export function topicDraftPrompt(examLabel: string, subject: string, chapter: string): { system: string; user: string } {
  return {
    system: [
      `You list the topics of one chapter of the ${examLabel} syllabus, as the NCERT Class 12 textbook divides it.`,
      'Reply with JSON only: {"topics":["…","…"]} — 3 to 12 topics, in the book\'s order, each a short name (2–6 words), no numbering, no two alike.',
    ].join("\n"),
    user: `Subject: ${subject}\nChapter: ${chapter}`,
  };
}

export function readTopicDraft(raw: unknown): string[] | null {
  const list = (raw && typeof raw === "object" ? (raw as { topics?: unknown }).topics : null);
  if (!Array.isArray(list)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of list) {
    const name = String(t ?? "").replace(/^\s*\d+[.)]\s*/, "").replace(/\s+/g, " ").trim();
    if (name.length < 3 || name.length > 60) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out.length >= 3 ? out.slice(0, 12) : null;
}

// ── 3. Writing questions ────────────────────────────────────────────────────

export type StyleExample = { question: string; options: string[]; correct_index: number };

export function writeSystemPrompt(examLabel: string): string {
  return [
    `You write multiple-choice questions for students preparing for ${examLabel}, at the level of the real exam, from the NCERT Class 12 syllabus.`,
    "",
    "Each question:",
    `- has exactly ${OPTION_COUNT} options and exactly one correct answer; the wrong options are plausible mistakes a student makes, never jokes;`,
    "- states every number a calculation needs, and the arithmetic must be right — check it before you answer;",
    "- stays inside the chapter it is written for, and cites a law or section only when you are certain of its number;",
    '- never repeats its options inside the question text, never carries labels such as "[Chapter name]", and never mentions "the student" or "the original question".',
    "",
    "Each explanation:",
    "- working: the full reasoning, step by step, as a good teacher writes it — at least 3 sentences (120+ characters) and at most 150 words; for a calculation, every step with its numbers. Settle the answer before you write: the JSON holds only the finished explanation, never your deliberation (\"But if…? No, …\");",
    "- wrong: one line for EACH wrong option saying exactly why it is wrong (the error that leads to it), 25+ characters, never just \"incorrect\".",
    "",
    "",
    FORM_JSON_GUIDE,
    "",
    "Reply with JSON only:",
    '{"questions":[{"topic":"T<n>","difficulty":"easy"|"medium"|"hard","form":"<form>", …that form\'s fields…, "options":["…","…","…","…"],"answer":"A"|"B"|"C"|"D","working":"…","wrong":[{"option":"A","reason":"…"},…]}]}',
  ].join("\n");
}

export function writeUserPrompt(input: {
  subject: string;
  chapter: string;
  topics: ReadonlyArray<{ id: string; name: string }>;
  topicId: string | null;
  focus: string;
  difficulty: Difficulty | null;
  form: QuestionForm | null;
  count: number;
  examples: ReadonlyArray<StyleExample>;
  avoid: ReadonlyArray<string>;
}): string {
  const topicLines = input.topics.map((t, i) => `T${i + 1} ${t.name}`).join("; ");
  const only = input.topicId ? input.topics.findIndex((t) => t.id === input.topicId) : -1;
  const examples = input.examples.slice(0, 3).map((e, i) =>
    `Example ${i + 1}: ${e.question}\n${e.options.map((o, k) => `  ${letterOf(k)}. ${o}`).join("\n")}\n  Answer: ${letterOf(e.correct_index)}`);
  return [
    `Subject: ${input.subject}`,
    `Chapter: ${input.chapter}`,
    `Topics (answer "topic" with one of these codes): ${topicLines}`,
    only >= 0 ? `Every question is on topic T${only + 1}.` : "Spread the questions across the topics the request is about.",
    `The student asked for: ${input.focus}`,
    `Write ${input.count} question${input.count === 1 ? "" : "s"}${input.difficulty ? `, all ${input.difficulty}` : ", a mix of easy, medium and hard"}.`,
    input.form
      ? `Every question is ${FORM_LABELS[input.form].toLowerCase()} (form "${input.form}").`
      : "Use the form that suits each idea, as the real exam mixes them: mostly direct questions, with assertion–reason, statement-based, match-the-following, case-based and sequence questions where they fit.",
    examples.length ? `\nReal questions from this chapter, for the level and style (do not copy them):\n${examples.join("\n\n")}` : "",
    input.avoid.length ? `\nDo not write these again:\n${input.avoid.slice(0, 30).map((q) => `- ${q.slice(0, 160)}`).join("\n")}` : "",
  ].filter(Boolean).join("\n");
}

/** At most this many drafts for one request, whatever was asked. */
export const MAX_DRAFTS = 40;

/**
 * How a shortfall is written, by form: room per question, questions per call,
 * and drafts written for each one needed (the checks throw some away).
 * Measured 2026-10-03 on "5 match the following questions": a call for five at
 * 1,000 tokens each was cut off ("length") and nothing in it could be read; of
 * a call for four, three came back with no explanation and one had List II in
 * List I's order. A form is longer and fails more often than a direct question.
 * No form asked for (null) means the exam's mix.
 */
const FORM_PLAN: Record<QuestionForm | "mix", { tokens: number; batch: number; overwrite: number }> = {
  mcq: { tokens: 1000, batch: 5, overwrite: 1.5 },
  assertion_reason: { tokens: 1200, batch: 5, overwrite: 1.75 },
  statements: { tokens: 1400, batch: 4, overwrite: 2 },
  sequence: { tokens: 1400, batch: 4, overwrite: 2 },
  // Two to a call: three match questions took most of a minute to write and
  // the whole request 150 seconds — the function's limit (2026-10-03).
  match: { tokens: 1900, batch: 2, overwrite: 2.5 },
  case_based: { tokens: 1900, batch: 2, overwrite: 2 },
  mix: { tokens: 1500, batch: 4, overwrite: 1.75 },
};

export function writePlan(form: QuestionForm | null, shortfall: number): { batches: number[]; maxTokens: (n: number) => number } {
  const plan = FORM_PLAN[form ?? "mix"];
  const need = Math.min(MAX_DRAFTS, Math.ceil(shortfall * plan.overwrite) + 1);
  const batches: number[] = [];
  for (let left = need; left > 0; left -= plan.batch) batches.push(Math.min(plan.batch, left));
  return { batches, maxTokens: (n) => plan.tokens * n + 400 };
}

export type WrittenQuestion = {
  topicId: string;
  difficulty: Difficulty;
  form: QuestionForm;
  /** The stored text, composed from the form's parts (questionForms). */
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

const LEAKS = /\bthe student\b|\boriginal question\b|\bas an ai\b/i;
const TRAILING_LABEL = /\[[A-Z][^\]\n]{2,80}\]\s*$/;

/**
 * One drafted question read and checked, or the reason it is not kept. The
 * checks are the faults measured in the 41 AI questions already in the bank
 * (2026-10-02): options repeated in the question, chapter labels left in it,
 * explanations addressed to "the student", one-line explanations.
 */
export function readWrittenQuestion(
  raw: unknown,
  topics: ReadonlyArray<{ id: string; name: string }>,
  topicId: string | null,
): { ok: true; question: WrittenQuestion } | { ok: false; reason: string } {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "not an object" };
  const r = raw as Record<string, unknown>;
  const read = readQuestionParts(r);
  if (!read.ok) return { ok: false, reason: read.reason };
  const shape = read.parts;
  const question = composeQuestion(shape);
  if (question.length < 15 || question.length > 4000) return { ok: false, reason: "question length" };
  // An assertion–reason question's options are the standard four, whatever was sent.
  const sent = shape.form === "assertion_reason" ? [...AR_OPTIONS] : r.options;
  if (!Array.isArray(sent) || sent.length !== OPTION_COUNT) return { ok: false, reason: `needs ${OPTION_COUNT} options` };
  const plain = sent.map((o) => String(o ?? "").replace(/\s+/g, " ").trim());
  // A matching or an order is stored one way, however it was written.
  const options = shape.form === "match"
    ? plain.map((o) => canonicalMatch(o, shape.list1.length) ?? o)
    : shape.form === "sequence"
      ? plain.map((o) => canonicalOrder(o, shape.items.length) ?? o)
      : plain;
  if (options.some((o) => !o)) return { ok: false, reason: "an empty option" };
  if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) return { ok: false, reason: "options repeat" };
  const correctIndex = indexOfLetter(r.answer);
  if (correctIndex == null || correctIndex >= options.length) return { ok: false, reason: "no valid answer" };
  if (TRAILING_LABEL.test(question)) return { ok: false, reason: "a label left in the question" };
  if (LEAKS.test(question)) return { ok: false, reason: "the question talks about the student" };
  if (shape.form === "mcq") {
    const quoted = options.filter((o) => o.length >= 6 && question.includes(o)).length;
    if (quoted >= 3) return { ok: false, reason: "the options are repeated in the question" };
  }
  const misfit = optionsShortfall(shape, options, correctIndex);
  if (misfit) return { ok: false, reason: misfit };

  const tm = String(r.topic ?? "").trim().toUpperCase().match(/^T(\d+)$/);
  const picked = tm ? topics[Number(tm[1]) - 1] : undefined;
  const topic = topicId ? topics.find((t) => t.id === topicId) : picked;
  if (!topic) return { ok: false, reason: "no topic of the chapter" };

  const d = String(r.difficulty ?? "").trim().toLowerCase();
  const difficulty = ((DIFFICULTIES as readonly string[]).includes(d) ? d : "medium") as Difficulty;

  const parts = readExplanationParts(r);
  if (!parts) return { ok: false, reason: "no explanation" };
  if (LEAKS.test(parts.working) || parts.wrong.some((w) => LEAKS.test(w.reason))) {
    return { ok: false, reason: "the explanation talks about the student" };
  }
  const short = explanationShortfall(options, correctIndex, parts);
  if (short) return { ok: false, reason: short };
  const explanation = composeExplanation(options, correctIndex, parts)!;
  return { ok: true, question: { topicId: topic.id, difficulty, form: shape.form, question, options, correctIndex, explanation } };
}

// ── 4. The independent check ────────────────────────────────────────────────

export function solveSystemPrompt(examLabel: string): string {
  return [
    `You are an expert examiner for ${examLabel}. Solve each multiple-choice question yourself.`,
    "Work it out before you answer: put the key steps in \"working\" — at most 80 words, numbers written plainly, no LaTeX or backslashes — then give the one correct option.",
    'If no option is correct, or more than one is, answer "none".',
    'Reply with JSON only: {"answers":[{"n":1,"working":"…","answer":"A"|"B"|"C"|"D"|"none"}]}',
  ].join("\n");
}

export function solveUserPrompt(items: ReadonlyArray<{ question: string; options: string[] }>): string {
  return items
    .map((q, i) => `Question ${i + 1}: ${q.question}\n${q.options.map((o, k) => `  ${letterOf(k)}. ${o}`).join("\n")}`)
    .join("\n\n");
}

/** The solver's answer for each of `count` questions, by position; null where it gave none. */
export function readSolveReply(raw: unknown, count: number): Array<number | null> {
  const out: Array<number | null> = new Array(count).fill(null);
  const list = raw && typeof raw === "object" ? (raw as { answers?: unknown }).answers : null;
  if (!Array.isArray(list)) return out;
  list.forEach((a, pos) => {
    if (!a || typeof a !== "object") return;
    const o = a as { n?: unknown; answer?: unknown };
    const n = typeof o.n === "number" ? o.n - 1 : pos;
    if (n < 0 || n >= count) return;
    out[n] = indexOfLetter(o.answer);
  });
  return out;
}

/**
 * A model's JSON reply, read as leniently as is safe. extractJson first; then
 * again with backslashes that are not JSON escapes doubled — a model writing
 * maths (\\frac, \\times, \\%) in a JSON string makes it unparseable — and
 * with the quotes and line breaks a writer leaves inside its strings escaped
 * (repairStrings).
 */
export function readModelJson<T>(text: string): T {
  try {
    return extractJson<T>(text);
  } catch (e) {
    const repaired = repairStrings(text.replace(/\\(?!["\\/bfnrtu])/g, "\\\\"));
    if (repaired === text) throw e;
    return extractJson<T>(repaired);
  }
}

/**
 * Inside a JSON string, a double quote that does not end it — one not followed
 * by , } ] or : — is escaped, and so is a raw line break. Measured 2026-10-03:
 * whole calls of written questions lost to "Expected ',' or '}' after property
 * value", a writer quoting a term (the "sacrificing" ratio) inside its working.
 */
export function repairStrings(text: string): string {
  const start = text.search(/[[{]/);
  if (start < 0) return text;
  let out = text.slice(0, start);
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      out += ch;
      if (ch === '"') inString = true;
      continue;
    }
    if (ch === "\\") { out += ch + (text[i + 1] ?? ""); i++; continue; }
    if (ch === "\n") { out += "\\n"; continue; }
    if (ch === "\r") continue;
    if (ch === '"') {
      const next = text.slice(i + 1).match(/^\s*(\S)/)?.[1];
      if (next === undefined || next === "," || next === "}" || next === "]" || next === ":") {
        out += ch;
        inString = false;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * The solver's answers from its raw text: the JSON when it parses, otherwise
 * each "answer" letter in the order written — the working before an answer
 * may be broken while the answers themselves are plain.
 */
export function readSolveText(text: string, count: number): Array<number | null> {
  try {
    return readSolveReply(readModelJson(text), count);
  } catch {
    const out: Array<number | null> = new Array(count).fill(null);
    const found = [...text.matchAll(/"answer"\s*:\s*"([A-Ha-h]|none)"/g)].map((m) => indexOfLetter(m[1]));
    found.slice(0, count).forEach((v, i) => { out[i] = v; });
    return out;
  }
}

// ── 5. The cache: nearness ──────────────────────────────────────────────────

export function cosine(a: number[], b: number[]): number {
  let dot = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return x && y ? dot / Math.sqrt(x * y) : 0;
}

/** A written question this close to one already kept is the same question. */
export const SAME_QUESTION_SIMILARITY = 0.92;

/**
 * Of the bank's candidates (nearest the request first), the ones close enough
 * to what was asked: within RELEVANCE_BAND of the nearest. A request with no
 * ranking (no vector) takes them in the order given.
 */
export const RELEVANCE_BAND = 0.12;
export function relevantFromBank<T extends { similarity: number | null }>(candidates: T[], want: number): T[] {
  const ranked = candidates.filter((c) => c.similarity != null);
  if (ranked.length === 0) return candidates.slice(0, want);
  const best = Math.max(...ranked.map((c) => c.similarity as number));
  return ranked.filter((c) => (c.similarity as number) >= best - RELEVANCE_BAND).slice(0, want);
}
