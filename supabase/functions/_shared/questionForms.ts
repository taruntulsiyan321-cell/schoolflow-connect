/**
 * The forms a multiple-choice question takes, and the one text layout each is
 * stored in (owner, 2026-10-03: every form CUET uses, each laid out properly,
 * shown properly wherever the question is shown).
 *
 * A question is stored as TEXT — question_bank.question, and every copy of it
 * an attempt, a mistake or a report keeps — so the layout lives in the text:
 *
 *   assertion_reason   Assertion (A): …
 *                      Reason (R): …
 *   statements         <intro>            sequence   <intro>
 *                      I. …                          I. …
 *                      II. …                         II. …
 *                      <ask>                         <ask>   (options are orders: "II, I, IV, III")
 *   match              <intro>
 *                      List I (<title>):
 *                      A. …
 *                      List II (<title>):
 *                      I. …
 *                      <ask>                (options are codes: "A-II, B-I, C-IV, D-III")
 *   case_based         Case: <the passage, one or more paragraphs>
 *                      Question: <the question>
 *   mcq                anything else
 *
 * Writers compose that text from parts (composeQuestion), so it is exact; the
 * app reads it back into blocks (readQuestionLayout) on every screen; and the
 * database classifies it (public.question_form_of, 20261141000000) into
 * question_bank.question_format. formOf here and question_form_of there are
 * held to the same fixtures by questionForms.test.ts.
 *
 * Pure: no Deno, no network.
 */

export const QUESTION_FORMS = ["mcq", "assertion_reason", "statements", "match", "case_based", "sequence"] as const;
export type QuestionForm = (typeof QUESTION_FORMS)[number];

export const FORM_LABELS: Record<QuestionForm, string> = {
  mcq: "Direct question",
  assertion_reason: "Assertion–reason",
  statements: "Statement-based",
  match: "Match the following",
  case_based: "Case-based",
  sequence: "Sequence",
};

export const isQuestionForm = (v: unknown): v is QuestionForm => (QUESTION_FORMS as readonly unknown[]).includes(v);

/** The four options of every assertion–reason question, in CUET's order. */
export const AR_OPTIONS = [
  "Both A and R are true, and R is the correct explanation of A.",
  "Both A and R are true, but R is not the correct explanation of A.",
  "A is true, but R is false.",
  "A is false, but R is true.",
] as const;

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"] as const;
const LETTERS = "ABCDEFGH";

// ── 1. Composing: parts → the stored text ───────────────────────────────────

export type QuestionParts =
  | { form: "mcq"; stem: string }
  | { form: "assertion_reason"; assertion: string; reason: string }
  | { form: "statements"; intro: string; statements: string[]; ask: string }
  | { form: "sequence"; intro: string; items: string[]; ask: string }
  | { form: "match"; intro: string; list1Title: string; list1: string[]; list2Title: string; list2: string[]; ask: string }
  | { form: "case_based"; passage: string; ask: string };

const one = (s: string) => s.replace(/\s+/g, " ").trim();
/** Paragraphs kept, everything inside them on one line. */
const paragraphs = (s: string) =>
  s.replace(/\r\n/g, "\n").split(/\n\s*\n/).map(one).filter(Boolean).join("\n\n");
const titled = (head: string, title: string) => (one(title) ? `${head} (${one(title)}):` : `${head}:`);

export function composeQuestion(p: QuestionParts): string {
  switch (p.form) {
    case "mcq":
      return paragraphs(p.stem);
    case "assertion_reason":
      return `Assertion (A): ${one(p.assertion)}\nReason (R): ${one(p.reason)}`;
    case "statements":
      return [one(p.intro), ...p.statements.map((s, i) => `${ROMAN[i]}. ${one(s)}`), one(p.ask)].filter(Boolean).join("\n");
    case "sequence":
      return [one(p.intro), ...p.items.map((s, i) => `${ROMAN[i]}. ${one(s)}`), one(p.ask)].filter(Boolean).join("\n");
    case "match":
      return [
        one(p.intro),
        titled("List I", p.list1Title),
        ...p.list1.map((s, i) => `${LETTERS[i]}. ${one(s)}`),
        titled("List II", p.list2Title),
        ...p.list2.map((s, i) => `${ROMAN[i]}. ${one(s)}`),
        one(p.ask),
      ].filter(Boolean).join("\n");
    case "case_based":
      return `Case: ${paragraphs(p.passage)}\nQuestion: ${one(p.ask)}`;
  }
}

