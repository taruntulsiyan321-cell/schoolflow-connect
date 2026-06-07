import { mulberry32, shuffleWithRng } from "./random";
import type { GeneratedQuestion, GeneratorFn, QuestionTemplateRow } from "./types";
import { GENERATOR_REGISTRY } from "./registry";

function buildDistractors(
  correct: string,
  rng: () => number,
  factory: (i: number) => string,
  count = 3,
): string[] {
  const out = new Set<string>();
  out.add(correct);
  let guard = 0;
  while (out.size < count + 1 && guard < 40) {
    out.add(factory(guard++));
  }
  const wrong = [...out].filter((x) => x !== correct);
  while (wrong.length < count) wrong.push(`${correct} (alt ${wrong.length + 1})`);
  return wrong.slice(0, count);
}

export function generateFromTemplate(
  template: Pick<QuestionTemplateRow, "template_type" | "template_data" | "explanation_template">,
  sessionSeed?: number,
): GeneratedQuestion {
  const seed =
    sessionSeed ??
    Number(template.template_data.seed ?? Date.now()) ^
    template.template_type.length;
  const rng = mulberry32(seed);
  const gen: GeneratorFn | undefined = GENERATOR_REGISTRY[template.template_type];
  if (!gen) {
    throw new Error(`Unknown template type: ${template.template_type}`);
  }

  const raw = gen(template.template_data, rng);
  const options = shuffleWithRng(rng, [
    raw.correctAnswer,
    ...buildDistractors(raw.correctAnswer, rng, (i) => {
      const bump = (i + 1) * (randSign(rng) * (1 + Math.floor(rng() * 5)));
      if (!Number.isNaN(Number(raw.correctAnswer))) {
        return String(Number(raw.correctAnswer) + bump);
      }
      return `${raw.correctAnswer}?`;
    }),
  ]);

  const correctIndex = options.indexOf(raw.correctAnswer);
  let explanation = template.explanation_template || raw.explanation;
  for (const [k, v] of Object.entries(raw.values ?? {})) {
    explanation = explanation.replaceAll(`{{${k}}}`, String(v));
  }

  return {
    question: raw.question,
    options,
    correctIndex: correctIndex < 0 ? 0 : correctIndex,
    explanation,
    correctAnswer: raw.correctAnswer,
    values: raw.values ?? {},
  };
}

function randSign(rng: () => number) {
  return rng() > 0.5 ? 1 : -1;
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
