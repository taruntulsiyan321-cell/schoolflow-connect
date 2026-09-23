// Embed question_bank rows, so semantic search finds every stored question.
//
// WHY THIS EXISTS
// Every AI-written question enters the bank through store_generated_questions
// with embed_status 'pending_embed'. Nothing embedded bank rows after the
// original seed: measured 2026-09-15, every variant recovery had generated was
// still pending, so match_question_bank (which reads only 'embedded' rows)
// could never find them and the next student's lookup paid the model again for
// a question the bank already held.
//
// ONE DOCUMENTED BASIS FOR EVERY VECTOR
// The seed's vectors came from a text nobody recorded. Measured with this
// function's probe mode against three seed questions, the closest candidate —
// the question text alone — scored 0.78, 0.94 and 0.86 against the stored
// vector; a reproduction scores ~1.0. The seed text was something else, very
// likely including the per-question labels that no longer exist. So a new
// vector cannot be put in the old space, and mixing spaces makes similarity
// rank old and new rows unequally.
//
// The fix is one basis for all of them: EMBEDDING_BASIS below, recorded per row
// in question_bank.embedding_basis. The drain embeds pending rows first, then
// re-embeds rows whose basis is not the current one. A row being refreshed
// keeps its old vector (and stays searchable) until the new one is written.
//
// WHAT IT DOES
//   default      up to `limit` rows: pending first, then stale-basis rows.
//                Embedded in provider batches, written with the basis.
//   probe_ids    for already-embedded rows, report each candidate text's
//                cosine similarity to the STORED vector. Writes nothing.
//
// NEVER FAKES A VECTOR. A provider failure leaves the rows as they were for the
// next tick; only a row with no text is marked 'failed'.
//
// WHO MAY CALL IT
// The background-worker secret (VARIANT_GENERATION_DRAIN), presented by the
// pg_cron dispatcher over pg_net — the same door ai-recovery-variants uses: a
// service-role key in a SQL function body is a master credential in pg_proc.
// One secret for both workers is a deliberate trade: a leaked secret lets a
// caller embed rows that were going to be embedded anyway, and nothing else.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  embedQueryText,
  resolveEmbeddingApiKey,
  resolveEmbeddingEndpoint,
} from "../_shared/embeddingProvider.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-variant-drain",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type BankRow = {
  id: string;
  question: string | null;
  options: unknown;
  explanation: string | null;
  subject: string | null;
  chapter: string | null;
  embed_status: string;
};

/** What a vector in question_bank means. Change it and every row re-embeds. */
const EMBEDDING_TEXT = "question";
/** Texts per provider request. The provider accepts arrays; one call per chunk. */
const PROVIDER_CHUNK = 100;

function optionLines(options: unknown): string[] {
  return Array.isArray(options) ? options.map((o) => String(o ?? "").trim()).filter(Boolean) : [];
}

/** The probe's candidates. `question` is EMBEDDING_TEXT: the one the drain writes. */
function candidates(r: BankRow): Record<string, string> {
  const q = String(r.question ?? "").trim();
  const opts = optionLines(r.options);
  return {
    question: q,
    "question+options": [q, ...opts].join("\n"),
    "subject|chapter|question": `${r.subject ?? ""} | ${r.chapter ?? ""} | ${q}`,
    "question+options+explanation": [q, ...opts, String(r.explanation ?? "")].join("\n"),
  };
}

function cosine(a: number[], b: number[]): number {
  let dot = 0, x = 0, y = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; x += a[i] * a[i]; y += b[i] * b[i]; }
  return dot / Math.sqrt(x * y);
}

