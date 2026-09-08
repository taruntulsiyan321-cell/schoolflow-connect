/**
 * Local OpenRouter connectivity ping (no Supabase deploy required).
 *
 * Usage:
 *   set OPENROUTER_API_KEY=sk-or-...   (PowerShell: $env:OPENROUTER_API_KEY="...")
 *   npm run ai:ping
 *
 * Optional: OPENROUTER_MODEL (default qwen/qwen3.7-flash)
 * Loads .env / .env.local if present (does not print secrets).
 */

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MODEL = "qwen/qwen3.7-flash";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

function loadEnvFile(name) {
  const path = resolve(ROOT, name);
  if (!existsSync(path)) return;
  const text = readFileSync(path, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env) || process.env[key] === "") {
      process.env[key] = val;
    }
  }
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const apiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
const model = (process.env.OPENROUTER_MODEL ?? "").trim() || DEFAULT_MODEL;

if (!apiKey) {
  console.error(
    [
      "FAIL: OPENROUTER_API_KEY is not set.",
      "Set it for local use:",
      "  PowerShell:  $env:OPENROUTER_API_KEY=\"sk-or-...\"",
      "  bash:        export OPENROUTER_API_KEY=sk-or-...",
      "Or add OPENROUTER_API_KEY=... to .env / .env.local (never commit the key).",
      "Supabase (production path):",
      "  npx supabase secrets set OPENROUTER_API_KEY=sk-or-... --project-ref <ref>",
    ].join("\n"),
  );
  process.exit(1);
}

const res = await fetch(OPENROUTER_URL, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "https://gurukul.app",
    "X-Title": "Gurukul AI Ping",
  },
  body: JSON.stringify({
    model,
    temperature: 0,
    // `reasoning: { enabled: false }` AND a budget that is not 16.
    //
    // This probe used to send `max_tokens: 16` with no reasoning field, and
    // AGAINST THE CONFIGURED MODEL IT COULD NOT PASS. Qwen 3.7 Flash is a
    // reasoning model: left enabled it spends its whole budget on the internal
    // trace before writing anything to `content`, so the reply came back
    // `content: null`, `finish_reason: "length"`, and this script printed
    // "FAIL: empty model response" — which reads as "the provider is down".
    //
    // Measured 2026-09-08, same key, same model, same prompt:
    //   max_tokens 20, no reasoning field ..... content null   (reasoning trace only)
    //   max_tokens 2000, enabled:false ........ content "pong", 1 completion token
    //
    // A connectivity probe that cannot succeed while the path is healthy is
    // worse than no probe: it sends the next reader looking for an outage that
    // is not there. It cost an hour on 2026-09-08 doing exactly that.
    //
    // These two settings are not a preference — they are what
    // `supabase/functions/_shared/modelRouter.ts` sends on every real call, so
    // this probe now exercises the path the app actually uses.
    reasoning: { enabled: false },
    max_tokens: 64,
    messages: [
      {
        role: "system",
        content: "You are a connectivity probe. Obey the user literally.",
      },
      { role: "user", content: "Reply with exactly: pong" },
    ],
  }),
});

const bodyText = await res.text();
let json;
try {
  json = JSON.parse(bodyText);
} catch {
  json = null;
}

if (!res.ok) {
  // An upstream rate limit is not a broken path, and reporting it as one sends
  // the reader to the wrong place. Observed 2026-09-08: "qwen/qwen3.7-flash is
  // temporarily rate-limited upstream" from Alibaba, HTTP 429, which cleared on
  // its own minutes later. Named separately, and given its own exit code so a
  // caller can retry rather than investigate.
  if (res.status === 429) {
    console.error(
      `RATE-LIMITED: the provider is up and refusing traffic right now, model=${model}
` +
        `  This is not a broken AI path — retry shortly.
` +
        `  ${bodyText.slice(0, 300)}`,
    );
    process.exit(2);
  }
  console.error(
    `FAIL: OpenRouter HTTP ${res.status} model=${model} body=${bodyText.slice(0, 300)}`,
  );
  process.exit(1);
}

const message = json?.choices?.[0]?.message;
const text = message?.content;
if (typeof text !== "string" || !text.trim()) {
  // Say WHY it is empty. "empty model response" was the whole diagnosis before,
  // and the two causes need opposite responses: a reasoning trace that ate the
  // budget is a REQUEST problem (this script's, or the caller's), while a truly
  // empty answer is the provider's.
  const reasoningLen = String(message?.reasoning ?? "").length;
  const finish = json?.choices?.[0]?.finish_reason ?? "unknown";
  console.error(
    `FAIL: empty model response model=${model} finish_reason=${finish}` +
      (reasoningLen > 0
        ? `
  The model wrote ${reasoningLen} chars of REASONING and no content, so the token` +
          `
  budget went on the trace. That is a request problem, not an outage:` +
          `
  send reasoning:{enabled:false} (which this script does) and a larger max_tokens.`
        : `
  No reasoning trace either — the provider genuinely returned nothing.`),
  );
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      text: text.trim(),
      model_id: model,
      usage: json?.usage ?? null,
    },
    null,
    2,
  ),
);
