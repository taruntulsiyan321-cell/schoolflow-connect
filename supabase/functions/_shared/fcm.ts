/**
 * Firebase Cloud Messaging, HTTP v1 — the one place this project talks to FCM.
 *
 * `send-push` (direct messages, admin broadcasts) and `notification-push`
 * (every notification, to the recipient's phones) both send through here, so
 * the OAuth exchange and the reading of FCM's answer have one home.
 *
 * The service account is the FCM_SERVICE_ACCOUNT_JSON function secret.
 */

export interface FcmServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
}

const b64url = (bytes: Uint8Array | string) =>
  btoa(typeof bytes === "string" ? bytes : String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

/** A Google OAuth access token for FCM, from a JWT signed with the service account's key. */
export async function fcmAccessToken(sa: FcmServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify(claim))}`;

  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${b64url(sig)}`,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`FCM token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

export type FcmOutcome =
  | { status: "sent" }
  /** The token will never work again — the app was uninstalled, or the token expired. */
  | { status: "unregistered"; detail: string }
  | { status: "failed"; detail: string };

/** One message to one device token. */
export async function sendFcm(
  sa: FcmServiceAccount,
  accessToken: string,
  message: { token: string; title: string; body: string; data?: Record<string, string> },
): Promise<FcmOutcome> {
  const r = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token: message.token,
        notification: { title: message.title, body: message.body },
        ...(message.data ? { data: message.data } : {}),
        android: { priority: "high" },
      },
    }),
  });
  if (r.ok) return { status: "sent" };
  const text = await r.text();
  const detail = `${r.status} ${text.slice(0, 300)}`;
  return r.status === 404 || text.includes("UNREGISTERED") ? { status: "unregistered", detail } : { status: "failed", detail };
}
