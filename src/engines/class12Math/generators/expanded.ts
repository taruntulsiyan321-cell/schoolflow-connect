import { fmt, randInt, pick } from "../random";
import { coeff, register } from "./register";

// ── Relations and Functions (extra) ─────────────────────────────────────────────
register("rf_gof_linear", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = coeff(rng, v), b = coeff(rng, v + 1);
  const c = coeff(rng, v + 2), d = coeff(rng, v + 3);
  const x = randInt(rng, 1, 5);
  const gof = a * (c * x + d) + b;
  return {
    question: `If f(x) = ${a}x ${b >= 0 ? "+" : "−"} ${Math.abs(b)} and g(x) = ${c}x ${d >= 0 ? "+" : "−"} ${Math.abs(d)}, find (g ∘ f)(${x}).`,
    correctAnswer: fmt(gof),
    explanation: `(g ∘ f)(x) = g(f(x)) = ${c}(${a}x ${b >= 0 ? "+" : "−"} ${Math.abs(b)}) ${d >= 0 ? "+" : "−"} ${Math.abs(d)}.`,
    values: { gof },
  };
});

register("rf_relation_properties", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const props = ["reflexive", "symmetric", "transitive"];
  const ans = props[v % 3];
  return {
    question: `On set A = {1, 2, 3}, relation R = {(1,1), (2,2), (3,3), (1,2), (2,1)} is?`,
    correctAnswer: "reflexive and symmetric",
    distractors: ["reflexive only", "symmetric only", "transitive only"],
    explanation: `All (a,a) present ⇒ reflexive; (1,2) and (2,1) present ⇒ symmetric.`,
    values: { prop: ans },
  };
});

register("rf_binary_op", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = randInt(rng, 1, 9);
  const b = randInt(rng, 1, 9);
  const op = v % 2 === 0 ? "*" : "+";
  const result = op === "*" ? (a * b) % 7 : (a + b) % 7;
  return {
    question: `On Z₇, define a ${op} b = (a ${op} b) mod 7. Find ${a} ${op} ${b}.`,
    correctAnswer: fmt(result),
    explanation: `Binary operation on Z₇ uses modulo 7.`,
    values: { result },
  };
});

// ── Inverse Trig (extra) ──────────────────────────────────────────────────────
register("itg_cos_inverse_value", (data, rng) => {
  const vals = [0, 0.5, 1 / Math.sqrt(2), Math.sqrt(3) / 2, 1];
  const i = Number(data.variant ?? 0) % vals.length;
  const t = vals[i];
  const deg = Math.round((Math.acos(t) * 180) / Math.PI);
  return {
    question: `Principal value of cos⁻¹(${fmt(t, 3)}) in degrees is?`,
    correctAnswer: `${deg}°`,
    explanation: `cos⁻¹ principal branch is [0°, 180°].`,
    values: { deg },
  };
});

register("itg_tan_inverse_value", (data, rng) => {
  const vals = [0, 1 / Math.sqrt(3), 1, Math.sqrt(3)];
  const i = Number(data.variant ?? 0) % vals.length;
  const t = vals[i];
  const deg = Math.round((Math.atan(t) * 180) / Math.PI);
  return {
    question: `Principal value of tan⁻¹(${fmt(t, 3)}) in degrees is?`,
    correctAnswer: `${deg}°`,
    explanation: `tan⁻¹ principal branch is (−90°, 90°).`,
    values: { deg },
  };
});

register("itg_simplify_expr", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const x = pick(rng, [0.5, Math.sqrt(3) / 2, 1 / Math.sqrt(2)]);
  const val = Math.sin(2 * Math.asin(x));
  return {
    question: `Simplify sin(2 sin⁻¹ ${fmt(x, 3)}) (principal value).`,
    correctAnswer: fmt(val, 3),
    explanation: `Use sin(2θ) = 2 sin θ cos θ with θ = sin⁻¹x.`,
    values: { val },
  };
});