/** Embed many texts in one provider request. Returns vectors in input order. */
async function embedMany(
  texts: string[],
  env: Record<string, string | undefined>,
): Promise<{ ok: true; vectors: number[][]; model: string } | { ok: false; error: string }> {
  const resolved = resolveEmbeddingApiKey(env);
  if (!resolved) return { ok: false, error: "embedding_provider_unset" };
  const { endpoint, model } = resolveEmbeddingEndpoint(resolved.provider, env);
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resolved.key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": env.OPENROUTER_SITE_URL ?? "https://gurukul.app",
      "X-Title": "Gurukul Question Embedding",
    },
    body: JSON.stringify({ model, input: texts.map((t) => t.slice(0, 8000)) }),
  }).catch((e) => e as Error);
  if (res instanceof Error) return { ok: false, error: res.message };
  if (!res.ok) return { ok: false, error: `embedding_http_${res.status}:${(await res.text().catch(() => "")).slice(0, 160)}` };
  const json = await res.json().catch(() => null) as { data?: { index?: number; embedding?: unknown[] }[]; model?: string } | null;
  const data = Array.isArray(json?.data) ? json!.data : [];
  if (data.length !== texts.length) return { ok: false, error: `expected ${texts.length} vectors, got ${data.length}` };
  const vectors: number[][] = new Array(texts.length);
  for (const d of data) {
    const i = typeof d.index === "number" ? d.index : -1;
    const emb = Array.isArray(d.embedding) ? d.embedding.map(Number) : [];
    if (i < 0 || i >= texts.length || emb.length === 0 || emb.some((n) => !Number.isFinite(n))) {
      return { ok: false, error: "malformed_embedding_in_batch" };
    }
    vectors[i] = emb;
  }
  if (vectors.some((v) => !v)) return { ok: false, error: "missing_index_in_batch" };
  return { ok: true, vectors, model: json?.model?.trim() || model };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const drain = Deno.env.get("VARIANT_GENERATION_DRAIN") ?? "";
  const presented = (req.headers.get("x-variant-drain") ?? "").trim();
  if (!drain) {
    return jsonResponse({ error: "VARIANT_GENERATION_DRAIN is not configured; refusing rather than running unauthenticated." }, 503);
  }
  if (presented.length !== drain.length || presented !== drain) {
    return jsonResponse({ error: "This is a background job endpoint." }, 403);
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey) return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured." }, 503);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const env = Deno.env.toObject();
  const body = await req.json().catch(() => ({}));

  const resolved = resolveEmbeddingApiKey(env);
  if (!resolved) return jsonResponse({ error: "embedding_provider_unset", retryable: true }, 503);
  const { model } = resolveEmbeddingEndpoint(resolved.provider, env);
  // The basis names the model AND the text, so changing either re-embeds.
  const basis = `${model}:${EMBEDDING_TEXT}`;

  // ── Probe ──────────────────────────────────────────────────────────────
  if (Array.isArray(body.probe_ids) && body.probe_ids.length > 0) {
    const ids = body.probe_ids.slice(0, 5).map(String);
    const { data, error } = await admin
      .from("question_bank")
      .select("id, question, options, explanation, subject, chapter, embed_status, embedding")
      .in("id", ids)
      .eq("embed_status", "embedded");
    if (error) return jsonResponse({ error: error.message }, 500);
    const report = [];
    for (const row of (data ?? []) as (BankRow & { embedding: string | number[] })[]) {
      const stored = typeof row.embedding === "string" ? JSON.parse(row.embedding) as number[] : row.embedding;
      const scores: Record<string, number | string> = {};
      for (const [name, text] of Object.entries(candidates(row))) {
        const e = await embedQueryText(text, { env });
        scores[name] = e.ok ? Number(cosine(stored, e.embedding).toFixed(4)) : e.error;
      }
      report.push({ id: row.id, scores });
    }
    return jsonResponse({ probe: true, basis, report });
  }

  // ── Drain ──────────────────────────────────────────────────────────────
  if (!body.limit) return jsonResponse({ error: "limit is required (the dispatcher passes EMBEDDING_BATCH_SIZE)" }, 400);
  const limit = Math.max(1, Math.min(500, Number(body.limit) || 1));

  const cols = "id, question, options, explanation, subject, chapter, embed_status";
  const { data: pending, error: pErr } = await admin
    .from("question_bank").select(cols)
    .eq("embed_status", "pending_embed")
    .order("created_at", { ascending: true }).limit(limit);
  if (pErr) return jsonResponse({ error: pErr.message, retryable: true }, 500);
  let rows = (pending ?? []) as BankRow[];
  // Retry prior provider failures that still have text (migration also requeues failed→pending).
  if (rows.length < limit) {
    const { data: failedRows, error: fErr } = await admin
      .from("question_bank").select(cols)
      .eq("embed_status", "failed")
      .not("question", "is", null)
      .order("created_at", { ascending: true })
      .limit(limit - rows.length);
    if (fErr) return jsonResponse({ error: fErr.message, retryable: true }, 500);
    rows = rows.concat((failedRows ?? []) as BankRow[]);
  }
  if (rows.length < limit) {
    const { data: stale, error: sErr } = await admin
      .from("question_bank").select(cols)
      .eq("embed_status", "embedded")
      .or(`embedding_basis.is.null,embedding_basis.neq."${basis.replace(/"/g, "")}"`)
      .order("id", { ascending: true }).limit(limit - rows.length);
    if (sErr) return jsonResponse({ error: sErr.message, retryable: true }, 500);
    rows = rows.concat((stale ?? []) as BankRow[]);
  }

  let embedded = 0, refreshed = 0, cacheEmbedded = 0;
  const failed: { id: string; reason: string }[] = [];
  const work = rows.filter((r) => {
    if (String(r.question ?? "").trim()) return true;
    failed.push({ id: r.id, reason: "no text to embed" });
    return false;
  });
  for (const r of rows.filter((r) => !String(r.question ?? "").trim())) {
    await admin.from("question_bank").update({ embed_status: "failed" }).eq("id", r.id);
  }

  for (let i = 0; i < work.length; i += PROVIDER_CHUNK) {
    const chunk = work.slice(i, i + PROVIDER_CHUNK);
    const e = await embedMany(chunk.map((r) => candidates(r)[EMBEDDING_TEXT]), env);
    if (!e.ok) {
      // The provider, not the rows: stop, and let the next tick retry.
      return jsonResponse({ basis, embedded, refreshed, cacheEmbedded, failed, stopped: e.error, retryable: true }, 502);
    }
    for (let j = 0; j < chunk.length; j++) {
      const row = chunk[j];
      const { error: wErr } = await admin
        .from("question_bank")
        .update({ embedding: `[${e.vectors[j].join(",")}]`, embed_status: "embedded", embedding_basis: basis })
        .eq("id", row.id)
        .eq("embed_status", row.embed_status);
      if (wErr) { failed.push({ id: row.id, reason: wErr.message }); continue; }
      if (row.embed_status === "pending_embed" || row.embed_status === "failed") embedded++;
      else refreshed++;
    }
  }

  // Backfill ai_answer_cache rows that were saved without a vector (cannot hit semantic match).
  const cacheRoom = Math.max(0, Math.min(100, limit - work.length));
  if (cacheRoom > 0) {
    const { data: cacheRows, error: cErr } = await admin
      .from("ai_answer_cache")
      .select("id, original_question")
      .is("embedding", null)
      .neq("review_status", "rejected")
      .order("created_at", { ascending: true })
      .limit(cacheRoom);
    if (cErr) {
      console.error("ai_answer_cache null-embed select failed:", cErr.message);
    } else {
      const cacheWork = ((cacheRows ?? []) as { id: string; original_question: string | null }[])
        .filter((r) => String(r.original_question ?? "").trim());
      for (let i = 0; i < cacheWork.length; i += PROVIDER_CHUNK) {
        const chunk = cacheWork.slice(i, i + PROVIDER_CHUNK);
        const e = await embedMany(chunk.map((r) => String(r.original_question).trim()), env);
        if (!e.ok) {
          return jsonResponse({ basis, embedded, refreshed, cacheEmbedded, failed, stopped: e.error, retryable: true }, 502);
        }
        for (let j = 0; j < chunk.length; j++) {
          const { error: wErr } = await admin
            .from("ai_answer_cache")
            .update({ embedding: `[${e.vectors[j].join(",")}]` })
            .eq("id", chunk[j].id)
            .is("embedding", null);
          if (wErr) { failed.push({ id: chunk[j].id, reason: wErr.message }); continue; }
          cacheEmbedded++;
        }
      }
    }
  }

  return jsonResponse({ basis, claimed: rows.length, embedded, refreshed, cacheEmbedded, failed });
});
