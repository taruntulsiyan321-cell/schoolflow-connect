// node scripts/verify-push-pipeline.mjs
//
// The push pipeline on live (20260925190000 + the notification-push edge function), end to end as
// far as it goes without a real phone:
//
//   1. notification-push is ACTIVE with the gateway's JWT check off, and refuses a caller without
//      the drain secret, and one with a wrong secret of the right length.
//   2. A probe device token (not a phone) is registered for one signed-in student, then a probe
//      notification is written for them. The insert trigger must queue it (pushed_at NULL).
//   3. Within the next cron minutes the dispatch must call notification-push through pg_net; the
//      function must claim the row (pushed_at set) and hand it to FCM. For a token that is not a
//      phone, FCM's answer is a rejection naming the TOKEN — which proves the OAuth exchange with the
//      project's service account worked and the message reached FCM. An auth failure says so instead.
//   4. Both probe rows are removed, whatever happened.
//
// What it cannot prove: that a real phone shows the notification. That needs the Android app
// installed, signed in and allowed notifications, so a row lands in device_tokens.
import { readFileSync } from "fs";

const env = readFileSync(".env.local", "utf8");
const token = env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
if (!token) throw new Error("no SUPABASE_ACCESS_TOKEN in .env.local");
const REF = "psqxykzqfvxgsvkmgurn";
const PROBE_TOKEN = "[verify-push-pipeline probe] not a phone";
const PROBE_TITLE = "[verify-push-pipeline probe]";
const api = (p, init = {}) =>
  fetch(`https://api.supabase.com/v1/projects/${REF}${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
const sql = async (query) => {
  const r = await api("/database/query", { method: "POST", body: JSON.stringify({ query }) });
  const text = await r.text();
  if (!r.ok) throw new Error(`SQL failed: ${text.slice(0, 400)}`);
  return JSON.parse(text);
};
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
let failures = 0;
const claim = (ok, what, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}${detail ? `  -- ${detail}` : ""}`);
  if (!ok) failures++;
};

// 1. Deployment and the door.
const fn = await (await api("/functions/notification-push")).json();
claim(fn?.status === "ACTIVE" && fn?.verify_jwt === false, "notification-push is ACTIVE with the gateway JWT check off",
  `status ${fn?.status}, verify_jwt ${fn?.verify_jwt}`);
const url = `https://${REF}.supabase.co/functions/v1/notification-push`;
const bare = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
const bareBody = await bare.text();
claim(bare.status === 401 && bareBody.includes("Unauthorized"), "a call without the drain secret is refused 401 by the function",
  `${bare.status} ${bareBody.slice(0, 80)}`);
const wrong = await fetch(url, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-push-drain": "0".repeat(64) },
  body: "{}",
});
claim(wrong.status === 401, "a call with a wrong secret of the right length is refused 401", String(wrong.status));

try {
  // 2. Queue.
  const [who] = await sql(`SELECT s.user_id, s.school_id FROM public.students s
    WHERE s.user_id IS NOT NULL AND s.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.device_tokens d WHERE d.user_id = s.user_id)
    ORDER BY s.created_at LIMIT 1`);
  if (!who) throw new Error("no signed-in student without a phone to probe with");
  const [before] = await sql("SELECT coalesce(max(id), 0) AS id FROM net._http_response");
  await sql(`INSERT INTO public.device_tokens (user_id, token, platform, school_id)
             VALUES ('${who.user_id}', '${PROBE_TOKEN}', 'android', '${who.school_id}')`);
  const [n] = await sql(`INSERT INTO public.notifications (user_id, school_id, type, title, body, link)
             VALUES ('${who.user_id}', '${who.school_id}', 'general', '${PROBE_TITLE}',
                     'Checking that a notification leaves for the phone.', '/student/homework')
             RETURNING id, pushed_at`);
  claim(n.pushed_at === null, "the notification for someone with a registered phone is queued on insert", `pushed_at ${n.pushed_at}`);

  // 3. The cron minute, pg_net, the function, FCM.
  let row = null;
  let responses = [];
  for (let i = 0; i < 20; i++) {
    await sleep(10000);
    [row] = await sql(`SELECT pushed_at FROM public.notifications WHERE id = '${n.id}'`);
    responses = await sql(`SELECT id, status_code, left(content, 600) AS content FROM net._http_response
                            WHERE id > ${Number(before.id)} ORDER BY id`);
    if (row?.pushed_at && responses.some((r) => (r.content ?? "").includes('"claimed"'))) break;
  }
  claim(Boolean(row?.pushed_at), "the notification was claimed (settled) within the cron minutes", `pushed_at ${row?.pushed_at}`);
  const answer = responses.find((r) => (r.content ?? "").includes('"claimed"'));
  claim(Boolean(answer) && answer.status_code === 200, "the dispatch called notification-push and it answered 200",
    answer ? `status ${answer.status_code}` : JSON.stringify(responses).slice(0, 300));
  if (answer) {
    const body = JSON.parse(answer.content);
    console.log(`      function answered: claimed ${body.claimed}, sent ${body.sent}, failed ${body.failed}, removedTokens ${body.removedTokens}`);
    const reasons = (body.failures ?? []).join(" | ");
    console.log(`      FCM said: ${reasons.replace(/\s+/g, " ").slice(0, 300)}`);
    const reachedFcm = /registration token|INVALID_ARGUMENT|UNREGISTERED|NOT_FOUND/i.test(reasons);
    const authFailed = /UNAUTHENTICATED|PERMISSION_DENIED|token exchange/i.test(reasons);
    claim(body.claimed >= 1 && reachedFcm && !authFailed,
      "the message reached FCM with the service account's credentials, and FCM rejected only the probe token");
  }
} catch (e) {
  claim(false, "the probe ran", e.message);
} finally {
  // 4. Remove both probe rows.
  await sql(`DELETE FROM public.notifications WHERE title = '${PROBE_TITLE}'`);
  await sql(`DELETE FROM public.device_tokens WHERE token = '${PROBE_TOKEN}'`);
  const [left] = await sql(`SELECT (SELECT count(*) FROM public.notifications WHERE title = '${PROBE_TITLE}') AS n,
                                   (SELECT count(*) FROM public.device_tokens WHERE token = '${PROBE_TOKEN}') AS t`);
  claim(Number(left.n) === 0 && Number(left.t) === 0, "both probe rows removed");
}
console.log(failures === 0 ? "\npush pipeline OK end to end, up to a real phone" : `\n${failures} check(s) failed`);
process.exit(failures ? 1 : 0);
