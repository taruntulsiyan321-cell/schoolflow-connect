/**
 * MSG91 OTP widget, headless: the sign-in page draws its own mobile-number and
 * OTP fields, and MSG91's script only sends and verifies the code.
 *
 * Started with `exposeMethods: true`, otp-provider.js renders nothing (its
 * popup template is `ngIf !exposeMethods`) and defines window.sendOtp,
 * window.verifyOtp, window.retryOtp and window.getWidgetData instead. Read
 * from the script itself, 2026-10-02.
 *
 * widgetId/tokenAuth are client-facing identifiers by MSG91's design; the
 * secret (MSG91_AUTH_KEY) never leaves the server. The page never reports a
 * phone number to our backend either: it hands on only the access-token
 * verifyOtp returns, and verify-msg91-widget confirms that with MSG91.
 *
 * ONE WIDGET PER PAGE LOAD. initSendOTP replaces the widget every time it is
 * called, but the window methods are defined once, non-configurable, bound to
 * the FIRST widget — a second initSendOTP leaves them calling a destroyed one.
 * So initSendOTP runs at most once, and only the wait for its settings retries.
 */

type Callback = (data: unknown) => void;

declare global {
  interface Window {
    initSendOTP?: (config: Record<string, unknown>) => void;
    sendOtp?: (identifier: string, success: Callback, failure: Callback) => void;
    verifyOtp?: (otp: string, success: Callback, failure: Callback, reqId?: string | null) => void;
    retryOtp?: (channel: string | null, success: Callback, failure: Callback, reqId?: string | null) => void;
    getWidgetData?: () => unknown;
  }
}

const WIDGET_SCRIPT_URL = "https://verify.msg91.com/otp-provider.js";
const SETTINGS_WAIT_MS = 15_000;

/** What the widget is configured with on MSG91's side. */
export type Msg91WidgetSettings = {
  /** Digits in a code. */
  otpLength: number;
  /** Seconds before a resend is allowed. */
  resendAfterSec: number;
  /** How many resends MSG91 allows per code. */
  resendsAllowed: number;
  /** The channel a resend goes out on; null when the widget offers no resend. */
  resendChannel: string | null;
};

export function isMsg91WidgetConfigured(): boolean {
  return Boolean(import.meta.env.VITE_MSG91_WIDGET_ID && import.meta.env.VITE_MSG91_TOKEN_AUTH);
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.initSendOTP) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = WIDGET_SCRIPT_URL;
      script.async = true;
      script.dataset.msg91Widget = "true";
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        reject(new Error("Could not load mobile sign-in."));
      };
      document.body.appendChild(script);
    }).catch((e) => {
      scriptPromise = null;
      throw e;
    });
  }
  return scriptPromise;
}

let initialised = false;

/** The widget's settings, read off getWidgetData() once MSG91 has sent them. */
export function settingsFrom(data: unknown): Msg91WidgetSettings | null {
  if (!data || typeof data !== "object") return null;
  const d = data as {
    otpLength?: unknown;
    retryTime?: unknown;
    retryCount?: unknown;
    processes?: { processVia?: { value?: unknown }; channel?: { value?: unknown } }[];
  };
  const otpLength = Number(d.otpLength);
  if (!Number.isInteger(otpLength) || otpLength < 4 || otpLength > 9) return null;
  // The widget's own resend list: processes delivered "via 5" are its retries.
  const retry = (Array.isArray(d.processes) ? d.processes : []).find(
    (p) => String(p?.processVia?.value) === "5" && p?.channel?.value != null,
  );
  const resendAfterSec = Number(d.retryTime);
  const resendsAllowed = Number(d.retryCount);
  return {
    otpLength,
    resendAfterSec: Number.isFinite(resendAfterSec) && resendAfterSec > 0 ? resendAfterSec : 25,
    resendsAllowed: Number.isInteger(resendsAllowed) && resendsAllowed >= 0 ? resendsAllowed : 2,
    resendChannel: retry ? String(retry.channel?.value) : null,
  };
}

let started: Promise<Msg91WidgetSettings> | null = null;

/**
 * Loads MSG91's script and starts the headless widget, once per page load.
 * Resolves with the widget's settings when it is ready to send a code.
 */
