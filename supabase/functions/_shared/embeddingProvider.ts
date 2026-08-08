/**
 * Embedding provider hook — OpenRouter / OpenAI-compatible embeddings.
 * Pure planning + response parsing for tests; live HTTP lives on the edge.
 * Keys: OPENROUTER_API_KEY | AI_EMBEDDING_API_KEY | EMBEDDING_API_KEY | OPENAI_API_KEY
 */

export type EmbeddingProviderId = "openrouter" | "openai_compat" | "unset";

export type EmbeddingJobClaim = {
  job_id: string;
  chunk_id: string;
  school_id: string;
  document_id?: string;
  version_id?: string;
  chunk_text: string;
};

export type EmbeddingVectorResult =
  | {
      ok: true;
      embedding: number[];
      model: string;
      dims: number;
      provider: EmbeddingProviderId;
    }
  | {
      ok: false;
      error: string;
      deferred: boolean;
      provider: EmbeddingProviderId;
    };

export type ProcessOnePlan =
  | { action: "defer"; reason: string; provider: "unset" }
  | {
      action: "embed";
      provider: Exclude<EmbeddingProviderId, "unset">;
      model: string;
      endpoint: string;
      input_text: string;
      job: EmbeddingJobClaim;
    };

const DEFAULT_OPENROUTER_EMBED_MODEL = "openai/text-embedding-3-small";
const DEFAULT_OPENAI_EMBED_MODEL = "text-embedding-3-small";
const OPENROUTER_EMBED_URL = "https://openrouter.ai/api/v1/embeddings";
const OPENAI_EMBED_URL = "https://api.openai.com/v1/embeddings";

export function resolveEmbeddingApiKey(
  env: Record<string, string | undefined> = {},
): { key: string; provider: Exclude<EmbeddingProviderId, "unset"> } | null {
  const openrouter = (env.OPENROUTER_API_KEY ?? "").trim();
  const aiEmb = (env.AI_EMBEDDING_API_KEY ?? "").trim();
  const emb = (env.EMBEDDING_API_KEY ?? "").trim();
  const openai = (env.OPENAI_API_KEY ?? "").trim();

  if (openrouter) return { key: openrouter, provider: "openrouter" };
  if (aiEmb) return { key: aiEmb, provider: "openai_compat" };
  if (emb) return { key: emb, provider: "openai_compat" };
  if (openai) return { key: openai, provider: "openai_compat" };
  return null;
}

export function isEmbeddingProviderConfigured(
  env: Record<string, string | undefined> = {},
): boolean {
  return resolveEmbeddingApiKey(env) != null;
}

export function resolveEmbeddingEndpoint(
  provider: Exclude<EmbeddingProviderId, "unset">,
  env: Record<string, string | undefined> = {},
): { endpoint: string; model: string } {
  if (provider === "openrouter") {
    return {
      endpoint: (env.AI_EMBEDDING_ENDPOINT ?? "").trim() || OPENROUTER_EMBED_URL,
      model:
        (env.AI_EMBEDDING_MODEL ?? "").trim() ||
        (env.OPENROUTER_EMBEDDING_MODEL ?? "").trim() ||
        DEFAULT_OPENROUTER_EMBED_MODEL,
    };
  }
  return {
    endpoint: (env.AI_EMBEDDING_ENDPOINT ?? "").trim() || OPENAI_EMBED_URL,
    model: (env.AI_EMBEDDING_MODEL ?? "").trim() || DEFAULT_OPENAI_EMBED_MODEL,
  };
}

/** Plan a single job — never invents vectors when provider unset. */
export function planProcessOneEmbeddingJob(
  job: EmbeddingJobClaim,
  env: Record<string, string | undefined> = {},
): ProcessOnePlan {
  const resolved = resolveEmbeddingApiKey(env);
  if (!resolved) {
    return { action: "defer", reason: "embedding_provider_unset", provider: "unset" };
  }
  const { endpoint, model } = resolveEmbeddingEndpoint(resolved.provider, env);
  const text = (job.chunk_text ?? "").trim();
  if (!text) {
    return { action: "defer", reason: "empty_chunk_text", provider: "unset" };
  }
  return {
    action: "embed",
    provider: resolved.provider,
    model,
    endpoint,
    input_text: text.slice(0, 8000),
    job,
  };
}