// ── 2. Classifying: text (and options) → the form ───────────────────────────
// The same rules, in the same order, as public.question_form_of.

const CASE_HEAD = /^\s*Case:/;
const CASE_ASK = /\n\s*Question:/;
const LIST1_LINE = /(^|\n)[ \t]*List I([ \t]*\([^)\n]*\))?[ \t]*:[ \t]*(\n|$)/;
const LIST2_LINE = /(^|\n)[ \t]*List II([ \t]*\([^)\n]*\))?[ \t]*:[ \t]*(\n|$)/;
const AR_A = /Assertion\s*\(A\)\s*:/;
const AR_R = /Reason\s*\(R\)\s*:/;
const ROMAN_LINE = /(^|\n)[ \t]*(?:I|II|III|IV|V|VI|VII|VIII)\.[ \t]+\S/g;
/** An option that is an order of numbered items: "II, I, IV, III" or "II → I → IV → III". */
const ORDER_OPTION = /^\s*\(?(?:I|II|III|IV|V|VI|VII|VIII)\)?(?:\s*(?:,|→|->|–|-)\s*\(?(?:I|II|III|IV|V|VI|VII|VIII)\)?){2,}\s*\.?\s*$/;

export function formOf(question: string, options: ReadonlyArray<string> | null | undefined): QuestionForm {
  const q = question.replace(/\r\n/g, "\n");
  if (CASE_HEAD.test(q) && CASE_ASK.test(q)) return "case_based";
  if (LIST1_LINE.test(q) && LIST2_LINE.test(q)) return "match";
  if (AR_A.test(q) && AR_R.test(q)) return "assertion_reason";
  if ((q.match(ROMAN_LINE) ?? []).length >= 2) {
    const opts = options ?? [];
    return opts.length > 0 && opts.every((o) => ORDER_OPTION.test(o)) ? "sequence" : "statements";
  }
  return "mcq";
}

// ── 3. Reading: text → blocks to show ───────────────────────────────────────

export type LayoutItem = { label: string; text: string };
export type LayoutBlock =
  | { kind: "case"; paragraphs: string[] }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "assertion_reason"; assertion: string; reason: string }
  | { kind: "list"; style: "roman" | "letter"; items: LayoutItem[] }
  | { kind: "match"; list1Title: string | null; list1: LayoutItem[]; list2Title: string | null; list2: LayoutItem[] };

const ROMAN_ITEM = /^(I|II|III|IV|V|VI|VII|VIII)\.\s+(.+)$/;
const LETTER_ITEM = /^([A-H])\.\s+(.+)$/;
const LIST_HEAD = /^List (I|II)(?:\s*\(([^)]*)\))?\s*:$/;

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The blocks a question's text is shown as. `options`, when given, lets a
 * trailing A–D list that merely repeats them be dropped: a fault of older
 * imports, which printed every option twice.
 */
export function readQuestionLayout(text: string, options?: ReadonlyArray<string> | null): LayoutBlock[] {
  let t = String(text ?? "").replace(/\r\n/g, "\n").trim();
  const blocks: LayoutBlock[] = [];
  if (!t) return blocks;

  const cased = t.match(/^Case:\s*([\s\S]*?)\n\s*Question:\s*([\s\S]+)$/);
  if (cased) {
    blocks.push({ kind: "case", paragraphs: cased[1].split(/\n\s*\n/).map(one).filter(Boolean) });
    t = cased[2].trim();
  }

  // Assertion–reason, also the older one-line form "Assertion (A): … Reason (R): …".
  const ar = t.match(/^([\s\S]*?)Assertion\s*\(A\)\s*:\s*([\s\S]+?)\s*Reason\s*\(R\)\s*:\s*([\s\S]+)$/);
  if (ar) {
    if (ar[1].trim()) blocks.push(...lineBlocks(ar[1]));
    blocks.push({ kind: "assertion_reason", assertion: one(ar[2]), reason: one(ar[3]) });
    return blocks;
  }

  blocks.push(...lineBlocks(t));
  if (options && options.length > 0) {
    const last = blocks[blocks.length - 1];
    if (last?.kind === "list" && last.style === "letter" && last.items.length === options.length
        && last.items.every((it, i) => norm(it.text) === norm(options[i] ?? ""))) {
      blocks.pop();
    }
  }
  return blocks;
}

