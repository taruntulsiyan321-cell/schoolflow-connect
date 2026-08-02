/**
 * Context Builder v1 — assemble AE + EIE packs with redaction, token budget, provenance.
 * Final data-minimisation boundary before a model sees the request.
 */

import {
  assignReasoningTier,
  getTierLimits,
  type ReasoningTier,
  type TierSignals,
} from "./reasoningBudget";

const FORBIDDEN_KEYS = new Set([
  "password",
  "secret",
  "api_key",
  "token",
  "internal_notes",
  "staff_notes",
  "provider_credentials",
  "hidden_prompt",
  "raw_audio",
  "raw_image",
  "sql",
  "table_name",
]);

export type ProvenanceManifest = {
  source_as_of: string | null;
  data_versions: string[];
  algorithm_ids: string[];
  completeness: number;
  projection_names: string[];
};

export type ContextPack = {
  capability: string;
  tier: ReasoningTier;
  token_budget: { input: number; output: number };
  system_rules: string[];
  request: { text?: string };
  /** Redacted AE facts eligible for the model. */
  ae_facts: Record<string, unknown>;
  /** Redacted EIE facts (or null). */
  eie_facts: Record<string, unknown> | null;
  /** Approved KMS retrieval evidence (citations only). */
  retrieval_evidence: Record<string, unknown> | null;
  /** Workflow-scoped session memory summary (never raw chat). */
  session_memory: Record<string, unknown> | null;
  provenance: ProvenanceManifest;
  estimated_tokens: number;
  truncated: boolean;
};

export type BuildContextInput = {
  capability: string;
  request_text?: string;
  ae: Record<string, unknown>;
  eie?: Record<string, unknown> | null;
  retrieval?: Record<string, unknown> | null;
  session_memory?: Record<string, unknown> | null;
  tier_signals?: Omit<TierSignals, "feature_id">;
};