register("itg_domain_range", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const fn = v % 2 === 0 ? "sin⁻¹" : "cos⁻¹";
  const range = fn === "sin⁻¹" ? "[−π/2, π/2]" : "[0, π]";
  return {
    question: `Range of ${fn}(x) is?`,
    correctAnswer: range,
    explanation: `NCERT principal value branches for inverse trig.`,
    values: {},
  };
});

// ── Matrices (extra) ──────────────────────────────────────────────────────────
register("mat_symmetric_check", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = randInt(rng, 1, 5);
  const b = randInt(rng, 1, 4);
  const sym = v % 2 === 0;
  return {
    question: sym
      ? `Is A = [${a} ${b}; ${b} ${a}] symmetric?`
      : `Is A = [${a} ${b}; ${b + 1} ${a}] symmetric?`,
    correctAnswer: sym ? "Yes" : "No",
    explanation: `Symmetric ⇔ Aᵀ = A ⇔ off-diagonal entries equal.`,
    values: {},
  };
});

register("mat_skew_check", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = randInt(rng, 1, 5);
  const skew = v % 2 === 0;
  return {
    question: `Is A = [0 ${a}; ${skew ? -a : a} 0] skew-symmetric?`,
    correctAnswer: skew ? "Yes" : "No",
    explanation: `Skew-symmetric ⇔ Aᵀ = −A and diagonal entries 0.`,
    values: {},
  };
});

register("mat_inverse_2x2", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = 1 + (v % 3), d = 2 + (v % 2);
  const det = a * d;
  return {
    question: `For A = [${a} 0; 0 ${d}], |A| equals?`,
    correctAnswer: fmt(det),
    explanation: `Diagonal matrix: |A| = product of diagonal entries; A⁻¹ exists if |A| ≠ 0.`,
    values: { det },
  };
});

register("mat_solve_equations", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const x = 2 + (v % 4);
  const y = 1 + (v % 3);
  return {
    question: `Solve by matrix method: x + y = ${x + y}, x − y = ${x - y}. Find x.`,
    correctAnswer: fmt(x),
    explanation: `Write AX = B and use X = A⁻¹B.`,
    values: { x },
  };
});

// ── Determinants (extra) ──────────────────────────────────────────────────────
register("det_cramers", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = 2 + (v % 3), b = 1 + (v % 2);
  const x = (a * b - 1) / (a * b - 1);
  return {
    question: `Using Cramer's rule for 2×2 system with |A| = ${a * b}, if Δ₁ = ${a * b}, then x = ?`,
    correctAnswer: "1",
    explanation: `Cramer's rule: x = Δ₁/|A|.`,
    values: {},
  };
});

register("det_area_triangle", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const area = 3 + (v % 5);
  return {
    question: `Area of triangle with vertices (0,0), (${area},0), (0,2) using determinants is?`,
    correctAnswer: fmt(area),
    explanation: `Area = ½|det of coordinates matrix|.`,
    values: { area },
  };
});

register("det_adjoint", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = 2 + (v % 4), d = 3 + (v % 3);
  return {
    question: `For A = [${a} 0; 0 ${d}], adj(A) = ?`,
    correctAnswer: `[${d} 0; 0 ${a}]`,
    explanation: `For diagonal 2×2, adj(A) swaps diagonal entries.`,
    values: {},
  };
});

register("det_consistency", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const consistent = v % 2 === 0;
  return {
    question: consistent
      ? `If |A| ≠ 0 for a 3×3 system, the system is?`
      : `If |A| = 0 and an augmented minor ≠ 0, the system is?`,
    correctAnswer: consistent ? "consistent with unique solution" : "inconsistent",
    explanation: `|A| ≠ 0 ⇒ unique solution; |A| = 0 with inconsistent minors ⇒ no solution.`,
    values: {},
  };
});

// ── Continuity & Differentiability (extra) ────────────────────────────────────
register("cont_check_point", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const x0 = randInt(rng, 1, 4);
  const k = coeff(rng, v);
  const limit = k * x0 * x0;
  return {
    question: `Is f(x) = x² continuous at x = ${x0}? Value f(${x0}) = ?`,
    correctAnswer: fmt(limit),
    explanation: `Polynomials are continuous everywhere; substitute x = ${x0}.`,
    values: { limit },
  };
});

