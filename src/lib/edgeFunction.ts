import { supabase } from "@/integrations/supabase/client";
import type { FunctionsError } from "@supabase/supabase-js";

export type EdgeInvokeResult<T> = {
  data: T | null;
  error: string | null;
  usedFallback: boolean;
};

/** Strip vendor names from messages shown in the app UI. Keep "AI" (billing copy). */
function sanitizeUserFacingError(message: string): string {
  return message
    .replace(/google[_\s-]?gemini[_\s-]?api[_\s-]?key/gi, "service configuration")
    .replace(/gemini\s*flash/gi, "learning service")
    .replace(/gemini/gi, "learning service")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function isGatewayEnvelope(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as { decision?: unknown }).decision === "string" &&
    typeof (value as { feature_id?: unknown }).feature_id === "string"
  );
}

function messageFromErrorBody(parsed: Record<string, unknown>): string | null {
  if (typeof parsed.message === "string" && parsed.message.trim()) return parsed.message;
  if (typeof parsed.error === "string" && parsed.error.trim()) return parsed.error;
  if (typeof parsed.error_code === "string" && parsed.error_code.trim()) {
    return parsed.error_code;
  }
  return null;
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

  // AI Gateway may return a full envelope as 2xx body even when decision is degraded.
  if (isGatewayEnvelope(data)) {
    return { data: data as T, error: null, usedFallback: false };
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
        // Preserve structured AiGatewayResponse on 400/403/503 (rejected / deny / kill).
        if (isGatewayEnvelope(parsed)) {
          return { data: parsed as T, error: null, usedFallback: false };
        }
        if (parsed && typeof parsed === "object") {
          const fromBody = messageFromErrorBody(parsed as Record<string, unknown>);
          if (fromBody) message = fromBody;
        }
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