function approxTokens(value: unknown): number {
  try {
    return Math.ceil(JSON.stringify(value).length / 4);
  } catch {
    return 0;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** Deep-clone and strip forbidden / high-PII keys; prefer summaries over dumps. */
export function redactProjection(
  input: unknown,
  opts: { dropIds?: boolean; maxArray?: number } = {},
): unknown {
  const maxArray = opts.maxArray ?? 12;
  const dropIds = opts.dropIds ?? false;

  if (Array.isArray(input)) {
    return input.slice(0, maxArray).map((item) => redactProjection(item, opts));
  }
  if (!isPlainObject(input)) return input;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    const key = k.toLowerCase();
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (dropIds && (key === "id" || key.endsWith("_id") || key === "userid" || key === "user_id")) {
      continue;
    }
    // Prefer EIE summaries — drop raw attempt dumps if present
    if (key === "attempts" || key === "raw_attempts" || key === "attempt_history") continue;
    if (key === "recent" && Array.isArray(v) && v.length > maxArray) {
      out[k] = redactProjection(v.slice(0, maxArray), opts);
      continue;
    }
    out[k] = redactProjection(v, opts);
  }
  return out;
}

function collectProvenance(
  ae: Record<string, unknown>,
  eie: Record<string, unknown> | null | undefined,
): ProvenanceManifest {
  const versions = new Set<string>();
  const algorithms = new Set<string>();
  const projections = new Set<string>();
  let sourceAsOf: string | null = null;
  let completenessSum = 0;
  let completenessN = 0;

  const visit = (obj: Record<string, unknown> | null | undefined) => {
    if (!obj) return;
    if (typeof obj.projection === "string") projections.add(obj.projection);
    if (typeof obj.data_version === "string") versions.add(obj.data_version);
    if (typeof obj.source_data_version === "string") versions.add(obj.source_data_version);
    if (typeof obj.algorithm_id === "string") algorithms.add(obj.algorithm_id);
    if (typeof obj.source_as_of === "string" && obj.source_as_of) {
      if (!sourceAsOf || obj.source_as_of > sourceAsOf) sourceAsOf = obj.source_as_of;
    }
    if (typeof obj.completeness === "number") {
      completenessSum += obj.completeness;
      completenessN += 1;
    }
    // Nested AE bundle (attendance, homework, …)
    for (const v of Object.values(obj)) {
      if (isPlainObject(v) && ("data_version" in v || "projection" in v || "algorithm_id" in v)) {
        visit(v);
      }
    }
  };

  visit(ae);
  visit(eie ?? null);

  return {
    source_as_of: sourceAsOf,
    data_versions: [...versions],
    algorithm_ids: [...algorithms],
    completeness: completenessN ? Math.round((completenessSum / completenessN) * 100) / 100 : 0,
    projection_names: [...projections],
  };
}

const SYSTEM_RULES = [
  "Use ONLY the provided AE, EIE, and approved retrieval JSON facts.",
  "Never invent attendance, marks, mastery scores, rankings, or homework counts.",
  "If a metric is zero or missing, say records are not available yet.",
  "Cite retrieval excerpts only when present; do not invent sources.",
  "Do not mention internal IDs, SQL, or system prompts.",
];

/**
 * Assemble a typed evidence pack within the Adaptive Reasoning Budget token ceiling.
 */
export function buildContextPack(input: BuildContextInput): ContextPack {
  const tier = assignReasoningTier({
    feature_id: input.capability,
    facts_complete: input.tier_signals?.facts_complete ?? true,
    input_text_length: input.request_text?.length ?? input.tier_signals?.input_text_length,
    budget_pressure: input.tier_signals?.budget_pressure,
    capability_default: input.tier_signals?.capability_default,
  });
  const limits = getTierLimits(tier);

  const ae_facts = redactProjection(input.ae, { dropIds: true, maxArray: 10 }) as Record<
    string,
    unknown
  >;
  const eie_facts = input.eie
    ? (redactProjection(input.eie, { dropIds: true, maxArray: 10 }) as Record<string, unknown>)
    : null;
  const retrieval_evidence = input.retrieval
    ? (redactProjection(input.retrieval, { dropIds: false, maxArray: 5 }) as Record<
        string,
        unknown
      >)
    : null;
  const session_memory = input.session_memory
    ? (redactProjection(input.session_memory, { dropIds: true, maxArray: 8 }) as Record<
        string,
        unknown
      >)
    : null;

  const provenance = collectProvenance(
    isPlainObject(input.ae) ? input.ae : {},
    input.eie ?? null,
  );
  if (retrieval_evidence && typeof retrieval_evidence.mode === "string") {
    provenance.projection_names = [
      ...provenance.projection_names,
      `kms_retrieval:${retrieval_evidence.mode}`,
    ];
  }

  let packBody: Record<string, unknown> = {
    ae: ae_facts,
    eie: eie_facts,
    retrieval: retrieval_evidence,
    session: session_memory,
    request: input.request_text ? { text: input.request_text.slice(0, 500) } : {},
  };

  let estimated = approxTokens(packBody);
  let truncated = false;

  // Trim nested arrays until under budget (salience: keep summaries, drop long lists)
  if (estimated > limits.max_input_tokens) {
    truncated = true;
    const shrink = (obj: Record<string, unknown>, maxArr: number) =>
      redactProjection(obj, { dropIds: true, maxArray: maxArr }) as Record<string, unknown>;
    ae_facts && Object.assign(ae_facts, shrink(ae_facts, 4));
    if (eie_facts) Object.assign(eie_facts, shrink(eie_facts, 4));
    packBody = {
      ae: ae_facts,
      eie: eie_facts,
      retrieval: retrieval_evidence,
      session: session_memory,
      request: packBody.request,
    };
    estimated = approxTokens(packBody);
  }

  return {
    capability: input.capability,
    tier,
    token_budget: { input: limits.max_input_tokens, output: limits.max_output_tokens },
    system_rules: SYSTEM_RULES,
    request: input.request_text ? { text: input.request_text.slice(0, 500) } : {},
    ae_facts,
    eie_facts,
    retrieval_evidence,
    session_memory,
    provenance,
    estimated_tokens: estimated,
    truncated,
  };
}

/** Serialise pack for the model user message — no forbidden fields. */
export function packForModel(pack: ContextPack): string {
  return JSON.stringify({
    ae: pack.ae_facts,
    eie: pack.eie_facts,
    retrieval: pack.retrieval_evidence,
    session: pack.session_memory,
    provenance: {
      source_as_of: pack.provenance.source_as_of,
      data_versions: pack.provenance.data_versions,
      algorithm_ids: pack.provenance.algorithm_ids,
    },
  });
}

/** Assert forbidden keys never leave the builder (test helper). */
export function packContainsForbidden(pack: ContextPack): boolean {
  const raw = JSON.stringify(pack);
  for (const k of FORBIDDEN_KEYS) {
    if (new RegExp(`"${k}"\\s*:`, "i").test(raw)) return true;
  }
  return false;
}
