import { generators } from "./generators/shared";

export const GENERATOR_REGISTRY = generators;

export const TEMPLATE_TYPES_BY_CHAPTER: Record<string, string[]> = {
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
