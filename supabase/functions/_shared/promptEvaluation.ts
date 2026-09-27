/**
 * Prompt Evaluation Framework scaffold — draft→benchmark→shadow→A/B→production.
 * Feedback can trigger re-eval candidates; never auto-promotes.
 */









/**
 * Deterministic % traffic sampler for shadow prompts.
 * Uses request_id hash so the same request is stable.
 */
function shouldUseShadowPrompt(
  requestId: string | null | undefined,
  shadowPercent: number,
): boolean {
  const pct = Math.max(0, Math.min(100, Number(shadowPercent) || 0));
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  const id = (requestId ?? "").trim() || "anon";
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) >>> 0;
  }
  return h % 100 < pct;
}

type ShadowPromptFlag = {
  enabled: boolean;
  /** 0–100 percent of traffic that may load shadow prompt version. */
  percent: number;
};

/** Parse feature-flag metadata for ai.prompt.shadow_traffic. */
export function parseShadowPromptFlag(
  enabled: boolean,
  metadata?: Record<string, unknown> | null,
): ShadowPromptFlag {
  if (!enabled) return { enabled: false, percent: 0 };
  const raw = metadata?.percent ?? metadata?.shadow_percent ?? metadata?.traffic_percent ?? 0;
  const percent = Math.max(0, Math.min(100, Number(raw) || 0));
  return { enabled: percent > 0, percent };
}

type ResolvedPromptSelection = {
  prompt: import("./promptLibrary").PromptRecord | null;
  selected_status: "production" | "shadow" | "builtin";
  shadow_sampled: boolean;
};

/**
 * Choose production vs shadow prompt for a capability given traffic %.
 * Shadow is observational only — never auto-promotes.
 */
export function selectPromptWithShadow(input: {
  production: import("./promptLibrary").PromptRecord | null;
  shadow: import("./promptLibrary").PromptRecord | null;
  request_id?: string | null;
  shadow_percent: number;
}): ResolvedPromptSelection {
  const sampled = shouldUseShadowPrompt(input.request_id, input.shadow_percent);
  if (sampled && input.shadow) {
    return {
      prompt: input.shadow,
      selected_status: "shadow",
      shadow_sampled: true,
    };
  }
  if (input.production) {
    return {
      prompt: input.production,
      selected_status: input.production.metadata?.source === "builtin" ? "builtin" : "production",
      shadow_sampled: sampled,
    };
  }
  return { prompt: null, selected_status: "builtin", shadow_sampled: sampled };
}