function lineBlocks(text: string): LayoutBlock[] {
  const lines = text.split("\n").map((l) => l.trim());
  const out: LayoutBlock[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) out.push({ kind: "paragraph", lines: para }); para = []; };
  const items = (from: number, re: RegExp): [LayoutItem[], number] => {
    const got: LayoutItem[] = [];
    let i = from;
    for (; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (!m) break;
      got.push({ label: m[1], text: m[2] });
    }
    return [got, i];
  };

  const listAt = (at: number): { block: LayoutBlock; next: number } | null => {
    for (const [re, style] of [[ROMAN_ITEM, "roman"], [LETTER_ITEM, "letter"]] as const) {
      const [got, next] = items(at, re);
      if (got.length >= 2) return { block: { kind: "list", style, items: got }, next };
    }
    return null;
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line) { flush(); i++; continue; }
    const head = line.match(LIST_HEAD);
    if (head && head[1] === "I") {
      const [list1, after1] = items(i + 1, LETTER_ITEM);
      const head2 = (lines[after1] ?? "").match(LIST_HEAD);
      if (list1.length >= 2 && head2?.[1] === "II") {
        const [list2, after2] = items(after1 + 1, ROMAN_ITEM);
        if (list2.length >= 2) {
          flush();
          out.push({ kind: "match", list1Title: head[2]?.trim() || null, list1, list2Title: head2[2]?.trim() || null, list2 });
          i = after2;
          continue;
        }
      }
    }
    const list = listAt(i);
    if (list) { flush(); out.push(list.block); i = list.next; continue; }
    para.push(line);
    i++;
  }
  flush();
  return out;
}

/** The question as one line, for a card or a list: the layout's words, in order. */
export function questionOneLine(text: string, options?: ReadonlyArray<string> | null): string {
  return readQuestionLayout(text, options).map((b) => {
    switch (b.kind) {
      case "case": return b.paragraphs.join(" ");
      case "paragraph": return b.lines.join(" ");
      case "assertion_reason": return `Assertion (A): ${b.assertion} Reason (R): ${b.reason}`;
      case "list": return b.items.map((it) => `${it.label}. ${it.text}`).join(" ");
      case "match": return [...b.list1, ...b.list2].map((it) => `${it.label}. ${it.text}`).join(" ");
    }
  }).join(" ");
}

// ── 4. Writing: how a model is asked for each form, and how its reply is read ─

/**
 * The one description of the JSON a writer returns for a question, by form —
 * for AI Practice's writer and for the report check's rewrite. "options" and
 * "answer" go with every form. Assertion–reason is not described: no writer
 * writes it (questionRubric.FORMS_NOT_WRITTEN — the real paper does not set
 * it), though readQuestionParts still reads one.
 */
export const FORM_JSON_GUIDE = [
  'Every question has "form" and the fields of that form:',
  '- "mcq": "question" — a direct question.',
  '- "statements": "intro" (e.g. "Consider the following statements:"), "statements" — 2 to 5 of them, and "ask" (e.g. "Which of the statements given above are correct?"); options refer to the statements by Roman numeral ("I and III only").',
  '- "match": "intro" (e.g. "Match List I with List II:"), "list1_title", "list1" — 3 to 5 items, "list2_title", "list2" — the same number, and "ask" (e.g. "Choose the correct answer from the options given below:"); each option is a full matching written as codes ("A-II, B-I, C-IV, D-III"); List II is in a SHUFFLED order, so the right matching is never A-I, B-II, C-III….',
  '- "case_based": "passage" — a case or passage of 4 to 8 sentences with every fact the question needs, and "ask" — the question on it.',
  '- "sequence": "intro" (e.g. "Arrange the following in the order in which they happen:"), "items" — 3 to 6 of them, and "ask" (e.g. "Choose the correct order:"); each option is an order of the items by Roman numeral ("II, I, IV, III"); the items are listed OUT of order, so the right order is never I, II, III….',
  'Items, statements and list entries are plain text: never begin one with its own label ("A.", "I.", "(a)") — the layout adds them.',
  'Whatever its form, every question also has "options", "answer", "working" and "wrong" — one without its working and a line for each wrong option is thrown away.',
].join("\n");