register("diff_implicit", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const k = 2 + (v % 4);
  return {
    question: `If x² + y² = ${k * k}, find dy/dx at (1, ${Math.sqrt(k * k - 1).toFixed(2)}).`,
    correctAnswer: fmt(-1 / Math.sqrt(k * k - 1), 2),
    explanation: `Differentiate implicitly: 2x + 2y dy/dx = 0 ⇒ dy/dx = −x/y.`,
    values: { k },
  };
});

register("diff_log", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const n = 2 + (v % 3);
  return {
    question: `If y = x^${n}, using log differentiation dy/dx at x = 1 equals?`,
    correctAnswer: fmt(n),
    explanation: `ln y = ${n} ln x ⇒ (1/y)dy/dx = ${n}/x.`,
    values: { n },
  };
});

register("diff_second_order", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const n = 3 + (v % 4);
  return {
    question: `If f(x) = x^${n}, then f″(x) = ?`,
    correctAnswer: `${n * (n - 1)}x^${n - 2}`,
    explanation: `Differentiate twice using power rule.`,
    values: { n },
  };
});

// ── Applications of Derivatives (extra) ───────────────────────────────────────
register("appd_rate", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const r = 5 + (v % 4);
  const drdt = 2 + (v % 3);
  const dAdt = 2 * Math.PI * r * drdt;
  return {
    question: `Circle radius increases at ${drdt} cm/s. When r = ${r} cm, rate of change of area is?`,
    correctAnswer: `${fmt(dAdt, 1)} cm²/s`,
    explanation: `A = πr² ⇒ dA/dt = 2πr dr/dt.`,
    values: { dAdt },
  };
});

register("appd_tangent_normal", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const m = 2 + (v % 4);
  return {
    question: `Slope of tangent to y = x² at x = ${m} is?`,
    correctAnswer: fmt(2 * m),
    explanation: `dy/dx = 2x; at x = ${m}, slope = ${2 * m}.`,
    values: { m },
  };
});

register("appd_approximation", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const x = 4 + (v % 2);
  const dx = 0.01;
  const approx = 2 * Math.sqrt(x) * dx;
  return {
    question: `Approximate change in √x when x changes from ${x} to ${x + dx} using dy ≈ f′(x)dx.`,
    correctAnswer: fmt(approx, 3),
    explanation: `f(x)=√x, f′(x)=1/(2√x).`,
    values: { approx },
  };
});

register("appd_first_deriv_test", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const h = randInt(rng, 1, 3);
  return {
    question: `If f′ changes from + to − at x = ${h}, then f has a?`,
    correctAnswer: "local maximum",
    explanation: `First derivative test: sign change + to − ⇒ local max.`,
    values: {},
  };
});

register("appd_optimization", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const side = 6 + (v % 4);
  const maxArea = (side * side) / 4;
  return {
    question: `Rectangle perimeter 2${side}. Maximum area (square) is?`,
    correctAnswer: fmt(maxArea),
    explanation: `For fixed perimeter, square maximizes area.`,
    values: { maxArea },
  };
});

// ── Integrals (extra) ─────────────────────────────────────────────────────────
register("int_substitution", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const k = 1 + (v % 5);
  return {
    question: `∫ 2x e^(x²) dx equals?`,
    correctAnswer: `e^(x²) + C`,
    explanation: `Let u = x² ⇒ du = 2x dx.`,
    values: { k },
  };
});

register("int_partial_fraction", (data, rng) => {
  const v = Number(data.variant ?? 0);
  return {
    question: `∫ 1/(x² − 1) dx equals?`,
    correctAnswer: `½ ln|(x−1)/(x+1)| + C`,
    explanation: `Partial fractions: 1/(x²−1) = ½(1/(x−1) − 1/(x+1)).`,
    values: {},
  };
});

register("int_by_parts", (data, rng) => {
  const v = Number(data.variant ?? 0);
  return {
    question: `∫ x e^x dx equals?`,
    correctAnswer: `(x − 1)e^x + C`,
    explanation: `Integration by parts: ∫u dv = uv − ∫v du with u=x, dv=e^x dx.`,
    values: {},
  };
});

