// node scripts/sync-push-drain-secret.mjs
//
// Copies the vault secret `notification_push_drain` — generated inside the database by
// 20260925190000_a_notification_reaches_the_phone — into the `notification-push` edge function's
// NOTIFICATION_PUSH_DRAIN secret, so the function accepts the database's once-a-minute calls.
//
// RUN IT after 20260925190000 is applied, and again after any rollback and re-apply of it (the
// re-apply generates a new secret; until this runs, every dispatch is refused 401 and nothing
// reaches a phone). `node scripts/verify-push-pipeline.mjs` shows whether it holds.
//
// The value passes from one Management API response to one request. It is never printed, logged
// or written to disk.
import { readFileSync } from "fs";

const env = readFileSync(".env.local", "utf8");
const token = env.match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
if (!token) throw new Error("no SUPABASE_ACCESS_TOKEN in .env.local");
const REF = "psqxykzqfvxgsvkmgurn";
const api = (p, init = {}) =>
  fetch(`https://api.supabase.com/v1/projects/${REF}${p}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });

const q = await api("/database/query", {
  method: "POST",
  body: JSON.stringify({ query: "SELECT decrypted_secret AS v FROM vault.decrypted_secrets WHERE name = 'notification_push_drain'" }),
});
if (!q.ok) throw new Error(`reading the vault secret failed: HTTP ${q.status}`);
const rows = await q.json();
const value = Array.isArray(rows) ? rows[0]?.v : undefined;
if (typeof value !== "string" || value.length < 48) {
  throw new Error("the vault secret notification_push_drain is missing — apply 20260925190000 first");
}

const s = await api("/secrets", { method: "POST", body: JSON.stringify([{ name: "NOTIFICATION_PUSH_DRAIN", value }]) });
if (!s.ok) throw new Error(`setting NOTIFICATION_PUSH_DRAIN failed: HTTP ${s.status}`);
const names = (await (await api("/secrets")).json()).map((x) => x.name);
if (!names.includes("NOTIFICATION_PUSH_DRAIN")) throw new Error("NOTIFICATION_PUSH_DRAIN is not listed after setting it");
console.log(`NOTIFICATION_PUSH_DRAIN set from the vault (${value.length} characters; value not printed)`);