/** Parse OpenAI-compatible embeddings JSON (no network). */
export function parseEmbeddingApiResponse(
  json: unknown,
  provider: Exclude<EmbeddingProviderId, "unset">,
  fallbackModel: string,
): EmbeddingVectorResult {
  const obj = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const data = Array.isArray(obj.data) ? obj.data : [];
  const first = (data[0] && typeof data[0] === "object" ? data[0] : null) as Record<
    string,
    unknown
  > | null;
  const emb = first && Array.isArray(first.embedding) ? (first.embedding as unknown[]) : null;
  if (!emb || !emb.length) {
    return {
      ok: false,
      error: "empty_embedding_response",
      deferred: false,
      provider,
    };
  }
  const nums = emb.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  if (nums.length !== emb.length) {
    return {
      ok: false,
      error: "non_numeric_embedding",
      deferred: false,
      provider,
    };
  }
  const model =
    typeof obj.model === "string" && obj.model.trim() ? obj.model.trim() : fallbackModel;
  return {
    ok: true,
    embedding: nums,
    model,
    dims: nums.length,
    provider,
  };
}

export function buildEmbeddingRequestBody(input: {
  model: string;
  text: string;
}): { model: string; input: string } {
  return { model: input.model, input: input.text };
}

/**
 * Embed a single free-text query (retrieval-side companion to
 * processOneEmbeddingJob, which embeds chunk text on write). Reuses the same
 * key resolution / endpoint / parsing so query and chunk vectors always come
 * from the same provider+model. Never throws — any failure (unset provider,
 * network error, bad response) degrades to `ok:false` so callers can fall
 * through to lexical retrieval exactly as when no embedding is supplied.
 */
export async function embedQueryText(
  text: string,
  opts: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {},
): Promise<{ ok: true; embedding: number[]; model: string; provider: EmbeddingProviderId } | { ok: false; error: string }> {
  const env = opts.env ?? {};
  const trimmed = (text ?? "").trim();
  if (!trimmed) return { ok: false, error: "empty_query_text" };

  const resolved = resolveEmbeddingApiKey(env);
  if (!resolved) return { ok: false, error: "embedding_provider_unset" };

  const { endpoint, model } = resolveEmbeddingEndpoint(resolved.provider, env);
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) return { ok: false, error: "fetch_unavailable" };

  try {
    const res = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolved.key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.OPENROUTER_SITE_URL ?? "https://gurukul.app",
        "X-Title": "Gurukul Query Embedding",
      },
      body: JSON.stringify(buildEmbeddingRequestBody({ model, text: trimmed.slice(0, 8000) })),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `embedding_http_${res.status}:${body.slice(0, 160)}` };
    }
    const json = await res.json();
    const parsed = parseEmbeddingApiResponse(json, resolved.provider, model);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return { ok: true, embedding: parsed.embedding, model: parsed.model, provider: resolved.provider };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "embedding_fetch_failed" };
  }
}

/**
 * Process one claimed job using a fetch-like injector (edge/tests).
 * When provider unset → deferred result (no fake vector).
 */
export async function processOneEmbeddingJob(
  job: EmbeddingJobClaim,
  opts: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<EmbeddingVectorResult & { job_id: string; chunk_id: string }> {
  const env = opts.env ?? {};
  const plan = planProcessOneEmbeddingJob(job, env);
  if (plan.action === "defer") {
    return {
      ok: false,
      error: plan.reason,
      deferred: true,
      provider: "unset",
      job_id: job.job_id,
      chunk_id: job.chunk_id,
    };
  }

  const resolved = resolveEmbeddingApiKey(env);
  if (!resolved) {
    return {
      ok: false,
      error: "embedding_provider_unset",
      deferred: true,
      provider: "unset",
      job_id: job.job_id,
      chunk_id: job.chunk_id,
    };
  }

  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    return {
      ok: false,
      error: "fetch_unavailable",
      deferred: true,
      provider: plan.provider,
      job_id: job.job_id,
      chunk_id: job.chunk_id,
    };
  }

  try {
    const res = await fetchImpl(plan.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resolved.key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": env.OPENROUTER_SITE_URL ?? "https://gurukul.app",
        "X-Title": "Gurukul Embedding Worker",
      },
      body: JSON.stringify(buildEmbeddingRequestBody({ model: plan.model, text: plan.input_text })),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        error: `embedding_http_${res.status}:${body.slice(0, 160)}`,
        deferred: false,
        provider: plan.provider,
        job_id: job.job_id,
        chunk_id: job.chunk_id,
      };
    }
    const json = await res.json();
    const parsed = parseEmbeddingApiResponse(json, plan.provider, plan.model);
    return { ...parsed, job_id: job.job_id, chunk_id: job.chunk_id };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "embedding_fetch_failed",
      deferred: false,
      provider: plan.provider,
      job_id: job.job_id,
      chunk_id: job.chunk_id,
    };
  }
}
