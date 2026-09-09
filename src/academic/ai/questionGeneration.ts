/**
 * How to ask a model for a question, and how to tell whether what came back is
 * usable. ONE HOME, and it is parity-checked.
 *
 * ── WHY THIS FILE EXISTS ─────────────────────────────────────────────────
 *
 * `supabase/functions/dpp-generate-questions` already generated MCQ, short and
 * long questions with answers, and had done for a while: per-format token
 * budgets, a refund path, and a guard that treats an empty array as a failure
 * rather than a 200. All of it lived inline in that one function's `index.ts`,
 * reachable only by that one function.
 *
 * §5 needs the same capability from the question-paper screen, through
 * `ai-gateway`. Copying the prompt and the schema into `aiRouter.ts` would have
 * made two homes for "what a good question looks like" — and the details that
 * matter most here were each learned from a defect: the 4-option rule, the
 * per-format token budget (a long answer needs ~700 tokens and was being given
 * an MCQ's 180, which is what truncation looks like), and `topic` being left
 * NULL rather than guessed (rule 31).
 *
 * ── THE PAIR ─────────────────────────────────────────────────────────────
 *
 * Edge functions are Deno and cannot import from `src/`; the client is Vite and
 * cannot import a `.ts`-suffixed Deno module. This repo's answer, already used
 * for `capabilityCatalog`, `promptLibrary` and `questionPaperPlan`, is a paired
 * copy. The copy is `supabase/functions/_shared/questionGenerator.ts`.
 *
 * THE PAIR IS GATED. Everything below the SHARED BODY marker must be identical
 * in both files, comments stripped — `questionGeneration.test.ts` compares them
 * and fails if they drift. The logic is written here, in the half that vitest
 * can actually execute.
 */

// ── SHARED BODY (parity-checked — keep identical in both copies) ──────────

export type GeneratedFormat = "mcq" | "short" | "long";

export interface QuestionGenerationSpec {
  format: GeneratedFormat;
  subject: string;
  chapter?: string | null;
  topic?: string | null;
  difficulty: string;
  count: number;
  /** "RBSE", "CBSE", or "" when the school's board is unknown. */
  boardPhrase?: string | null;
  /** "class 10", or "" when the level could not be resolved. */
  classPhrase?: string | null;
  sourceUrl?: string | null;
  sourceText?: string | null;
}

export interface GeneratedQuestion {
  question: string;
  options?: string[];
  correct_index?: number;
  answer?: string;
  explanation: string;
  question_format: GeneratedFormat;
}

export interface QuestionGenerationRequest {
  system: string;
  user: string;
  schema: Record<string, unknown>;
  max_tokens: number;
}

/** Exactly four, because a question setter's MCQ has four options. */
export const MCQ_OPTION_COUNT = 4;

/**
 * Tokens to budget per question, by format.
 *
 * A long answer is a whole model answer a teacher marks against. Budgeting an
 * MCQ's allowance for one does not produce a shorter answer — it produces a
 * truncated JSON document that fails to parse, which is how this was found.
 */
export const TOKENS_PER_QUESTION: Record<GeneratedFormat, number> = {
  mcq: 180,
  short: 300,
  long: 700,
};

/** The floor and ceiling the provider is asked for, whatever the count. */
export const MIN_GENERATION_TOKENS = 1200;
export const MAX_GENERATION_TOKENS = 8000;

/** A short answer that is one word is a hint, not the answer §4.2a asks for. */
export const MIN_ANSWER_CHARS = 12;

export function generationTokenBudget(format: GeneratedFormat, count: number): number {
  const per = TOKENS_PER_QUESTION[format] ?? TOKENS_PER_QUESTION.mcq;
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 1;
  return Math.min(MAX_GENERATION_TOKENS, Math.max(MIN_GENERATION_TOKENS, n * per));
}

function schemaFor(format: GeneratedFormat): Record<string, unknown> {
  const item =
    format === "mcq"
      ? {
          type: "object",
          properties: {
            question: { type: "string" },
            options: { type: "array", items: { type: "string" } },
            correct_index: { type: "integer" },
            explanation: { type: "string" },
          },
          required: ["question", "options", "correct_index", "explanation"],
        }
      : {
          type: "object",
          properties: {
            question: { type: "string" },
            answer: { type: "string" },
            explanation: { type: "string" },
          },
          required: ["question", "answer", "explanation"],
        };
  return {
    type: "object",
    properties: { questions: { type: "array", items: item } },
    required: ["questions"],
  };
}

