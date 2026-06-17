import { fmt, randInt } from "../random";
import { coeff, register, generators } from "./register";

export { coeff, generators, register };

// ── Relations and Functions ───────────────────────────────────────────────────
register("rf_composition_linear", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = coeff(rng, v), b = coeff(rng, v + 1);
  const c = coeff(rng, v + 2), d = coeff(rng, v + 3);
  const x = randInt(rng, 1, 5);
  const fog = c * (a * x + b) + d;
  return {
    question: `If f(x) = ${a}x ${b >= 0 ? "+" : "−"} ${Math.abs(b)} and g(x) = ${c}x ${d >= 0 ? "+" : "−"} ${Math.abs(d)}, find (f ∘ g)(${x}).`,
    correctAnswer: fmt(fog),
    explanation: `(f ∘ g)(x) = f(g(x)) = ${a}(${c}x ${d >= 0 ? "+" : "−"} ${Math.abs(d)}) ${b >= 0 ? "+" : "−"} ${Math.abs(b)}.`,
    values: { a, b, c, d, x, fog },
  };
});

register("rf_inverse_linear", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = randInt(rng, 2, 9) * (rng() > 0.5 ? 1 : -1);
  const b = randInt(rng, 1, 12);
  return {
    question: `Find f⁻¹(x) if f(x) = ${a}x + ${b} (NCERT: invert y = ${a}x + ${b}).`,
    correctAnswer: `(${a > 0 ? "" : "−"}x − ${b})/${Math.abs(a)}`,
    explanation: `Let y = ${a}x + ${b} ⇒ x = (y − ${b})/${a}. Replace y with x for f⁻¹(x).`,
    values: { a, b },
  };
});

register("rf_bijective_check", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const isBijective = v % 2 === 0;
  const domain = "R";
  const correct = isBijective ? "f(x) = x³" : "f(x) = x²";
  return {
    question: `Which function is bijective on ${domain}?`,
    correctAnswer: correct,
    distractors: isBijective
      ? ["f(x) = x²", "f(x) = |x|", "f(x) = sin x"]
      : ["f(x) = x³", "f(x) = x", "f(x) = 2x"],
    explanation: `x³ is one-one and onto on ${domain}; x² is not one-one on ${domain}.`,
    values: { isBijective: isBijective ? 1 : 0 },
  };
});

// ── Inverse Trigonometric ─────────────────────────────────────────────────────
register("itg_sin_inverse_value", (data, rng) => {
  const vals = [0, 0.5, 1 / Math.sqrt(2), Math.sqrt(3) / 2, 1];
  const i = Number(data.variant ?? 0) % vals.length;
  const t = vals[i];
  const deg = Math.round((Math.asin(t) * 180) / Math.PI);
  return {
    question: `Find sin⁻¹(${fmt(t, 3)}) in degrees (principal value).`,
    correctAnswer: `${deg}°`,
    explanation: `Principal value of sin⁻¹ lies in [−90°, 90°]. sin(${deg}°) = ${fmt(t, 3)}.`,
    values: { t, deg },
  };
});

register("itg_composite_sin", (data, rng) => {
  const angles = [0, 30, 45, 60, 90];
  const i = Number(data.variant ?? 0) % angles.length;
  const a = angles[i];
  const rad = (a * Math.PI) / 180;
  const val = Math.round(Math.sin(Math.asin(Math.sin(rad)) * 1000) / 1000);
  return {
    question: `Evaluate sin(sin⁻¹(sin ${a}°)) (principal branch).`,
    correctAnswer: fmt(Math.sin(Math.asin(Math.sin(rad)))),
    explanation: `Use principal values of inverse trigonometric functions per NCERT.`,
    values: { a, val },
  };
});

