import { supabase } from "@/integrations/supabase/client";
import type { FunctionsError } from "@supabase/supabase-js";

export type EdgeInvokeResult<T> = {
  data: T | null;
  error: string | null;
  usedFallback: boolean;
};

/** Invoke a Supabase edge function and normalize error bodies (500 JSON, network, credits). */
export async function invokeEdgeFunction<T extends Record<string, unknown>>(
  name: string,
  body: Record<string, unknown>,
): Promise<EdgeInvokeResult<T>> {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    return { data: null, error: String((data as { error: string }).error), usedFallback: false };
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
      message = "Gemini AI service unavailable. Please retry.";
    }

    return { data: null, error: message, usedFallback: false };
  }

  return { data: (data as T) ?? null, error: null, usedFallback: false };
}

export function isAiUnavailableError(msg: string | null): boolean {
  if (!msg) return false;
  const m = msg.toLowerCase();
  return (
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