const DEFAULT_ASK: Partial<Record<QuestionForm, { intro: string; ask: string }>> = {
  statements: { intro: "Consider the following statements:", ask: "Which of the statements given above are correct?" },
  sequence: { intro: "Arrange the following in the correct order:", ask: "Choose the correct order:" },
  match: { intro: "Match List I with List II:", ask: "Choose the correct answer from the options given below:" },
};

/**
 * An item as the layout labels it: without a label the model gave it itself.
 * Measured 2026-10-03, the first match questions written: "A. I. Goodwill
 * Account" — the composer's label, then the model's.
 */
const unlabelled = (s: string) =>
  one(s).replace(/^(?:\(?(?:[A-Ha-h]|VIII|VII|VI|IV|V|III|II|I|viii|vii|vi|iv|v|iii|ii|i|\d{1,2})[.)]|\((?:[A-Ha-h]|[ivxIVX]{1,4}|\d{1,2})\))\s+/, "");
const texts = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => unlabelled(String(x ?? ""))).filter(Boolean) : []);
const str = (v: unknown) => (typeof v === "string" ? one(v) : "");
/** A list's title without "List I" and without brackets, which the layout adds: "List I (List I (Balance))" was written. */
const listTitle = (v: unknown) =>
  str(v).replace(/\bList\s*[-–]?\s*I{1,2}\b/gi, "").replace(/[()]/g, "").replace(/^[\s:–-]+|[\s:–-]+$/g, "").trim();

const PAIR = /\(?([A-H])\)?\s*(?:->|[-–—→:=])\s*\(?(viii|vii|vi|iv|v|iii|ii|i)\)?(?![a-z])/gi;
const ROMAN_ANY = /viii|vii|vi|iv|v|iii|ii|i/gi;
const ORDER_ANY_CASE = new RegExp(ORDER_OPTION.source, "i");
const romanAt = (r: string) => (ROMAN as readonly string[]).indexOf(r);

/**
 * A match option, read however a writer puts it — "A-II", "A – ii", "A→II",
 * "(A)-(II)", "A: II" — as the one way it is stored: "A-II, B-I, C-IV". Every
 * item of List I once, in A, B, C… order, each paired with a different item of
 * List II. Null when it is not one. Measured 2026-10-03: a whole call of match
 * questions was thrown away over the way the pairs were written.
 */
export function canonicalMatch(option: string, size: number): string | null {
  const read = [...option.matchAll(PAIR)].map((m) => [m[1].toUpperCase(), m[2].toUpperCase()] as const);
  if (read.length !== size || !read.every(([l], i) => l === LETTERS[i])) return null;
  const used = read.map(([, r]) => r);
  if (new Set(used).size !== size || used.some((r) => romanAt(r) < 0 || romanAt(r) >= size)) return null;
  return read.map(([l, r]) => `${l}-${r}`).join(", ");
}

/** A sequence option — "II, I, IV, III", "ii → i → iv → iii" — as it is stored: "II, I, IV, III". Every item once. */
export function canonicalOrder(option: string, size: number): string | null {
  if (!ORDER_ANY_CASE.test(option)) return null;
  const used = (option.match(ROMAN_ANY) ?? []).map((r) => r.toUpperCase());
  if (used.length !== size || new Set(used).size !== size || used.some((r) => romanAt(r) < 0 || romanAt(r) >= size)) return null;
  return used.join(", ");
}

export const isMatchCode = (option: string, size: number) => canonicalMatch(option, size) !== null;
export const isOrderOf = (option: string, size: number) => canonicalOrder(option, size) !== null;

