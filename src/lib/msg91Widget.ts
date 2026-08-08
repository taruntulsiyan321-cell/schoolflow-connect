/**
 * MSG91 OTP Widget — client-side loader + typed wrapper around
 * window.initSendOTP.
 *
 * widgetId/tokenAuth are client-facing identifiers by MSG91's own design
 * (the actual secret, MSG91_AUTH_KEY, never leaves the server — see
 * supabase/functions/verify-msg91-widget/index.ts). This module only ever
 * hands the resulting access-token to our own backend; it never reads or
 * trusts a phone number itself, since MSG91's widget UI owns collecting and
 * verifying that entirely — we only see the token afterward.
 */

declare global {
  interface Window {
    initSendOTP?: (config: Record<string, unknown>) => void;
  }
}

const WIDGET_SCRIPT_URL = "https://verify.msg91.com/otp-provider.js";

let scriptPromise: Promise<void> | null = null;

export function loadMsg91WidgetScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MSG91 widget requires a browser environment"));
  }
  if (window.initSendOTP) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-msg91-widget]");
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () => reject(new Error("Failed to load MSG91 widget script")));
      return;
    }
    const script = document.createElement("script");
    script.src = WIDGET_SCRIPT_URL;
    script.async = true;
    script.dataset.msg91Widget = "true";
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error("Failed to load MSG91 widget script"));
    };
    document.body.appendChild(script);
  });
  return scriptPromise;
}

export type Msg91WidgetSuccessData = Record<string, unknown>;

/**
 * MSG91's own documentation does not consistently pin one field name for
 * the access token across widget/SDK versions (variously referenced as
 * `message`, `access-token`, or `token` in different docs/examples) — check
 * every documented candidate rather than assume a single one silently.
 */
export function extractAccessToken(data: Msg91WidgetSuccessData | null | undefined): string | null {
  if (!data) return null;
  const candidates = [data.message, data["access-token"], data.token, data.accessToken];
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return null;
}

export type Msg91FailureReason = "cancelled" | "timeout" | "unknown";

/**
 * MSG91's failure callback error shape is likewise not fully documented for
 * every case, so this is best-effort classification from whatever text is
 * available — falls back to a generic, still-honest message rather than
 * guessing a specific reason it can't actually confirm.
 */
export function classifyMsg91Failure(error: unknown): { reason: Msg91FailureReason; message: string } {
  const text = (
    typeof error === "string"
      ? error
      : (error as { message?: string } | null)?.message ?? JSON.stringify(error ?? {})
  ).toLowerCase();

  if (text.includes("cancel") || text.includes("closed") || text.includes("dismiss")) {
    return { reason: "cancelled", message: "Mobile verification was cancelled." };
  }
  if (text.includes("timeout") || text.includes("expired") || text.includes("time out")) {
    return { reason: "timeout", message: "Mobile verification timed out. Please try again." };
  }
  return { reason: "unknown", message: "Mobile verification could not be completed. Please try again." };
}

export function isMsg91WidgetConfigured(): boolean {
  return Boolean(import.meta.env.VITE_MSG91_WIDGET_ID && import.meta.env.VITE_MSG91_TOKEN_AUTH);
}

/**
 * Opens MSG91's hosted OTP widget (phone entry + OTP entry UI owned entirely
 * by MSG91). onSuccess receives only the access-token — never a phone
 * number, since the frontend must never be trusted to report one (that's
 * confirmed server-side via verifyAccessToken).
 */
export async function openMsg91Widget(handlers: {
  onSuccess: (accessToken: string) => void;
  onFailure: (error: unknown) => void;
}): Promise<void> {
  const widgetId = import.meta.env.VITE_MSG91_WIDGET_ID as string | undefined;
  const tokenAuth = import.meta.env.VITE_MSG91_TOKEN_AUTH as string | undefined;
  if (!widgetId || !tokenAuth) {
    handlers.onFailure(new Error("Mobile sign-in is not configured yet."));
    return;
  }

  try {
    await loadMsg91WidgetScript();
  } catch (e) {
    handlers.onFailure(e);
    return;
  }

  if (!window.initSendOTP) {
    handlers.onFailure(new Error("MSG91 widget failed to load."));
    return;
  }

  window.initSendOTP({
    widgetId,
    tokenAuth,
    exposeMethods: false,
    success: (data: Msg91WidgetSuccessData) => {
      const token = extractAccessToken(data);
      if (!token) {
        handlers.onFailure(new Error("MSG91 did not return a usable verification token."));
        return;
      }
      handlers.onSuccess(token);
    },
    failure: (error: unknown) => {
      handlers.onFailure(error);
    },
  });
}
