export const CLASS12_MATH_CHAPTERS = [
  "Relations and Functions",
  "Inverse Trigonometric Functions",
  "Matrices",
  "Determinants",
  "Continuity and Differentiability",
  "Applications of Derivatives",
  "Integrals",
  "Applications of Integrals",
  "Differential Equations",
  "Vector Algebra",
  "Three Dimensional Geometry",
  "Linear Programming",
  "Probability",
] as const;

export type Class12Chapter = (typeof CLASS12_MATH_CHAPTERS)[number];

export type QuestionTemplateRow = {
  id?: string;
  class: number;
  subject: string;
  chapter: Class12Chapter;
  template_type: string;
  template_data: Record<string, unknown>;
  explanation_template: string;
};

export type GeneratedQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  correctAnswer: string;
  values: Record<string, number | string>;
};

export type GeneratorFn = (
  data: Record<string, unknown>,
  rng: () => number,
) => Omit<GeneratedQuestion, "correctIndex" | "options"> & {
  correctAnswer: string;
  /** When set, used as wrong options instead of auto-generated distractors. */
  distractors?: string[];
};