export function startMsg91(): Promise<Msg91WidgetSettings> {
  if (!started) {
    started = (async () => {
      const widgetId = import.meta.env.VITE_MSG91_WIDGET_ID as string | undefined;
      const tokenAuth = import.meta.env.VITE_MSG91_TOKEN_AUTH as string | undefined;
      if (!widgetId || !tokenAuth) throw new Error("Mobile sign-in isn't configured yet.");
      await loadScript();
      if (!window.initSendOTP) throw new Error("Could not load mobile sign-in.");
      if (!initialised) {
        initialised = true;
        // The method callbacks below carry every result; these two are
        // required by initSendOTP and have nothing left to do.
        window.initSendOTP({ widgetId, tokenAuth, exposeMethods: true, success: () => {}, failure: () => {} });
      }
      const deadline = Date.now() + SETTINGS_WAIT_MS;
      for (;;) {
        const settings = window.sendOtp && window.getWidgetData ? settingsFrom(window.getWidgetData()) : null;
        if (settings) return settings;
        if (Date.now() > deadline) throw new Error("Mobile sign-in did not start.");
        await new Promise((r) => setTimeout(r, 150));
      }
    })().catch((e) => {
      started = null;
      throw e;
    });
  }
  return started;
}

/**
 * Sending runs MSG91's invisible hCaptcha first, and when that expires, errors
 * or is closed the widget only logs it — the call never returns. So every call
 * has a limit: long enough to solve a challenge, short enough not to strand
 * the student on "Sending code…".
 */
const SEND_WAIT_MS = 90_000;
const VERIFY_WAIT_MS = 30_000;
export const NO_RESPONSE = "no_response";

function call(run: (ok: Callback, fail: Callback) => void, waitMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject({ message: NO_RESPONSE }), waitMs);
    run(
      (data) => { clearTimeout(timer); resolve(data); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

/** Texts a code to a 10-digit Indian mobile number. */
export async function sendMsg91Otp(mobile: string): Promise<void> {
  await startMsg91();
  await call((ok, fail) => window.sendOtp!(`91${mobile}`, ok, fail), SEND_WAIT_MS);
}

/** Sends the code again, on the widget's own resend channel. */
export async function resendMsg91Otp(channel: string | null): Promise<void> {
  await startMsg91();
  await call((ok, fail) => window.retryOtp!(channel, ok, fail), SEND_WAIT_MS);
}

/** Verifies the code the student typed; resolves with MSG91's access-token. */
export async function verifyMsg91Otp(code: string): Promise<Msg91AccessTokenMeta> {
  await startMsg91();
  const data = await call((ok, fail) => window.verifyOtp!(code, ok, fail), VERIFY_WAIT_MS);
  const meta = extractAccessTokenMeta(data as Record<string, unknown>);
  if (!meta) throw new Error("MSG91 did not return a usable verification token.");
  return meta;
}

type Msg91WidgetSuccessData = Record<string, unknown>;

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

type Msg91FailureReason = "no_response" | "wrong_code" | "too_many" | "expired" | "bad_number" | "unknown";

/**
 * What to tell the student when MSG91 refuses. Its errors carry a numeric
 * `code`: a wrong code is 705 "invalid otp" from the API (measured live
 * 2026-10-02) and 703 in otp-provider.js's own enum; 704 is the attempt
 * limit. Otherwise only a message, so the rest is read from the text, with an
 * honest generic fallback.
 */
export function classifyMsg91Failure(error: unknown): { reason: Msg91FailureReason; message: string } {
  const code = Number((error as { code?: unknown } | null)?.code);
  const text = (
    typeof error === "string"
      ? error
      : (error as { message?: string } | null)?.message ?? JSON.stringify(error ?? {})
  ).toLowerCase();

  if (text === NO_RESPONSE) {
    return { reason: "no_response", message: "We didn't hear back from the SMS service. Please try again." };
  }
  if (code === 704 || /limit|too many|maximum|exceeded/.test(text)) {
    return { reason: "too_many", message: "Too many attempts. Wait a few minutes, then send a new code." };
  }
  if (/expire/.test(text)) {
    return { reason: "expired", message: "That code has expired. Send a new one." };
  }
  // Before the wrong-code rule: "mobile number is incorrect" says "incorrect" too.
  if (code !== 703 && code !== 705 && /mobile|number|identifier/.test(text) && /invalid|not valid|incorrect/.test(text)) {
    return { reason: "bad_number", message: "Check your mobile number and try again." };
  }
  if (code === 703 || code === 705 || /invalid otp|otp not match|not match|incorrect|wrong/.test(text)) {
    return { reason: "wrong_code", message: "That code isn't right. Check the SMS and try again." };
  }
  return { reason: "unknown", message: "Something went wrong with the code. Please try again." };
}
