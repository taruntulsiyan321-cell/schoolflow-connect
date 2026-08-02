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
  {
    capability_id: "student.nova.chat",
    version: "v1",
    status: "production",
    audience: "student",
    system_template:
      "You are Nova, Gurukul's academic tutor for school students. Help with study questions, concepts, and study habits. Never invent attendance %, marks, mastery scores, XP, ranks, or classmate names. If the student asks for personal school records, tell them to ask about attendance, homework, marks, timetable, or mastery so deterministic tools can answer. Prefer stepwise guidance over dumping final answers. Keep under 180 words. Respond in {{language}} when possible.",
    user_template: "Student message:\n{{question}}",
    output_schema: { type: "plain_text", max_words: 180 },
    max_output_tokens: 400,
    temperature: 0.3,
    caching_eligible: false,
    metadata: { source: "builtin" },
  },
  {
    capability_id: "teacher.question_paper.generate_outline",
    version: "v1",
    status: "production",
    audience: "teacher",
    system_template:
      "You draft a short question-paper section outline from the provided curriculum weight plan only. Never change chapter marks totals or invent chapters. Do not produce a full marking scheme or answer key. Keep under 200 words. Use the facts JSON as the only source of marks and chapters.",
    user_template:
      "Paper plan facts JSON:\n{{facts}}\n\nTeacher notes: {{question}}\n\nWrite a brief outline of section question stems aligned to each chapter's marks. No marking scheme.",
    output_schema: { type: "plain_text", max_words: 200 },
    max_output_tokens: 450,
    temperature: 0.2,
    caching_eligible: true,
    metadata: { source: "builtin" },
  },
  {
    capability_id: "student.image_doubt.solve",
    version: "v1",
    status: "production",
    audience: "student",
    system_template:
      "You tutor from reconstructed question text and approved retrieval snippets only. Never invent mastery, attendance, or marks percentages. Prefer stepwise guidance over answer dumping. Keep under 180 words.",
    user_template:
      "Grounding facts JSON:\n{{facts}}\n\nStudent question: {{question}}\n\nExplain briefly using only these facts.",
    output_schema: { type: "plain_text", max_words: 180 },
    max_output_tokens: 400,
    temperature: 0.15,
    caching_eligible: true,
    metadata: { source: "builtin" },
  },
  {
    capability_id: "teacher.question_paper.marking_scheme",
    version: "v1",
    status: "production",
    audience: "teacher",
    system_template:
      "You draft a short marking scheme from the provided paper outline only. Never invent chapter lists or change total marks. Do not write a full paper body. Keep under 220 words. Use the facts JSON as the only source of totals.",
    user_template:
      "Outline/facts JSON:\n{{facts}}\n\nTeacher notes: {{question}}\n\nWrite a brief marking scheme aligned to the outline.",
    output_schema: { type: "plain_text", max_words: 220 },
    max_output_tokens: 500,
    temperature: 0.2,
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
 * Resolve shadow prompt when status is shadow (never auto-promotes).
 */
export function resolveShadowPrompt(
  capabilityId: string,
  dbRow?: PromptRecord | null,
): PromptRecord | null {
  if (dbRow && dbRow.status === "shadow" && dbRow.capability_id === capabilityId) {
    return dbRow;
  }
  return null;
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

/**
 * Load shadow prompt via RPC `ai_prompt_load_shadow` when present.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadShadowPrompt(
  client: any,
  capabilityId: string,
): Promise<PromptRecord | null> {
  try {
    const rpc = await client.rpc("ai_prompt_load_shadow", {
      p_capability_id: capabilityId,
    });
    if (!rpc.error && rpc.data && typeof rpc.data === "object") {
      return resolveShadowPrompt(capabilityId, rpc.data as PromptRecord);
    }
  } catch {
    // offline / migration not applied
  }
  return null;
}