/**
 * The parts of one written question, read from a model's JSON, or the reason it
 * is refused. A reply with no "form" is a direct question, as before forms.
 */
export function readQuestionParts(raw: Record<string, unknown>): { ok: true; parts: QuestionParts } | { ok: false; reason: string } {
  const form = raw.form == null || raw.form === "" ? "mcq" : raw.form;
  if (!isQuestionForm(form)) return { ok: false, reason: `unknown form ${String(form)}` };
  const intro = (f: QuestionForm) => str(raw.intro) || DEFAULT_ASK[f]?.intro || "";
  const ask = (f: QuestionForm) => str(raw.ask) || DEFAULT_ASK[f]?.ask || "";
  switch (form) {
    case "mcq": {
      const stem = typeof raw.question === "string" ? raw.question.trim() : "";
      return stem ? { ok: true, parts: { form, stem } } : { ok: false, reason: "no question" };
    }
    case "assertion_reason": {
      const assertion = str(raw.assertion), reason = str(raw.reason);
      if (assertion.length < 15 || reason.length < 15) return { ok: false, reason: "an assertion or reason too short" };
      return { ok: true, parts: { form, assertion, reason } };
    }
    case "statements": {
      const statements = texts(raw.statements);
      if (statements.length < 2 || statements.length > 5 || statements.some((s) => s.length < 8)) {
        return { ok: false, reason: "needs 2 to 5 statements" };
      }
      return { ok: true, parts: { form, intro: intro(form), statements, ask: ask(form) } };
    }
    case "sequence": {
      const items = texts(raw.items);
      if (items.length < 3 || items.length > 6) return { ok: false, reason: "needs 3 to 6 items to order" };
      return { ok: true, parts: { form, intro: intro(form), items, ask: ask(form) } };
    }
    case "match": {
      const list1 = texts(raw.list1), list2 = texts(raw.list2);
      if (list1.length < 3 || list1.length > 5 || list2.length !== list1.length) {
        return { ok: false, reason: "needs two lists of the same length, 3 to 5 items" };
      }
      return { ok: true, parts: { form, intro: intro(form), list1Title: listTitle(raw.list1_title), list1, list2Title: listTitle(raw.list2_title), list2, ask: ask(form) } };
    }
    case "case_based": {
      const passage = typeof raw.passage === "string" ? raw.passage.trim() : "";
      const q = str(raw.ask) || str(raw.question);
      if (passage.length < 150) return { ok: false, reason: "a case too short to be one" };
      if (q.length < 10) return { ok: false, reason: "no question on the case" };
      return { ok: true, parts: { form, passage, ask: q } };
    }
  }
}

/**
 * Whether the options and the key suit the form, or why not: a match's
 * options are codes and a sequence's are orders — and the right one is never
 * the lists as printed. Measured 2026-10-03: all three match questions first
 * written had List II in List I's order, keyed "A-I, B-II, C-III, D-IV".
 */
export function optionsShortfall(parts: QuestionParts, options: ReadonlyArray<string>, correctIndex: number): string | null {
  if (parts.form === "match") {
    const bad = options.find((o) => !isMatchCode(o, parts.list1.length));
    if (bad !== undefined) return `a match option is not a full matching (A-?, B-?, …): "${bad.slice(0, 60)}"`;
    const pairs = [...(options[correctIndex] ?? "").matchAll(/([A-H])\s*[-–→:]\s*(VIII|VII|VI|IV|V|III|II|I)\b/g)];
    if (pairs.every((m, i) => m[2] === ROMAN[i])) return "the right matching is the two lists in the same order — List II must be shuffled";
  }
  if (parts.form === "sequence") {
    const bad = options.find((o) => !isOrderOf(o, parts.items.length));
    if (bad !== undefined) return `a sequence option is not an order of every item: "${bad.slice(0, 60)}"`;
    const order = [...(options[correctIndex] ?? "").matchAll(/VIII|VII|VI|IV|V|III|II|I/g)].map((m) => m[0]);
    if (order.every((r, i) => r === ROMAN[i])) return "the right order is the items as listed — list them out of order";
  }
  return null;
}
