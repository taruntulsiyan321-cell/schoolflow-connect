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
    max_tokens: 16,
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
  console.error(
    `FAIL: OpenRouter HTTP ${res.status} model=${model} body=${bodyText.slice(0, 300)}`,
  );
  process.exit(1);
}

const text = json?.choices?.[0]?.message?.content;
if (typeof text !== "string" || !text.trim()) {
  console.error(`FAIL: empty model response model=${model}`);
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
