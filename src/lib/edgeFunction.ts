import { supabase } from "@/integrations/supabase/client";
import type { FunctionsError } from "@supabase/supabase-js";

export type EdgeInvokeResult<T> = {
  data: T | null;
  error: string | null;
  usedFallback: boolean;
};

/** Strip vendor names from messages shown in the app UI. */
function sanitizeUserFacingError(message: string): string {
  return message
    .replace(/google[_\s-]?gemini[_\s-]?api[_\s-]?key/gi, "service configuration")
    .replace(/gemini\s*flash/gi, "learning service")
    .replace(/gemini/gi, "learning service")
    .replace(/\bAI\b/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Invoke a Supabase edge function and normalize error bodies (500 JSON, network, credits). */
export async function invokeEdgeFunction<T extends Record<string, unknown>>(
  name: string,
  body: Record<string, unknown>,
): Promise<EdgeInvokeResult<T>> {
  let data: unknown;
  let error: unknown;
  try {
    ({ data, error } = await supabase.functions.invoke(name, { body }));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Edge function failed";
    return { data: null, error: sanitizeUserFacingError(message), usedFallback: false };
  }

  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    return { data: null, error: sanitizeUserFacingError(String((data as { error: string }).error)), usedFallback: false };
  }

  if (error) {
    const fnErr = error as FunctionsError;
    let message = fnErr.message ?? "Edge function failed";

    const ctx = (fnErr as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const parsed = await ctx.json();
        if (parsed?.error) message = String(parsed.error);
      } catch {
        /* ignore */
      }
    }

    if (message.includes("Failed to send") || message.includes("FunctionsFetchError")) {
      message = "Learning service unavailable. Please retry.";
    }

    return { data: null, error: sanitizeUserFacingError(message), usedFallback: false };
  }

  return { data: (data as T) ?? null, error: null, usedFallback: false };
}

export function isAiUnavailableError(msg: string | null): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
    m.includes("learning service unavailable") ||
    m.includes("gemini ai service unavailable") ||
    m.includes("google_gemini") ||
    m.includes("gemini api") ||
    m.includes("not configured") ||
    m.includes("credits") ||
    m.includes("rate limit") ||
    m.includes("unavailable") ||
    m.includes("failed to send") ||
    m.includes("502") ||
    m.includes("402") ||
    m.includes("429")
  );
}
