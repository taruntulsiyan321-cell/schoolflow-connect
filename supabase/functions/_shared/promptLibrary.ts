/**
 * Edge Prompt Library loader — mirrors src/academic/ai/promptLibrary.ts
 */

export type PromptRecord = {
  capability_id: string;
  version: string;
  status: string;
  audience: string;
  system_template: string;
  user_template: string;
  output_schema: Record<string, unknown>;
  max_output_tokens: number;
  temperature: number;
  caching_eligible: boolean;
  metadata?: Record<string, unknown>;
};

const BUILTIN: PromptRecord[] = [
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
  },
];

export function renderPromptTemplate(
  template: string,
  vars: Record<string, string>,
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    return vars[key] ?? "";
  });
}

export function getBuiltinPrompt(capabilityId: string): PromptRecord | null {
  return BUILTIN.find((p) => p.capability_id === capabilityId) ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function loadProductionPrompt(
  admin: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> },
  capabilityId: string,
): Promise<PromptRecord> {
  try {
    const { data, error } = await admin.rpc("ai_prompt_load_production", {
      p_capability_id: capabilityId,
    });
    if (!error && data && typeof data === "object") {
      return data as PromptRecord;
    }
  } catch {
    // fall through
  }
  const builtin = getBuiltinPrompt(capabilityId);
  if (builtin) return builtin;
  return {
    capability_id: capabilityId,
    version: "fallback",
    status: "production",
    audience: "student",
    system_template:
      "Use only provided facts. Never invent academic numbers. Keep answers short.",
    user_template: "Facts:\n{{facts}}\n\nQuestion: {{question}}",
    output_schema: {},
    max_output_tokens: 250,
    temperature: 0.2,
    caching_eligible: false,
  };
}