// ── Matrices ──────────────────────────────────────────────────────────────────
register("mat_add_2x2", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = [coeff(rng, v), coeff(rng, v + 1), coeff(rng, v + 2), coeff(rng, v + 3)];
  const b = [coeff(rng, v + 4), coeff(rng, v + 5), coeff(rng, v + 6), coeff(rng, v + 7)];
  const sum = a.map((x, i) => x + b[i]);
  return {
    question: `If A = [${a[0]} ${a[1]}; ${a[2]} ${a[3]}] and B = [${b[0]} ${b[1]}; ${b[2]} ${b[3]}], find A + B.`,
    correctAnswer: `[${sum[0]} ${sum[1]}; ${sum[2]} ${sum[3]}]`,
    explanation: `Add corresponding entries of same-order matrices.`,
    values: { s00: sum[0], s01: sum[1], s10: sum[2], s11: sum[3] },
  };
});

register("mat_multiply_2x2", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = [1 + (v % 3), 0, 0, 1 + (v % 2)];
  const b = [coeff(rng, v), coeff(rng, v + 1), coeff(rng, v + 2), coeff(rng, v + 3)];
  const c00 = a[0] * b[0] + a[1] * b[2];
  const c01 = a[0] * b[1] + a[1] * b[3];
  const c10 = a[2] * b[0] + a[3] * b[2];
  const c11 = a[2] * b[1] + a[3] * b[3];
  return {
    question: `Multiply A = [${a[0]} ${a[1]}; ${a[2]} ${a[3]}] with B = [${b[0]} ${b[1]}; ${b[2]} ${b[3]}].`,
    correctAnswer: `[${c00} ${c01}; ${c10} ${c11}]`,
    explanation: `Row-by-column multiplication for 2×2 matrices.`,
    values: { c00, c01, c10, c11 },
  };
});

register("mat_transpose", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const m = [coeff(rng, v), coeff(rng, v + 1), coeff(rng, v + 2), coeff(rng, v + 3)];
  return {
    question: `Find transpose of A = [${m[0]} ${m[1]}; ${m[2]} ${m[3]}].`,
    correctAnswer: `[${m[0]} ${m[2]}; ${m[1]} ${m[3]}]`,
    explanation: `Transpose swaps rows and columns: (Aᵀ)ᵢⱼ = Aⱼᵢ.`,
    values: {},
  };
});

// ── Determinants ──────────────────────────────────────────────────────────────
register("det_2x2", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = coeff(rng, v), b = coeff(rng, v + 1), c = coeff(rng, v + 2), d = coeff(rng, v + 3);
  const det = a * d - b * c;
  return {
    question: `Find |A| where A = [${a} ${b}; ${c} ${d}].`,
    correctAnswer: fmt(det),
    explanation: `For 2×2 matrix, |A| = ad − bc = (${a})(${d}) − (${b})(${c}).`,
    values: { det },
  };
});

register("det_3x3_simple", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = 1 + (v % 2), d = 2 + (v % 3), g = 3 + (v % 2);
  const det = a * d * g;
  return {
    question: `Find determinant of diagonal matrix diag(${a}, ${d}, ${g}).`,
    correctAnswer: fmt(det),
    explanation: `Determinant of a diagonal matrix is the product of diagonal entries.`,
    values: { det },
  };
});

// ── Continuity & Differentiability ────────────────────────────────────────────
register("cont_limit_poly", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = coeff(rng, v), b = coeff(rng, v + 1);
  const x0 = randInt(rng, 1, 4);
  const limit = a * x0 * x0 + b;
  return {
    question: `Find lim(x→${x0}) (${a}x² + ${b}) for polynomial f(x) = ${a}x² + ${b}.`,
    correctAnswer: fmt(limit),
    explanation: `Polynomials are continuous everywhere; substitute x = ${x0}.`,
    values: { limit, x0 },
  };
});

register("diff_power_rule", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const n = 2 + (v % 5);
  const coeffn = 1 + (v % 4);
  return {
    question: `Differentiate f(x) = ${coeffn}x^${n} w.r.t. x.`,
    correctAnswer: `${coeffn * n}x^${n - 1}`,
    explanation: `d/dx(x^n) = nx^(n−1) — power rule (NCERT Class 12).`,
    values: { n, coeffn },
  };
});

