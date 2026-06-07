/** Pure JS catalog builder for seed script (mirrors src/engines/class12Math/buildCatalog.ts) */

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
];

export const TEMPLATE_TYPES_BY_CHAPTER = {
  "Relations and Functions": ["rf_composition_linear", "rf_inverse_linear", "rf_bijective_check"],
  "Inverse Trigonometric Functions": ["itg_sin_inverse_value", "itg_composite_sin"],
  Matrices: ["mat_add_2x2", "mat_multiply_2x2", "mat_transpose"],
  Determinants: ["det_2x2", "det_3x3_simple"],
  "Continuity and Differentiability": ["cont_limit_poly", "diff_power_rule"],
  "Applications of Derivatives": ["appd_critical_cubic", "appd_increasing_interval"],
  Integrals: ["int_power", "int_trig"],
  "Applications of Integrals": ["aint_area_under_parabola", "aint_area_line", "aint_between_curves"],
  "Differential Equations": ["de_order_degree", "de_separable"],
  "Vector Algebra": ["vec_dot", "vec_magnitude"],
  "Three Dimensional Geometry": ["geo3d_distance"],
  "Linear Programming": ["lp_corner_max", "lp_feasible_region", "lp_minimize"],
  Probability: ["prob_conditional", "prob_bayes"],
};

const EXPLANATIONS = {
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

const TARGET_PER_CHAPTER = 105;

export function buildClass12MathCatalog() {
  const rows = [];
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
          template_data: {
            variant,
            seed: globalSeed++,
            difficulty: variant % 3 === 0 ? "hard" : variant % 2 ? "medium" : "easy",
          },
          explanation_template: EXPLANATIONS[template_type] ?? "Refer to NCERT Class 12 Mathematics.",
        });
      }
    }
  }
  return rows;
}
