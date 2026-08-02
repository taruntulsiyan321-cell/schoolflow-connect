/**
 * Prompt Library v1 — versioned prompt contracts.
 * Runtime prefers DB production rows; built-in fallbacks keep edge/tests offline-safe.
 */

export type PromptStatus =
  | "draft"
  | "offline_benchmark"
  | "shadow"
  | "ab_test"
  | "production"
  | "retired";

export type PromptRecord = {
  capability_id: string;
  version: string;
  status: PromptStatus;
  audience: string;
  system_template: string;
  user_template: string;
  output_schema: Record<string, unknown>;
  max_output_tokens: number;
  temperature: number;
  caching_eligible: boolean;
  metadata?: Record<string, unknown>;
};

/** Built-in production fallbacks (must match migration seeds). */
export const BUILTIN_PROMPTS: PromptRecord[] = [
  {
    capability_id: "student.performance.explain",
    version: "v1",
    status: "production",
    audience: "student",
    system_template:
      "You explain Gurukul Academic Engine and Educational Intelligence facts only. Never invent numbers, mastery scores, attendance, or marks. If a figure is missing, say it is unavailable. Keep under 120 words. Encourage without shaming.",
    user_template:
      "Facts JSON:\n{{facts}}\n\nWrite a short plain-language performance summary.",
    output_schema: { type: "plain_text", max_words: 120 },
    max_output_tokens: 250,
    temperature: 0.1,
    caching_eligible: true,
    metadata: { source: "builtin" },
  },
  {
    capability_id: "student.concept.explain",
    version: "v1",
    status: "production",
    audience: "student",
    system_template:
      "You explain one school concept using only the provided Educational Intelligence and Academic Engine facts. Never invent mastery percentages or exam scores. Prefer stepwise guidance over answer dumping. Keep under 150 words.",
    user_template:
      "Concept facts JSON:\n{{facts}}\n\nStudent question: {{question}}\n\nExplain the concept briefly using only these facts.",
    output_schema: { type: "plain_text", max_words: 150 },
    max_output_tokens: 300,
    temperature: 0.15,
    caching_eligible: true,
    metadata: { source: "builtin" },
  },
  {
    capability_id: "student.recommendation.explain",
    version: "v1",
    status: "production",
    audience: "student",
    system_template:
      "You rephrase a deterministic recommendation package. Never change the recommended concept, priority order, or invent new metrics. Keep under 80 words. Task-focused, no shaming.",
    user_template:
      "Recommendation package JSON:\n{{facts}}\n\nWrite a short encouraging rationale for why this next step makes sense.",
    output_schema: { type: "plain_text", max_words: 80 },
    max_output_tokens: 200,
    temperature: 0.1,
    caching_eligible: true,
    metadata: { source: "builtin" },
  },
];

export function getBuiltinPrompt(capabilityId: string): PromptRecord | null {
  return (
    BUILTIN_PROMPTS.find(
      (p) => p.capability_id === capabilityId && p.status === "production",
    ) ?? null
  );
}

/** Fill {{key}} placeholders; unknown keys become empty string. */
export function renderPromptTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? "";
  });
}

/**
 * Resolve production prompt: optional DB row → builtin fallback.
 */
export function resolveProductionPrompt(
  capabilityId: string,
  dbRow?: PromptRecord | null,
): PromptRecord | null {
  if (dbRow && dbRow.status === "production" && dbRow.capability_id === capabilityId) {
    return dbRow;
  }
  return getBuiltinPrompt(capabilityId);
}

/**
 * Load production prompt via RPC `ai_prompt_load_production`, else builtin.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadProductionPrompt(
  client: any,
  capabilityId: string,
): Promise<PromptRecord | null> {
  try {
    const rpc = await client.rpc("ai_prompt_load_production", {
      p_capability_id: capabilityId,
    });
    if (!rpc.error && rpc.data && typeof rpc.data === "object") {
      return resolveProductionPrompt(capabilityId, rpc.data as PromptRecord);
    }
  } catch {
    // offline / migration not applied
  }
  return getBuiltinPrompt(capabilityId);
}