register("int_definite_property", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = 1 + (v % 3);
  return {
    question: `∫₀^${a} f(x) dx + ∫_${a}^${2 * a} f(x) dx equals ∫₀^${2 * a} f(x) dx when f is?`,
    correctAnswer: "any integrable function",
    explanation: `Additivity of definite integrals on adjacent intervals.`,
    values: {},
  };
});

// ── Applications of Integrals (extra) ─────────────────────────────────────────
register("aint_ellipse_area", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = 2 + (v % 2);
  const b = 3 + (v % 2);
  const area = Math.PI * a * b;
  return {
    question: `Area of ellipse x²/${a * a} + y²/${b * b} = 1 is?`,
    correctAnswer: `${fmt(area, 2)}π`,
    explanation: `Area of ellipse = πab.`,
    values: { area },
  };
});

// ── Differential Equations (extra) ────────────────────────────────────────────
register("de_homogeneous", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const k = 1 + (v % 3);
  return {
    question: `Homogeneous DE dy/dx = (x + y)/(x − y) is solved by substituting y = ?`,
    correctAnswer: "vx",
    explanation: `Homogeneous DEs use substitution y = vx.`,
    values: { k },
  };
});

register("de_linear_first", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const k = 1 + (v % 4);
  return {
    question: `Integrating factor for dy/dx + ${k}y = e^x is?`,
    correctAnswer: `e^${k}x`,
    explanation: `Linear DE: IF = e^∫P(x)dx where P(x) = ${k}.`,
    values: { k },
  };
});

register("de_particular", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const c = 2 + (v % 3);
  return {
    question: `If y = Ce^${c}x and y(0) = 5, then C = ?`,
    correctAnswer: "5",
    explanation: `Substitute initial condition into general solution.`,
    values: { c },
  };
});

register("de_form_equation", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const k = 1 + (v % 2);
  return {
    question: `Eliminating arbitrary constant from y = C e^${k}x gives order?`,
    correctAnswer: "1",
    explanation: `One arbitrary constant ⇒ first order DE.`,
    values: {},
  };
});

// ── Vector Algebra (extra) ────────────────────────────────────────────────────
register("vec_direction_cosines", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = 1 + (v % 3), b = 2 + (v % 2), c = 2;
  const mag = Math.sqrt(a * a + b * b + c * c);
  const cosA = a / mag;
  return {
    question: `Direction cosine l for vector ${a}i + ${b}j + ${c}k equals?`,
    correctAnswer: fmt(cosA, 3),
    explanation: `l = a/|r|, m = b/|r|, n = c/|r|; l²+m²+n²=1.`,
    values: { cosA },
  };
});

register("vec_cross", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = randInt(rng, 1, 4), b = randInt(rng, 1, 4);
  const cross = a * b;
  return {
    question: `|i × j| equals?`,
    correctAnswer: "1",
    explanation: `i × j = k and |k| = 1; cross product magnitude gives parallelogram area.`,
    values: { cross },
  };
});

register("vec_projection", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = 3 + (v % 2), b = 4;
  const proj = (a * b) / Math.sqrt(a * a + b * b);
  return {
    question: `Scalar projection of ${a}i on ${b}j is?`,
    correctAnswer: "0",
    explanation: `Projection of perpendicular vectors is zero.`,
    values: { proj },
  };
});

register("vec_addition", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = coeff(rng, v), b = coeff(rng, v + 1);
  return {
    question: `Resultant of ${a}i + ${b}j and ${b}i + ${a}j is?`,
    correctAnswer: `${a + b}i + ${a + b}j`,
    explanation: `Add corresponding components.`,
    values: {},
  };
});

// ── 3D Geometry (extra) ───────────────────────────────────────────────────────
register("geo3d_direction_cosines", (data, rng) => {
  const v = Number(data.variant ?? 0);
  return {
    question: `If direction ratios are 1, 2, 2, then direction cosines satisfy l²+m²+n² = ?`,
    correctAnswer: "1",
    explanation: `Normalize DRs to get DCs; sum of squares of DCs is 1.`,
    values: {},
  };
});

