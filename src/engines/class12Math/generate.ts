import { mulberry32, shuffleWithRng } from "./random";
import type { GeneratedQuestion, GeneratorFn, QuestionTemplateRow } from "./types";
import { GENERATOR_REGISTRY } from "./registry";

const FUNCTION_POOL = [
  "f(x) = x",
  "f(x) = x²",
  "f(x) = x³",
  "f(x) = |x|",
  "f(x) = 2x",
  "f(x) = x + 1",
  "f(x) = −x",
  "f(x) = 1",
  "f(x) = sin x",
  "f(x) = cos x",
  "f(x) = e^x",
  "f(x) = log x",
  "f(x) = 1/x",
];

const DEGREE_POOL = [0, 15, 30, 45, 60, 90, 120, 135, 180];

function randSign(rng: () => number) {
  return rng() > 0.5 ? 1 : -1;
}

function inferDistractorPool(correct: string): string[] {
  const trimmed = correct.trim();

  if (/^f\(x\)\s*=/i.test(trimmed)) {
    return FUNCTION_POOL.filter((x) => x !== trimmed);
  }

  const deg = trimmed.match(/^(-?\d+)°$/);
  if (deg) {
    const n = parseInt(deg[1], 10);
    return DEGREE_POOL.map((d) => `${d}°`).filter((x) => x !== trimmed && Math.abs(parseInt(x, 10) - n) > 5);
  }

  if (trimmed === "Yes" || trimmed === "No") {
    return trimmed === "Yes"
      ? ["No", "Cannot be determined", "Only on a restricted domain"]
      : ["Yes", "Cannot be determined", "Only on a restricted domain"];
  }

  if (/reflexive|symmetric|transitive/i.test(trimmed)) {
    return [
      "reflexive only",
      "symmetric only",
      "transitive only",
      "reflexive and symmetric",
      "reflexive and transitive",
      "symmetric and transitive",
      "none of these",
    ].filter((x) => x.toLowerCase() !== trimmed.toLowerCase());
  }

  if (/consistent|inconsistent/i.test(trimmed)) {
    return [
      "consistent with unique solution",
      "consistent with infinitely many solutions",
      "inconsistent",
      "cannot be determined",
    ].filter((x) => x.toLowerCase() !== trimmed.toLowerCase());
  }

  if (/^local (maximum|minimum)$/i.test(trimmed)) {
    return ["local maximum", "local minimum", "point of inflection", "neither"];
  }

  if (/^y\s*=/i.test(trimmed) || /\+\s*C$/i.test(trimmed)) {
    return [
      trimmed.replace("+ C", "− C"),
      trimmed.replace("e^", "e^(−"),
      `${trimmed} + 1`,
      trimmed.replace("sin", "cos"),
    ].filter((x) => x !== trimmed && x.length > 2);
  }

  if (/^\[/.test(trimmed)) {
    return [
      "[1 0; 0 1]",
      "[0 1; 1 0]",
      "[2 0; 0 2]",
      "[1 2; 3 4]",
      "[0 0; 0 0]",
    ].filter((x) => x !== trimmed);
  }

  if (/^order \d+, degree \d+$/i.test(trimmed)) {
    return ["order 1, degree 1", "order 2, degree 1", "order 1, degree 2", "order 2, degree 2"].filter(
      (x) => x !== trimmed,
    );
  }

  return [];
}

function perturbAnswer(correct: string, attempt: number, rng: () => number): string | null {
  const trimmed = correct.trim();

  const plainNum = trimmed.match(/^-?[\d.]+$/);
  if (plainNum) {
    const n = Number(trimmed);
    const bump = (attempt + 1) * randSign(rng) * (1 + Math.floor(rng() * 5));
    const next = n + bump;
    return next === n ? String(n + attempt + 1) : String(next);
  }

  const deg = trimmed.match(/^(-?\d+)°$/);
  if (deg) {
    const n = parseInt(deg[1], 10);
    const deltas = [15, -15, 30, -30, 45, 60, 90, -90];
    return `${n + deltas[attempt % deltas.length]}°`;
  }

  if (trimmed.includes("x^")) {
    const variants = [
      trimmed.replace(/\^(\d+)/, (_, p) => `^${Math.max(1, Number(p) + (attempt % 2 === 0 ? 1 : -1))}`),
      trimmed.replace("+", "−"),
      trimmed.replace("−", "+"),
    ].filter((x) => x !== trimmed);
    return variants[attempt % variants.length] ?? null;
  }

  if (/^f\(x\)\s*=/i.test(trimmed)) {
    const pool = inferDistractorPool(trimmed);
    return pool[attempt % pool.length] ?? null;
  }

  return null;
}

function buildDistractors(
  correct: string,
  rng: () => number,
  explicit?: string[],
  count = 3,
): string[] {
  const pool = new Set<string>();
  pool.add(correct.trim());

  for (const d of explicit ?? []) {
    const t = d.trim();
    if (t && t !== correct.trim()) pool.add(t);
  }

  for (const d of inferDistractorPool(correct)) {
    if (pool.size >= count + 1) break;
    pool.add(d);
  }

  let guard = 0;
  while (pool.size < count + 1 && guard < 40) {
    const next = perturbAnswer(correct, guard, rng);
    if (next && next !== correct.trim()) pool.add(next);
    guard++;
  }

  const wrong = [...pool].filter((x) => x !== correct.trim());
  if (wrong.length < count) {
    for (const filler of [`None of these`, `All of the above`, `Cannot be determined`]) {
      if (wrong.length >= count) break;
      if (filler !== correct.trim() && !wrong.includes(filler)) wrong.push(filler);
    }
  }

  return shuffleWithRng(rng, wrong).slice(0, count);
}

export function generateFromTemplate(
  template: Pick<QuestionTemplateRow, "template_type" | "template_data" | "explanation_template">,
  sessionSeed?: number,
): GeneratedQuestion {
  const seed =
    sessionSeed ??
    Number(template.template_data.seed ?? Date.now()) ^ template.template_type.length;
  const rng = mulberry32(seed);
  const gen: GeneratorFn | undefined = GENERATOR_REGISTRY[template.template_type];
  if (!gen) {
    throw new Error(`Unknown template type: ${template.template_type}`);
  }

  const raw = gen(template.template_data, rng);
  const correct = raw.correctAnswer.trim();

  let options = shuffleWithRng(rng, [
    correct,
    ...buildDistractors(correct, rng, raw.distractors),
  ]);

  if (new Set(options).size < 4) {
    const retryRng = mulberry32(seed ^ 0x9e3779b9);
    options = shuffleWithRng(retryRng, [correct, ...buildDistractors(correct, retryRng, raw.distractors)]);
  }

  const correctIndex = options.indexOf(correct);
  let explanation = template.explanation_template || raw.explanation;
  for (const [k, v] of Object.entries(raw.values ?? {})) {
    explanation = explanation.replaceAll(`{{${k}}}`, String(v));
  }

  return {
    question: raw.question,
    options,
    correctIndex: correctIndex < 0 ? 0 : correctIndex,
    explanation,
    correctAnswer: correct,
    values: raw.values ?? {},
  };
}

export function generateBatch(
  templates: QuestionTemplateRow[],
  sessionSeed: number,
): Array<{ template: QuestionTemplateRow; generated: GeneratedQuestion }> {
  return templates.map((t, i) => ({
    template: t,
    generated: generateFromTemplate(t, sessionSeed + i * 9973),
  }));
}
