/**
 * Response Validator v1 — grounding checks against AE/EIE facts.
 * Numbers in model output must match evidence; invented mastery % / XP is rejected.
 */

export type ValidationCode =
  | "ok"
  | "invented_mastery_pct"
  | "invented_attendance_pct"
  | "invented_marks_pct"
  | "invented_xp"
  | "invented_level"
  | "invented_streak"
  | "numeric_mismatch"
  | "empty_response"
  | "too_long"
  | "forbidden_claim"
  | "injection_signal";

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
  /** Progression allow-list (Nova must not invent these). */
  xp?: number | null;
  level?: number | null;
  study_streak?: number | null;
  battleground_wins?: number | null;
};

const INVENTED_MASTERY_RE =
  /\b(?:mastery|concept\s+mastery|mastery\s+score)\b[^0-9%]{0,40}(\d{1,3}(?:\.\d+)?)\s*%/gi;
const ATTENDANCE_RE =
  /\battendance\b[^0-9%]{0,40}(\d{1,3}(?:\.\d+)?)\s*%/gi;
const MARKS_RE =
  /\b(?:marks|score|average|avg)\b[^0-9%]{0,40}(\d{1,3}(?:\.\d+)?)\s*%/gi;
const ANY_PCT_RE = /(\d{1,3}(?:\.\d+)?)\s*%/g;
const XP_RE = /\b(\d{1,7})\s*(?:XP|xp)\b/g;
const LEVEL_RE = /\b(?:level|Lv\.?|lvl)\s*(\d{1,3})\b/gi;
const STREAK_RE = /\b(\d{1,4})\s*(?:-?\s*day\s+)?(?:study\s+)?streak\b/gi;

// Cheap, deterministic tripwires for a successful prompt-injection response —
// NOT a substitute for the input-side spotlighting in promptLibrary.ts, only
// a second layer. Catches the two lowest-effort/highest-payoff outcomes: the
// model echoing role-marker syntax from the raw chat format (a strong signal
// it followed injected formatting instructions rather than staying in
// character), and the model reproducing recognizable phrases from its own
// system_template (a leak, whether prompted by injection or not).
const ROLE_MARKER_RE = /(^|\n)\s*(system|assistant|user)\s*:/i;
const META_INSTRUCTION_RE =
  /\b(ignore (the |all )?(previous|prior|above) (instructions|rules|prompt)|reveal (your |the )?(system )?prompt|you are now|new instructions?:|disregard (the |all )?(above|prior))\b/i;

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
  opts: { max_chars?: number; system_template?: string } = {},
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
      if (!allow.some((a) => nearEqual(n, a))) {
        codes.push("invented_marks_pct");
      }
    } else if (!nearEqual(n, facts.average_marks_pct) && !allow.some((a) => nearEqual(n, a))) {
      codes.push("invented_marks_pct");
    }
  }

  const xpClaims = collectMatches(XP_RE, text);
  for (const n of xpClaims) {
    grounded += 1;
    if (facts.xp == null || !Number.isFinite(facts.xp) || !nearEqual(n, facts.xp, 0)) {
      codes.push("invented_xp");
    }
  }

  const levelClaims = collectMatches(LEVEL_RE, text);
  for (const n of levelClaims) {
    grounded += 1;
    if (facts.level == null || !Number.isFinite(facts.level) || !nearEqual(n, facts.level, 0)) {
      codes.push("invented_level");
    }
  }

  const streakClaims = collectMatches(STREAK_RE, text);
  for (const n of streakClaims) {
    grounded += 1;
    if (
      facts.study_streak == null ||
      !Number.isFinite(facts.study_streak) ||
      !nearEqual(n, facts.study_streak, 0)
    ) {
      codes.push("invented_streak");
    }
  }

  if (allow.length > 0) {
    const allPcts = collectMatches(ANY_PCT_RE, text);
    for (const n of allPcts) {
      if (n > 100) {
        codes.push("numeric_mismatch");
        continue;
      }
      if (n === 100 && !allow.some((a) => nearEqual(a, 100))) continue;
      if (!allow.some((a) => nearEqual(n, a))) {
        if (masteryClaims.includes(n) || attClaims.includes(n) || marksClaims.includes(n)) {
          codes.push("numeric_mismatch");
        }
      }
    }
  }

  if (/\b(rank\s*#?\s*1|top\s*of\s*(the\s*)?class|guaranteed\s*pass)\b/i.test(text)) {
    codes.push("forbidden_claim");
  }

  // Injection tripwires — see the regex comments above. A false positive here
  // just triggers the existing degraded/material_failure path (same as an
  // invented number would), not an error, so these are intentionally cheap
  // and a little over-eager rather than trying to be a precise classifier.
  if (ROLE_MARKER_RE.test(text) || META_INSTRUCTION_RE.test(text)) {
    codes.push("injection_signal");
  } else if (opts.system_template) {
    const words = opts.system_template.toLowerCase().split(/\s+/).filter(Boolean);
    const responseLower = text.toLowerCase();
    for (let i = 0; i + 8 <= words.length; i += 4) {
      const window = words.slice(i, i + 8).join(" ");
      if (window.length > 20 && responseLower.includes(window)) {
        codes.push("injection_signal");
        break;
      }
    }
  }

  const unique = [...new Set(codes)];
  const material = unique.some((c) =>
    [
      "invented_mastery_pct",
      "invented_attendance_pct",
      "invented_marks_pct",
      "invented_xp",
      "invented_level",
      "invented_streak",
      "numeric_mismatch",
      "forbidden_claim",
      "injection_signal",
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

/** Extract evidence numbers from AE+EIE fact bundle used by performance.explain / Nova. */
export function evidenceFromExplainFacts(facts: {
  attendance?: { attendance_pct?: number };
  marks?: { average_pct?: number | null };
  eie?: { avg_mastery?: number };
  homework?: { pending_count?: number };
  progression?: {
    xp?: number;
    level?: number;
    study_streak?: number;
    battleground_wins?: number;
  };
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
    xp: facts.progression?.xp ?? null,
    level: facts.progression?.level ?? null,
    study_streak: facts.progression?.study_streak ?? null,
    battleground_wins: facts.progression?.battleground_wins ?? null,
  };
}
