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

function isLikelyJwt(value: string): boolean {
  // MSG91 access tokens are JWTs. reqIds from sendOTP share the `message`
  // field in some SDK responses — those are short opaque ids, not JWTs.
  return value.startsWith("eyJ") && value.includes(".");
}

/**
 * MSG91's success payload is not consistent across widget/SDK versions.
 * Documented shapes:
 *   - completion: `message` holds the access-token (JWT)
 *   - invisible OTP / some SDKs: `access-token` is the JWT and `message` is
 *     the reqId — preferring `message` first sent the reqId to
 *     verifyAccessToken and every live attempt failed as invalid_or_expired.
 * Prefer explicit access-token fields, then any JWT-shaped candidate, then
 * a bare `message`/`token` string as last resort.
 */
export function extractAccessToken(data: Msg91WidgetSuccessData | null | undefined): string | null {
  return extractAccessTokenMeta(data)?.token ?? null;
}

/** Keys we inspect for an MSG91 access-token, in preference order. */
const ACCESS_TOKEN_KEYS = ["access-token", "accessToken", "token", "message"] as const;

export type Msg91AccessTokenMeta = {
  token: string;
  /** Payload keys that held a non-empty string (fingerprint only — no values). */
  keys: string[];
  jwt_shaped: boolean;
  length: number;
};

/**
 * Same token selection as extractAccessToken, plus a safe fingerprint for
 * server-side diagnostics (keys present / JWT shape / length — never the
 * token value itself beyond what verify already receives as access_token).
 */
export function extractAccessTokenMeta(
  data: Msg91WidgetSuccessData | null | undefined,
): Msg91AccessTokenMeta | null {
  if (!data) return null;
  const presentKeys = ACCESS_TOKEN_KEYS.filter((k) => {
    const v = data[k];
    return typeof v === "string" && Boolean(v.trim());
  });
  if (presentKeys.length === 0) return null;

  const ordered = [data["access-token"], data.accessToken, data.token, data.message];
  const strings = ordered
    .filter((c): c is string => typeof c === "string" && Boolean(c.trim()))
    .map((c) => c.trim());
  const jwt = strings.find(isLikelyJwt);
  let token: string | null = jwt ?? null;
  if (!token) {
    // Prefer the first non-message candidate when nothing looks like a JWT —
    // still better than grabbing a reqId from `message` when another field exists.
    const nonMessage = [data["access-token"], data.accessToken, data.token]
      .filter((c): c is string => typeof c === "string" && Boolean(c.trim()))
      .map((c) => c.trim());
    token = nonMessage[0] ?? strings[0] ?? null;
  }
  if (!token) return null;
  return {
    token,
    keys: presentKeys,
    jwt_shaped: isLikelyJwt(token),
    length: token.length,
  };
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
 * Snapshot of document.body's direct children taken right before the widget
 * opens, so closeMsg91Widget() can remove exactly what MSG91's script added
 * (its <msg91-otp-provider> host, country-picker helper elements, etc.)
 * without touching anything else portaled onto body by the rest of the app
 * (toasts, tooltips) that happened to exist first.
 */
let bodyChildrenBeforeOpen: Set<Element> | null = null;

/**
 * Opens MSG91's hosted OTP widget (phone entry + OTP entry UI owned entirely
 * by MSG91). onSuccess receives only the access-token — never a phone
 * number, since the frontend must never be trusted to report one (that's
 * confirmed server-side via verifyAccessToken).
 */
export async function openMsg91Widget(handlers: {
  onSuccess: (accessToken: string, tokenMeta?: Pick<Msg91AccessTokenMeta, "keys" | "jwt_shaped" | "length">) => void;
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

  bodyChildrenBeforeOpen = new Set(Array.from(document.body.children));

  window.initSendOTP({
    widgetId,
    tokenAuth,
    exposeMethods: false,
    success: (data: Msg91WidgetSuccessData) => {
      const meta = extractAccessTokenMeta(data);
      if (!meta) {
        handlers.onFailure(new Error("MSG91 did not return a usable verification token."));
        return;
      }
      handlers.onSuccess(meta.token, {
        keys: meta.keys,
        jwt_shaped: meta.jwt_shaped,
        length: meta.length,
      });
    },
    failure: (error: unknown) => {
      handlers.onFailure(error);
    },
  });
}

/**
 * Closes MSG91's widget overlay without a page reload.
 *
 * MSG91's SDK has no documented public "close" method, so this fires every
 * mechanism confirmed (via live testing against the real widget) to make it
 * release the page-wide click-interceptor it installs while open:
 *  1. its own internal close button, reached through the shadow DOM it
 *     renders into <msg91-otp-provider> — an MSG91 implementation detail
 *     that could change in a future SDK version, so it's best-effort only;
 *  2. a synthetic Escape keypress, which MSG91's own script listens for
 *     globally regardless of DOM target — confirmed live to work on its own,
 *     independent of (1), and not tied to any private class name.
 *
 * Closing is not synchronous on MSG91's side. It exposes no event to await,
 * and a hit-test-based poll turned out to be unreliable in practice: it
 * false-positived by checking a point that was never actually blocked (e.g.
 * the Cancel button's own position, right below the widget's action button),
 * while the interceptor was still live elsewhere on the page (e.g. the tab
 * switcher above it) — the blocked region isn't the same as any one fixed
 * element we control, so there's no single coordinate that reliably proves
 * release. A fixed delay, confirmed generous enough in every observed run,
 * is the reliable option here.
 *
 * Once that delay elapses this sweeps every DOM node MSG91 added since
 * openMsg91Widget() was called (diffed against the pre-open snapshot) so
 * repeated open/cancel cycles never accumulate orphaned nodes.
 */
export async function closeMsg91Widget(): Promise<void> {
  try {
    const host = document.querySelector("msg91-otp-provider");
    const closeBtn = host?.shadowRoot?.querySelector<HTMLElement>("button.close-dialog");
    closeBtn?.click();
  } catch {
    // best-effort only — shadow DOM structure is an MSG91 implementation detail
  }

  const escOpts: KeyboardEventInit = {
    key: "Escape",
    code: "Escape",
    keyCode: 27,
    which: 27,
    bubbles: true,
    cancelable: true,
  };
  document.dispatchEvent(new KeyboardEvent("keydown", escOpts));
  document.dispatchEvent(new KeyboardEvent("keyup", escOpts));

  await new Promise((resolve) => setTimeout(resolve, 1200));

  document.querySelectorAll("msg91-otp-provider").forEach((n) => n.remove());
  if (bodyChildrenBeforeOpen) {
    const before = bodyChildrenBeforeOpen;
    Array.from(document.body.children).forEach((el) => {
      if (!before.has(el)) el.remove();
    });
  }
  bodyChildrenBeforeOpen = null;
}
