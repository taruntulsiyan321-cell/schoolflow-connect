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
  "Relations and Functions": [
    "rf_composition_linear", "rf_gof_linear", "rf_inverse_linear",
    "rf_bijective_check", "rf_relation_properties", "rf_binary_op",
  ],
  "Inverse Trigonometric Functions": [
    "itg_sin_inverse_value", "itg_cos_inverse_value", "itg_tan_inverse_value",
    "itg_composite_sin", "itg_simplify_expr", "itg_domain_range",
  ],
  Matrices: [
    "mat_add_2x2", "mat_multiply_2x2", "mat_transpose", "mat_symmetric_check",
    "mat_skew_check", "mat_inverse_2x2", "mat_solve_equations",
  ],
  Determinants: [
    "det_2x2", "det_3x3_simple", "det_cramers", "det_area_triangle",
    "det_adjoint", "det_consistency",
  ],
  "Continuity and Differentiability": [
    "cont_limit_poly", "cont_check_point", "diff_power_rule", "diff_implicit",
    "diff_log", "diff_second_order",
  ],
  "Applications of Derivatives": [
    "appd_critical_cubic", "appd_increasing_interval", "appd_rate", "appd_tangent_normal",
    "appd_approximation", "appd_first_deriv_test", "appd_optimization",
  ],
  Integrals: [
    "int_power", "int_trig", "int_substitution", "int_partial_fraction",
    "int_by_parts", "int_definite_property",
  ],
  "Applications of Integrals": [
    "aint_area_under_parabola", "aint_area_line", "aint_between_curves", "aint_ellipse_area",
  ],
  "Differential Equations": [
    "de_order_degree", "de_form_equation", "de_separable", "de_homogeneous",
    "de_linear_first", "de_particular",
  ],
  "Vector Algebra": [
    "vec_magnitude", "vec_direction_cosines", "vec_addition", "vec_dot",
    "vec_cross", "vec_projection",
  ],
  "Three Dimensional Geometry": [
    "geo3d_distance", "geo3d_direction_cosines", "geo3d_line_equation",
    "geo3d_angle_lines", "geo3d_plane_equation", "geo3d_point_plane_dist",
  ],
  "Linear Programming": [
    "lp_feasible_region", "lp_corner_max", "lp_minimize", "lp_corner_points", "lp_word_problem",
  ],
  Probability: [
    "prob_conditional", "prob_multiplication", "prob_bayes", "prob_distribution",
    "prob_mean_variance", "prob_binomial",
  ],
};