// ── Applications of Derivatives ─────────────────────────────────────────────
register("appd_critical_cubic", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = 1;
  const b = -3 - (v % 4);
  const c = 2 + (v % 3);
  const disc = b * b - 3 * a * c;
  const x1 = (-b + Math.sqrt(Math.max(disc, 0))) / (3 * a);
  return {
    question: `Find x where f′(x) = 0 for f(x) = x³ ${b}x² + ${c}x (critical points).`,
    correctAnswer: fmt(x1, 2),
    explanation: `f′(x) = 3x² + ${2 * b}x + ${c}. Set f′(x)=0 and solve quadratic.`,
    values: { b, c },
  };
});

register("appd_increasing_interval", (data, rng) => {
  const v = Number(data.variant ?? 0);
  return {
    question: `If f′(x) = x − ${2 + (v % 5)} > 0, on which interval is f increasing?`,
    correctAnswer: `x > ${2 + (v % 5)}`,
    explanation: `Function increases where derivative is positive.`,
    values: { k: 2 + (v % 5) },
  };
});

// ── Integrals ─────────────────────────────────────────────────────────────────
register("int_power", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const n = 1 + (v % 4);
  const k = 1 + (v % 6);
  return {
    question: `Evaluate ∫ ${k}x^${n} dx.`,
    correctAnswer: `${fmt(k / (n + 1))}x^${n + 1} + C`,
    explanation: `∫x^n dx = x^(n+1)/(n+1) + C.`,
    values: { n, k },
  };
});

register("int_trig", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const func = v % 2 === 0 ? "cos" : "sin";
  return {
    question: `Evaluate ∫ ${func}(x) dx.`,
    correctAnswer: func === "cos" ? "sin(x) + C" : "−cos(x) + C",
    explanation: `Standard NCERT integral table.`,
    values: { func },
  };
});

// ── Applications of Integrals ─────────────────────────────────────────────────
register("aint_area_line", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const m = 2 + (v % 4);
  const upper = 3 + (v % 3);
  const area = (m * upper * upper) / 2;
  return {
    question: `Area under y = ${m}x from x = 0 to x = ${upper}?`,
    correctAnswer: fmt(area, 2),
    explanation: `∫₀^${upper} ${m}x dx = ${m}x²/2 |₀^${upper}.`,
    values: { area },
  };
});

register("aint_between_curves", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = 1 + (v % 2);
  return {
    question: `Area between y = x and y = x² on [0,1] equals?`,
    correctAnswer: fmt(1 / 6, 3),
    explanation: `∫₀¹ (x − x²) dx = [x²/2 − x³/3]₀¹ = 1/2 − 1/3 = 1/6.`,
    values: { a },
  };
});

register("aint_area_under_parabola", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = 1 + (v % 3);
  const upper = 1 + (v % 4);
  const area = (a * upper ** 3) / 3;
  return {
    question: `Area under y = ${a}x² from x = 0 to x = ${upper} is?`,
    correctAnswer: fmt(area, 2),
    explanation: `Area = ∫₀^${upper} ${a}x² dx = ${a}·x³/3 |₀^${upper}.`,
    values: { area, upper },
  };
});

// ── Differential Equations ────────────────────────────────────────────────────
register("de_order_degree", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const order = 1 + (v % 2);
  const degree = 1 + (v % 3);
  return {
    question: `For y'' + (y')^${degree} = 0, order and degree are?`,
    correctAnswer: `order ${order}, degree ${degree}`,
    explanation: `Order = highest derivative order; degree = power of highest derivative (when polynomial in derivatives).`,
    values: { order, degree },
  };
});

register("de_separable", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const k = 1 + (v % 5);
  return {
    question: `Solve dy/dx = ${k}y (y > 0).`,
    correctAnswer: `y = Ce^${k}x`,
    explanation: `Separable: dy/y = ${k}dx ⇒ ln y = ${k}x + C.`,
    values: { k },
  };
});