register("geo3d_line_equation", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = 1 + (v % 2), b = 2;
  return {
    question: `Line through (1,2,3) with DRs ${a},${b},1: symmetric form has denominators?`,
    correctAnswer: `${a}, ${b}, 1`,
    explanation: `(x−x₁)/a = (y−y₁)/b = (z−z₁)/c.`,
    values: {},
  };
});

register("geo3d_plane_equation", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const d = 6 + (v % 3);
  return {
    question: `Plane 2x + 3y + z = ${d} has normal vector?`,
    correctAnswer: `2i + 3j + k`,
    explanation: `Coefficients of x, y, z give normal vector.`,
    values: {},
  };
});

register("geo3d_point_plane_dist", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const num = 6 + (v % 4);
  const dist = num / Math.sqrt(14);
  return {
    question: `Distance of origin from plane 2x + 3y + z = ${num} is?`,
    correctAnswer: fmt(dist, 2),
    explanation: `|ax₀+by₀+cz₀−d|/√(a²+b²+c²).`,
    values: { dist },
  };
});

register("geo3d_angle_lines", (data, rng) => {
  const v = Number(data.variant ?? 0);
  return {
    question: `Angle between lines with DRs 1,1,0 and 1,−1,0 is?`,
    correctAnswer: "90°",
    explanation: `cos θ = (a₁a₂+b₁b₂+c₁c₂)/(|a||b|); dot product zero ⇒ perpendicular.`,
    values: {},
  };
});

// ── Linear Programming (extra) ──────────────────────────────────────────────────
register("lp_corner_points", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const n = 4 + (v % 2);
  return {
    question: `Feasible region bounded by x,y ≥ 0 and x+y ≤ ${n} has corner (0,0), (0,${n}), (${n},0) and?`,
    correctAnswer: `(${n},0)`,
    explanation: `Corner points occur at intersections of constraint lines.`,
    values: {},
  };
});

register("lp_word_problem", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const profit = 40 + (v % 10);
  return {
    question: `Max profit Z = 3x + 2y with x+y ≤ 10, x,y ≥ 0. At (0,10), Z = ?`,
    correctAnswer: "20",
    explanation: `Evaluate objective at each corner of feasible region.`,
    values: { profit },
  };
});

// ── Probability (extra) ─────────────────────────────────────────────────────────
register("prob_multiplication", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const pa = 0.4 + (v % 3) / 10;
  const pb = 0.5;
  return {
    question: `If A,B independent with P(A)=${fmt(pa, 1)}, P(B)=${pb}, then P(A∩B)=?`,
    correctAnswer: fmt(pa * pb, 2),
    explanation: `Multiplication theorem for independent events: P(A∩B)=P(A)P(B).`,
    values: {},
  };
});

register("prob_distribution", (data, rng) => {
  const v = Number(data.variant ?? 0);
  return {
    question: `For X with P(X=0)=0.3, P(X=1)=0.7, sum of probabilities equals?`,
    correctAnswer: "1",
    explanation: `Valid probability distribution sums to 1.`,
    values: {},
  };
});

register("prob_mean_variance", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const mean = 1.5 + (v % 2) * 0.5;
  return {
    question: `RV X: P(1)=0.5, P(2)=0.5. Mean E(X) = ?`,
    correctAnswer: "1.5",
    explanation: `E(X) = Σ xᵢ P(xᵢ).`,
    values: { mean },
  };
});

register("prob_binomial", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const n = 3 + (v % 2);
  const p = 0.5;
  const prob = (n * (n - 1) / 2) * p * p * (1 - p) ** (n - 2);
  return {
    question: `Binomial(n=${n}, p=0.5): P(X=2) = C(${n},2)(0.5)^${n}?`,
    correctAnswer: fmt(prob, 3),
    explanation: `P(X=r) = C(n,r) p^r (1−p)^(n−r).`,
    values: { prob },
  };
});