export function buildQuestionGenerationRequest(
  spec: QuestionGenerationSpec,
): QuestionGenerationRequest {
  const board = (spec.boardPhrase ?? "").trim();
  const klass = (spec.classPhrase ?? "").trim();
  const common =
    `You are an expert ${[board, klass].filter(Boolean).join(" ")} question setter for Indian schools (NCERT-aligned). `.replace(
      /\s+/g,
      " ",
    ) +
    "Never repeat the same question stem or pattern. Vary numbers, scenarios, and wording. " +
    "If reference material lists student mistakes, generate remedial questions that test the same underlying skills with new numbers and wording — never copy listed mistake questions verbatim. " +
    "If the student made recent mistakes, target those weak concepts first with remedial questions. ";

  const system =
    spec.format === "mcq"
      ? common +
        "GENERATE fresh MCQs — each question must test a DIFFERENT sub-concept or skill. " +
        `Exactly ${MCQ_OPTION_COUNT} options per question, one unambiguously correct answer, clear step-by-step explanation.`
      : spec.format === "short"
        ? common +
          "GENERATE fresh SHORT-ANSWER questions — each must test a DIFFERENT sub-concept or skill. " +
          "Each answer is 2–3 sentences or a worked numerical result: the complete expected answer, not a hint. " +
          "Do NOT produce options; this is not a multiple-choice paper."
        : common +
          "GENERATE fresh LONG-ANSWER questions — each must test a DIFFERENT sub-concept or skill. " +
          "Each answer is a full model answer a teacher could mark against: the argument or derivation in steps, stated completely. " +
          "Do NOT produce options; this is not a multiple-choice paper.";

  const user = [
    `Subject: ${spec.subject || "(infer from source)"}`,
    spec.chapter ? `Chapter: ${spec.chapter}` : "",
    `Topic: ${spec.topic || "(derive from source)"}`,
    `Difficulty: ${spec.difficulty}`,
    `Count: up to ${spec.count} questions`,
    spec.sourceUrl ? `Source URL: ${spec.sourceUrl}` : "",
    spec.sourceText ? `\nReference material:\n${spec.sourceText}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    system,
    user,
    schema: schemaFor(spec.format),
    max_tokens: generationTokenBudget(spec.format, spec.count),
  };
}

/**
 * THE QUALITY GUARD. A model that answers in the right SHAPE has not
 * necessarily answered usefully, and every one of these rejections is a thing
 * that reached a screen at some point:
 *
 *  - an MCQ with three options, or five;
 *  - an MCQ whose options repeat, so two answers are correct;
 *  - a `correct_index` pointing past the end of the list;
 *  - a "short answer" of one word, which is a hint and not an answer;
 *  - an empty explanation.
 *
 * Returns the reason rather than a boolean so the caller can say WHICH
 * questions it dropped and why, instead of silently returning fewer.
 */
export function rejectionReason(
  q: Partial<GeneratedQuestion>,
  format: GeneratedFormat,
): string | null {
  const question = typeof q.question === "string" ? q.question.trim() : "";
  if (!question) return "no question text";
  const explanation = typeof q.explanation === "string" ? q.explanation.trim() : "";
  if (!explanation) return "no explanation";

  if (format === "mcq") {
    const options = Array.isArray(q.options) ? q.options.map((o) => String(o ?? "").trim()) : [];
    if (options.length !== MCQ_OPTION_COUNT) {
      return `${options.length} options, expected ${MCQ_OPTION_COUNT}`;
    }
    if (options.some((o) => o === "")) return "an option is blank";
    if (new Set(options.map((o) => o.toLowerCase())).size !== options.length) {
      return "two options are the same, so more than one answer is correct";
    }
    const ix = q.correct_index;
    if (typeof ix !== "number" || !Number.isInteger(ix) || ix < 0 || ix >= options.length) {
      return "the answer key does not point at an option";
    }
    return null;
  }

  const answer = typeof q.answer === "string" ? q.answer.trim() : "";
  if (!answer) return "no answer";
  if (answer.length < MIN_ANSWER_CHARS) return "the answer is too short to mark against";
  return null;
}

export interface NormalizedGeneration {
  questions: GeneratedQuestion[];
  /** One line per dropped question, for the caller to surface. */
  rejected: string[];
}

/**
 * Trim to the requested count, stamp the format, and drop what the guard
 * refuses. Never returns a question it would not itself accept.
 */
export function normalizeGeneratedQuestions(
  raw: unknown,
  format: GeneratedFormat,
  count: number,
): NormalizedGeneration {
  const list = Array.isArray(raw) ? raw : [];
  const questions: GeneratedQuestion[] = [];
  const rejected: string[] = [];

  for (const entry of list) {
    if (questions.length >= count) break;
    const q = (entry ?? {}) as Partial<GeneratedQuestion>;
    const reason = rejectionReason(q, format);
    if (reason) {
      rejected.push(reason);
      continue;
    }
    const kept: GeneratedQuestion = {
      question: String(q.question).trim(),
      explanation: String(q.explanation).trim(),
      question_format: format,
    };
    if (format === "mcq") {
      kept.options = (q.options as string[]).map((o) => String(o).trim());
      kept.correct_index = q.correct_index as number;
    } else {
      kept.answer = String(q.answer).trim();
    }
    questions.push(kept);
  }

  return { questions, rejected };
}