// ── Vector Algebra ────────────────────────────────────────────────────────────
register("vec_dot", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = [coeff(rng, v), coeff(rng, v + 1), coeff(rng, v + 2)];
  const b = [coeff(rng, v + 3), coeff(rng, v + 4), coeff(rng, v + 5)];
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return {
    question: `Find a·b if a = ${a.join("i + ")}j + ${a[2]}k and b = ${b[0]}i + ${b[1]}j + ${b[2]}k.`,
    correctAnswer: fmt(dot),
    explanation: `Dot product = a₁b₁ + a₂b₂ + a₃b₃.`,
    values: { dot },
  };
});

register("vec_magnitude", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = randInt(rng, 1, 5);
  const b = randInt(rng, 1, 5);
  const mag = Math.sqrt(a * a + b * b);
  return {
    question: `Magnitude of vector ${a}i + ${b}j is?`,
    correctAnswer: fmt(mag, 3),
    explanation: `|v| = √(a² + b²).`,
    values: { mag },
  };
});

// ── 3D Geometry ───────────────────────────────────────────────────────────────
register("geo3d_distance", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const x1 = coeff(rng, v), y1 = coeff(rng, v + 1), z1 = coeff(rng, v + 2);
  const x2 = coeff(rng, v + 3), y2 = coeff(rng, v + 4), z2 = coeff(rng, v + 5);
  const d = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2 + (z2 - z1) ** 2);
  return {
    question: `Distance between (${x1},${y1},${z1}) and (${x2},${y2},${z2})?`,
    correctAnswer: fmt(d, 2),
    explanation: `Distance formula in 3D: √[(x₂−x₁)² + (y₂−y₁)² + (z₂−z₁)²].`,
    values: { d },
  };
});

// ── Linear Programming ────────────────────────────────────────────────────────
register("lp_feasible_region", (data, rng) => {
  const v = Number(data.variant ?? 0);
  return {
    question: `For constraints x + y ≤ ${6 + (v % 3)}, x,y ≥ 0, which point is feasible?`,
    correctAnswer: `(1, 2)`,
    explanation: `Feasible points satisfy all inequalities simultaneously.`,
    values: {},
  };
});

register("lp_minimize", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = 2 + (v % 3);
  const b = 3 + (v % 2);
  return {
    question: `Minimize Z = ${a}x + ${b}y on x,y ≥ 0. Minimum value at origin is?`,
    correctAnswer: "0",
    explanation: `At (0,0), Z = 0 is minimum for positive-coefficient objective with x,y ≥ 0.`,
    values: { a, b },
  };
});

register("lp_corner_max", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const a = 3 + (v % 2);
  const b = 4 + (v % 2);
  const max = a * 2 + b * 3;
  return {
    question: `Maximize Z = ${a}x + ${b}y subject to x ≤ 2, y ≤ 3, x,y ≥ 0. Maximum at (2,3)?`,
    correctAnswer: fmt(max),
    explanation: `Evaluate Z at corner points of feasible region; (2,3) gives maximum here.`,
    values: { max },
  };
});

// ── Probability ─────────────────────────────────────────────────────────────
register("prob_conditional", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const pa = 10 + (v % 5);
  const pb = 6 + (v % 4);
  const pab = 2 + (v % 3);
  const ans = fmt(pab / pb, 3);
  return {
    question: `P(A)=${pa}/20, P(A∩B)=${pab}/20, P(B)=${pb}/20. Find P(A|B).`,
    correctAnswer: ans,
    explanation: `P(A|B) = P(A∩B)/P(B) = (${pab}/20)/(${pb}/20).`,
    values: { pa, pb, pab },
  };
});

register("prob_bayes", (data, rng) => {
  const v = Number(data.variant ?? 0);
  const sens = 0.9;
  const spec = 0.85 + (v % 10) / 100;
  const prev = 0.01 + (v % 5) / 100;
  const num = sens * prev;
  const den = sens * prev + (1 - spec) * (1 - prev);
  return {
    question: `Test sensitivity ${sens}, specificity ${fmt(spec, 2)}, disease prevalence ${fmt(prev, 2)}. P(disease|+) ≈?`,
    correctAnswer: fmt(num / den, 3),
    explanation: `Bayes theorem: P(D|+) = P(+|D)P(D) / P(+).`,
    values: { sens, spec, prev },
  };
});

import "./expanded";
