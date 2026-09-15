// Sends waiting notifications to the phones of the people they are for.
//
// Called once a minute by the database (`dispatch_notification_push`, 20260925190000) through pg_net, whenever a
// notification is waiting for someone with a registered phone. The database has no user to sign a JWT for, so this
// function runs with verify_jwt off and refuses every call that does not carry the drain secret: the vault secret
// `notification_push_drain`, copied into this function's NOTIFICATION_PUSH_DRAIN secret at deploy.
//
// Each notification is claimed exactly once (`claim_notifications_for_push`, service_role only, SKIP LOCKED), sent to
// each of its recipient's device tokens with its link as data (tapping it opens that page in the app), and a token
// FCM says will never work again is removed.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fcmAccessToken, sendFcm, type FcmServiceAccount } from "../_shared/fcm.ts";

interface Claimed {
  notification_id: string;
  recipient: string;
  title: string;
  body: string | null;
  link: string | null;
  kind: string | null;
  tokens: string[];
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Same-length, every-character comparison: the secret is not leaked by how fast a wrong one is refused. */
function sameSecret(given: string | null, expected: string): boolean {
  if (given === null || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const CONCURRENCY = 10;

Deno.serve(async (req) => {
  const drain = Deno.env.get("NOTIFICATION_PUSH_DRAIN");
  if (!drain || !sameSecret(req.headers.get("x-push-drain"), drain)) return json({ error: "Unauthorized" }, 401);

  const saJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON");
  if (!saJson) return json({ error: "FCM_SERVICE_ACCOUNT_JSON secret not configured" }, 500);
  const sa = JSON.parse(saJson) as FcmServiceAccount;

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data, error } = await db.rpc("claim_notifications_for_push", { _limit: 500 });
  if (error) return json({ error: `claim failed: ${error.message}` }, 500);
  const claimed = (data ?? []) as Claimed[];
  if (claimed.length === 0) return json({ claimed: 0, sent: 0, failed: 0, removedTokens: 0 });

  const accessToken = await fcmAccessToken(sa);
  const jobs = claimed.flatMap((n) =>
    n.tokens.map((token) => ({
      token,
      title: n.title,
      body: n.body ?? "",
      data: { link: n.link ?? "", type: n.kind ?? "", notification_id: n.notification_id },
    })),
  );

  let sent = 0;
  const failures: string[] = [];
  const dead = new Set<string>();
  for (let i = 0; i < jobs.length; i += CONCURRENCY) {
    const outcomes = await Promise.all(jobs.slice(i, i + CONCURRENCY).map((job) => sendFcm(sa, accessToken, job)));
    outcomes.forEach((outcome, k) => {
      if (outcome.status === "sent") return void sent++;
      failures.push(outcome.detail);
      if (outcome.status === "unregistered") dead.add(jobs[i + k].token);
    });
  }

  if (dead.size > 0) {
    const { error: removeError } = await db.from("device_tokens").delete().in("token", [...dead]);
    if (removeError) failures.push(`removing dead tokens: ${removeError.message}`);
  }

  return json({
    claimed: claimed.length,
    sent,
    failed: failures.length,
    removedTokens: dead.size,
    // The first few reasons, so a failure is readable from net._http_response without a log search.
    failures: failures.slice(0, 5),
  });
});
