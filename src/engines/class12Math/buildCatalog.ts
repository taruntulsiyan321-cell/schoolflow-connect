import { CLASS12_MATH_CHAPTERS, type QuestionTemplateRow } from "./types";
import { TEMPLATE_TYPES_BY_CHAPTER } from "./registry";

const TARGET_PER_CHAPTER = 105;

const EXPLANATIONS: Record<string, string> = {
  rf_composition_linear: "Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.",
  rf_inverse_linear: "To find f⁻¹, solve y = f(x) for x and interchange variables.",
  rf_bijective_check: "Bijective ⇔ one-one and onto on the given domain.",
  itg_sin_inverse_value: "Use principal value branch of sin⁻¹ as in NCERT Chapter 2.",
  itg_composite_sin: "Simplify using domain restrictions of inverse trigonometric functions.",
  mat_add_2x2: "Matrix addition is element-wise for matrices of the same order.",
  mat_multiply_2x2: "Use row×column rule for matrix multiplication.",
  mat_transpose: "Transpose reflects entries across the main diagonal.",
  det_2x2: "Determinant of [a b; c d] equals ad − bc.",
  det_3x3_simple: "For diagonal matrices, determinant is product of diagonal elements.",
  cont_limit_poly: "Polynomial functions are continuous; direct substitution gives the limit.",
  diff_power_rule: "Apply d/dx(x^n) = n·x^(n−1).",
  appd_critical_cubic: "Critical points satisfy f′(x) = 0.",
  appd_increasing_interval: "f increases where f′(x) > 0.",
  int_power: "Use ∫x^n dx = x^(n+1)/(n+1) + C.",
  int_trig: "Memorise standard integrals of sin and cos.",
  aint_area_under_parabola: "Definite integral gives area under curve for x ≥ 0.",
  aint_area_line: "Area under a line y = mx is a triangle/trapezoid integral.",
  aint_between_curves: "Area between curves = ∫ (upper − lower) dx on the interval.",
  de_order_degree: "Identify highest derivative and its power.",
  de_separable: "Separate variables and integrate both sides.",
  vec_dot: "Scalar (dot) product sums products of corresponding components.",
  vec_magnitude: "Modulus of ai + bj + ck is √(a² + b² + c²).",
  geo3d_distance: "Use 3D distance formula between two points.",
  lp_corner_max: "Linear programming optimum occurs at a corner of the feasible region.",
  lp_feasible_region: "Check all constraints for a feasible point.",
  lp_minimize: "Compare objective value at corner points including origin.",
  prob_conditional: "Conditional probability P(A|B) = P(A∩B)/P(B).",
  prob_bayes: "Bayes theorem updates prior probability using test accuracy.",
};

/** Build 100+ template rows per chapter (1300+ total). */
export function buildClass12MathCatalog(): QuestionTemplateRow[] {
  const rows: QuestionTemplateRow[] = [];
  let globalSeed = 1;

  for (const chapter of CLASS12_MATH_CHAPTERS) {
    const types = TEMPLATE_TYPES_BY_CHAPTER[chapter] ?? [];
    const variantsPerType = Math.max(35, Math.ceil(TARGET_PER_CHAPTER / Math.max(types.length, 1)));
    for (const template_type of types) {
      for (let variant = 0; variant < variantsPerType; variant++) {
        rows.push({
          class: 12,
          subject: "Mathematics",
          chapter,
          template_type,
          template_data: { variant, seed: globalSeed++, difficulty: variant % 3 === 0 ? "hard" : variant % 2 ? "medium" : "easy" },
          explanation_template: EXPLANATIONS[template_type] ?? "Refer to NCERT Class 12 Mathematics for this concept.",
        });
      }
    }
  }
  return rows;
}

export function catalogStats(catalog = buildClass12MathCatalog()) {
  const byChapter: Record<string, number> = {};
  for (const r of catalog) {
    byChapter[r.chapter] = (byChapter[r.chapter] ?? 0) + 1;
  }
  return { total: catalog.length, byChapter };
}
