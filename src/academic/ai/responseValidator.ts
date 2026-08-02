/**
 * Response Validator v1 — grounding checks against AE/EIE facts.
 * Numbers in model output must match evidence; invented mastery % is rejected.
 */

export type ValidationCode =
  | "ok"
  | "invented_mastery_pct"
  | "invented_attendance_pct"
  | "invented_marks_pct"
  | "numeric_mismatch"
  | "empty_response"
  | "too_long"
  | "forbidden_claim";

export type ValidationResult = {
  ok: boolean;
  codes: ValidationCode[];
  /** Material failures that must not be shown as generative truth. */
  material_failure: boolean;
  grounded_numbers_checked: number;
  message?: string;
};

export type EvidenceFacts = {
  attendance_pct?: number | null;
  average_marks_pct?: number | null;
  avg_mastery?: number | null;
  homework_pending?: number | null;
  /** Explicit allow-list of percentages that may appear (0–100). */
  allowed_pcts?: number[];
};

const INVENTED_MASTERY_RE =
  /\b(?:mastery|concept\s+mastery|mastery\s+score)\b[^0-9%]{0,40}(\d{1,3}(?:\.\d+)?)\s*%/gi;
const ATTENDANCE_RE =
  /\battendance\b[^0-9%]{0,40}(\d{1,3}(?:\.\d+)?)\s*%/gi;
const MARKS_RE =
  /\b(?:marks|score|average|avg)\b[^0-9%]{0,40}(\d{1,3}(?:\.\d+)?)\s*%/gi;
const ANY_PCT_RE = /(\d{1,3}(?:\.\d+)?)\s*%/g;

function nearEqual(a: number, b: number, tol = 0.6): boolean {
  return Math.abs(a - b) <= tol;
}

function collectMatches(re: RegExp, text: string): number[] {
  const out: number[] = [];
  const r = new RegExp(re.source, re.flags);
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    out.push(Number(m[1]));
  }
  return out;
}

function buildAllowList(facts: EvidenceFacts): number[] {
  const set = new Set<number>();
  for (const v of [
    facts.attendance_pct,
    facts.average_marks_pct,
    facts.avg_mastery,
    ...(facts.allowed_pcts ?? []),
  ]) {
    if (typeof v === "number" && Number.isFinite(v)) set.add(v);
  }
  return [...set];
}

/**
 * Validate model draft against evidence. Deterministic checks only (no LLM evaluator).
 */
export function validateModelResponse(
  text: string,
  facts: EvidenceFacts,
  opts: { max_chars?: number } = {},
): ValidationResult {
  const codes: ValidationCode[] = [];
  const maxChars = opts.max_chars ?? 2500;
  let grounded = 0;

  if (!text || !text.trim()) {
    return {
      ok: false,
      codes: ["empty_response"],
      material_failure: true,
      grounded_numbers_checked: 0,
      message: "Empty model response",
    };
  }
  if (text.length > maxChars) {
    codes.push("too_long");
  }

  const allow = buildAllowList(facts);

  const masteryClaims = collectMatches(INVENTED_MASTERY_RE, text);
  for (const n of masteryClaims) {
    grounded += 1;
    if (facts.avg_mastery == null || !Number.isFinite(facts.avg_mastery)) {
      // No mastery in evidence — any mastery % is invented
      codes.push("invented_mastery_pct");
    } else if (!nearEqual(n, facts.avg_mastery)) {
      codes.push("invented_mastery_pct");
    }
  }

  const attClaims = collectMatches(ATTENDANCE_RE, text);
  for (const n of attClaims) {
    grounded += 1;
    if (facts.attendance_pct == null || !Number.isFinite(facts.attendance_pct)) {
      codes.push("invented_attendance_pct");
    } else if (!nearEqual(n, facts.attendance_pct)) {
      codes.push("invented_attendance_pct");
    }
  }

  const marksClaims = collectMatches(MARKS_RE, text);
  for (const n of marksClaims) {
    grounded += 1;
    if (facts.average_marks_pct == null || !Number.isFinite(facts.average_marks_pct)) {
      // May be generic "score" language — only fail if clearly not in allow-list
      if (!allow.some((a) => nearEqual(n, a))) {
        codes.push("invented_marks_pct");
      }
    } else if (!nearEqual(n, facts.average_marks_pct) && !allow.some((a) => nearEqual(n, a))) {
      codes.push("invented_marks_pct");
    }
  }

  // Catch bare percentages that don't match any known fact when we have numeric evidence
  if (allow.length > 0) {
    const allPcts = collectMatches(ANY_PCT_RE, text);
    for (const n of allPcts) {
      if (n > 100) {
        codes.push("numeric_mismatch");
        continue;
      }
      // Common non-academic percentages (e.g. "100% sure") — skip 100 when not in facts
      if (n === 100 && !allow.some((a) => nearEqual(a, 100))) continue;
      if (!allow.some((a) => nearEqual(n, a))) {
        // Only material if claiming academic-looking precision with evidence present
        if (masteryClaims.includes(n) || attClaims.includes(n) || marksClaims.includes(n)) {
          codes.push("numeric_mismatch");
        }
      }
    }
  }

  if (/\b(rank\s*#?\s*1|top\s*of\s*(the\s*)?class|guaranteed\s*pass)\b/i.test(text)) {
    codes.push("forbidden_claim");
  }

  const unique = [...new Set(codes)];
  const material = unique.some((c) =>
    [
      "invented_mastery_pct",
      "invented_attendance_pct",
      "invented_marks_pct",
      "numeric_mismatch",
      "forbidden_claim",
      "empty_response",
    ].includes(c),
  );

  return {
    ok: !material && !unique.includes("too_long"),
    codes: unique.length ? unique : ["ok"],
    material_failure: material,
    grounded_numbers_checked: grounded,
    message: material ? "Response failed grounding checks" : undefined,
  };
}

/** Extract evidence numbers from AE+EIE fact bundle used by performance.explain. */
export function evidenceFromExplainFacts(facts: {
  attendance?: { attendance_pct?: number };
  marks?: { average_pct?: number | null };
  eie?: { avg_mastery?: number };
  homework?: { pending_count?: number };
}): EvidenceFacts {
  const allowed: number[] = [];
  if (typeof facts.attendance?.attendance_pct === "number") {
    allowed.push(facts.attendance.attendance_pct);
  }
  if (typeof facts.marks?.average_pct === "number") allowed.push(facts.marks.average_pct);
  if (typeof facts.eie?.avg_mastery === "number") allowed.push(facts.eie.avg_mastery);

  return {
    attendance_pct: facts.attendance?.attendance_pct ?? null,
    average_marks_pct: facts.marks?.average_pct ?? null,
    avg_mastery: facts.eie?.avg_mastery ?? null,
    homework_pending: facts.homework?.pending_count ?? null,
    allowed_pcts: allowed,
  };
}
