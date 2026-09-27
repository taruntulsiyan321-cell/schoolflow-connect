/**
 * Knowledge Management Service v0 — client helpers + types.
 * Lifecycle control plane; embeddings deferred (stub metadata only).
 */


type KmsDocumentStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "published"
  | "rejected"
  | "retired";


type KmsChunkEmbedStatus = "pending_embed" | "embedded" | "deferred" | "failed";




/** Pedagogical chunking stub — splits on blank lines; never invents content. */
export function chunkPedagogicalText(raw: string, maxChunks = 40): string[] {
  const parts = raw
    .split(/\n\s*\n/g)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return raw.trim() ? [raw.trim()] : [];
  return parts.slice(0, maxChunks);
}

export function buildEmbeddingStub(): { status: "deferred"; dims: 0 } {
  return { status: "deferred", dims: 0 };
}

/** True when OPENAI/OpenRouter embedding env is present (edge/worker). */
export function isEmbeddingProviderConfigured(env: Record<string, string | undefined> = {}): boolean {
  const openrouter = (env.OPENROUTER_API_KEY ?? "").trim();
  const aiEmb = (env.AI_EMBEDDING_API_KEY ?? "").trim();
  const openai = (env.OPENAI_API_KEY ?? "").trim();
  const emb = (env.EMBEDDING_API_KEY ?? "").trim();
  return openrouter.length > 0 || aiEmb.length > 0 || openai.length > 0 || emb.length > 0;
}

/**
 * Embedding job stub — enqueue pending_embed; if provider unset, defer safely.
 * No external HTTP call is made here.
 */
export function planEmbeddingJobAction(providerConfigured: boolean): {
  action: "embed" | "defer";
  embed_status: KmsChunkEmbedStatus;
  reason: string;
} {
  if (!providerConfigured) {
    return {
      action: "defer",
      embed_status: "deferred",
      reason: "embedding_provider_unset",
    };
  }
  return {
    action: "embed",
    embed_status: "pending_embed",
    reason: "provider_configured",
  };
}

export function isPublishedForRetrieval(status: KmsDocumentStatus, published: boolean): boolean {
  return status === "published" && published;
}