const EXPLANATIONS = {
  rf_composition_linear: "Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.",
  rf_gof_linear: "Compute (g ∘ f)(x) by substituting f(x) into g.",
  rf_inverse_linear: "To find f⁻¹, solve y = f(x) for x and interchange variables.",
  rf_bijective_check: "Bijective ⇔ one-one and onto on the given domain.",
  rf_relation_properties: "Check reflexive, symmetric, and transitive properties.",
  rf_binary_op: "Apply the binary operation definition on the given set.",
  itg_sin_inverse_value: "Use principal value branch of sin⁻¹ as in NCERT Chapter 2.",
  itg_cos_inverse_value: "Principal value of cos⁻¹ lies in [0, π].",
  itg_tan_inverse_value: "Principal value of tan⁻¹ lies in (−π/2, π/2).",
  itg_composite_sin: "Simplify using domain restrictions of inverse trigonometric functions.",
  itg_simplify_expr: "Use inverse trig identities and principal branches.",
  itg_domain_range: "Recall domain and range of inverse trigonometric functions.",
  mat_add_2x2: "Matrix addition is element-wise for matrices of the same order.",
  mat_multiply_2x2: "Use row×column rule for matrix multiplication.",
  mat_transpose: "Transpose reflects entries across the main diagonal.",
  mat_symmetric_check: "Symmetric matrix satisfies Aᵀ = A.",
  mat_skew_check: "Skew-symmetric matrix satisfies Aᵀ = −A.",
  mat_inverse_2x2: "Use determinant and adjoint to find A⁻¹.",
  mat_solve_equations: "Write the system as AX = B and solve using matrix inverse.",
  det_2x2: "Determinant of [a b; c d] equals ad − bc.",
  det_3x3_simple: "For diagonal matrices, determinant is product of diagonal elements.",
  det_cramers: "Cramer's rule: xᵢ = Δᵢ/|A|.",
  det_area_triangle: "Area of triangle with vertices uses ½|determinant|.",
  det_adjoint: "Adjoint is transpose of cofactor matrix.",
  det_consistency: "Compare |A| and minors to classify the system.",
  cont_limit_poly: "Polynomial functions are continuous; direct substitution gives the limit.",
  cont_check_point: "Check limit equals function value for continuity.",
  diff_power_rule: "Apply d/dx(x^n) = n·x^(n−1).",
  diff_implicit: "Differentiate both sides w.r.t. x for implicit relations.",
  diff_log: "Take natural log then differentiate for log differentiation.",
  diff_second_order: "Differentiate twice using standard rules.",
  appd_critical_cubic: "Critical points satisfy f′(x) = 0.",
  appd_increasing_interval: "f increases where f′(x) > 0.",
  appd_rate: "Related rates: chain rule connects changing quantities.",
  appd_tangent_normal: "Slope of tangent is dy/dx at the point.",
  appd_approximation: "Use dy ≈ f′(x)Δx for small changes.",
  appd_first_deriv_test: "Sign change of f′ locates local extrema.",
  appd_optimization: "Evaluate objective at corner/critical points.",
  int_power: "Use ∫x^n dx = x^(n+1)/(n+1) + C.",
  int_trig: "Memorise standard integrals of sin and cos.",
  int_substitution: "Choose u-substitution to simplify the integrand.",
  int_partial_fraction: "Decompose rational function into partial fractions.",
  int_by_parts: "Use ∫u dv = uv − ∫v du.",
  int_definite_property: "Definite integrals add over adjacent intervals.",
  aint_area_under_parabola: "Definite integral gives area under curve for x ≥ 0.",
  aint_area_line: "Area under a line y = mx is a triangle/trapezoid integral.",
  aint_between_curves: "Area between curves = ∫ (upper − lower) dx on the interval.",
  aint_ellipse_area: "Area of ellipse x²/a² + y²/b² = 1 is πab.",
  de_order_degree: "Identify highest derivative and its power.",
  de_form_equation: "Eliminate arbitrary constants by differentiation.",
  de_separable: "Separate variables and integrate both sides.",
  de_homogeneous: "Substitute y = vx for homogeneous differential equations.",
  de_linear_first: "Find integrating factor e^∫P(x)dx.",
  de_particular: "Apply initial conditions to find the constant.",
  vec_magnitude: "Modulus of ai + bj + ck is √(a² + b² + c²).",
  vec_direction_cosines: "Direction cosines are components divided by |r|.",
  vec_addition: "Add vectors component-wise.",
  vec_dot: "Scalar (dot) product sums products of corresponding components.",
  vec_cross: "Cross product magnitude gives area of parallelogram.",
  vec_projection: "Scalar projection uses dot product and |b|.",
  geo3d_distance: "Use 3D distance formula between two points.",
  geo3d_direction_cosines: "Normalize direction ratios to get direction cosines.",
  geo3d_line_equation: "Symmetric form of line uses direction ratios.",
  geo3d_angle_lines: "Angle between lines uses dot product of direction ratios.",
  geo3d_plane_equation: "Normal vector comes from plane coefficients.",
  geo3d_point_plane_dist: "Perpendicular distance formula from point to plane.",
  lp_corner_max: "Linear programming optimum occurs at a corner of the feasible region.",
  lp_feasible_region: "Check all constraints for a feasible point.",
  lp_minimize: "Compare objective value at corner points including origin.",
  lp_corner_points: "List intersections of constraint boundaries.",
  lp_word_problem: "Translate constraints and optimize at corners.",
  prob_conditional: "Conditional probability P(A|B) = P(A∩B)/P(B).",
  prob_multiplication: "For independent events, P(A∩B) = P(A)P(B).",
  prob_bayes: "Bayes theorem updates prior probability using test accuracy.",
  prob_distribution: "Probabilities in a distribution sum to 1.",
  prob_mean_variance: "E(X) = Σ x P(x); Var(X) = E(X²) − [E(X)]².",
  prob_binomial: "Binomial: P(X=r) = C(n,r) p^r (1−p)^(n−r).",
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
