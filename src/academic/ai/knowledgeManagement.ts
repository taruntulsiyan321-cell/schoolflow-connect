/**
 * Knowledge Management Service v0 — client helpers + types.
 * Lifecycle control plane; embeddings deferred (stub metadata only).
 */

export type KmsContentType =
  | "curriculum"
  | "teacher_notes"
  | "school_policy"
  | "exemplar"
  | "resource";

export type KmsDocumentStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "published"
  | "rejected"
  | "retired";

export type KmsEmbeddingStatus =
  | "pending"
  | "stub"
  | "ready"
  | "failed"
  | "pending_embed"
  | "embedded"
  | "deferred";

export type KmsChunkEmbedStatus = "pending_embed" | "embedded" | "deferred" | "failed";

export type KmsChunkMetadata = {
  grade?: string | null;
  subject?: string | null;
  chapter?: string | null;
  board?: string | null;
  language?: string | null;
  content_type?: string | null;
  visibility_scope?: string[];
  [key: string]: unknown;
};

export type KmsRegisterInput = {
  school_id: string;
  title: string;
  content_type?: KmsContentType;
  visibility?: string[];
  metadata?: Record<string, unknown>;
};

export type KmsSubmitVersionInput = {
  document_id: string;
  raw_text: string;
  source_uri?: string | null;
  chunk_texts?: string[] | null;
};

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
  const openai = (env.OPENAI_API_KEY ?? "").trim();
  const emb = (env.EMBEDDING_API_KEY ?? "").trim();
  return openrouter.length > 0 || openai.length > 0 || emb.length > 0;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function registerKmsDocument(client: any, input: KmsRegisterInput) {
  const { data, error } = await client.rpc("ai_kms_register_document", {
    p_school_id: input.school_id,
    p_title: input.title,
    p_content_type: input.content_type ?? "teacher_notes",
    p_visibility: input.visibility ?? ["teacher"],
    p_metadata: input.metadata ?? {},
  });
  if (error) return { ok: false as const, error: String(error.message ?? error) };
  return { ok: true as const, data };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function submitKmsVersion(client: any, input: KmsSubmitVersionInput) {
  const chunks = input.chunk_texts ?? chunkPedagogicalText(input.raw_text);
  const { data, error } = await client.rpc("ai_kms_submit_version", {
    p_document_id: input.document_id,
    p_raw_text: input.raw_text,
    p_source_uri: input.source_uri ?? null,
    p_chunk_texts: chunks.length ? chunks : null,
  });
  if (error) return { ok: false as const, error: String(error.message ?? error) };
  return { ok: true as const, data };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function approveKmsVersion(
  client: any,
  documentId: string,
  version: number,
  publish = true,
) {
  const { data, error } = await client.rpc("ai_kms_approve_version", {
    p_document_id: documentId,
    p_version: version,
    p_publish: publish,
  });
  if (error) return { ok: false as const, error: String(error.message ?? error) };
  return { ok: true as const, data };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function rejectKmsVersion(
  client: any,
  documentId: string,
  version: number,
  reason?: string,
) {
  const { data, error } = await client.rpc("ai_kms_reject_version", {
    p_document_id: documentId,
    p_version: version,
    p_reason: reason ?? null,
  });
  if (error) return { ok: false as const, error: String(error.message ?? error) };
  return { ok: true as const, data };
}

/** Enqueue embedding jobs for published chunks (no provider call). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function enqueueKmsEmbeddingJobs(
  client: any,
  documentId: string,
  version?: number | null,
) {
  const { data, error } = await client.rpc("ai_kms_enqueue_embedding_jobs", {
    p_document_id: documentId,
    p_version: version ?? null,
  });
  if (error) return { ok: false as const, error: String(error.message ?? error) };
  return { ok: true as const, data };
}

/** Safe-degrade pending jobs when embedding provider is unset. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function deferUnsetEmbeddings(client: any, limit = 100) {
  const { data, error } = await client.rpc("ai_kms_defer_unset_embeddings", {
    p_limit: limit,
  });
  if (error) return { ok: false as const, error: String(error.message ?? error) };
  return { ok: true as const, data };
}

/** Complete or defer a single chunk embed (worker / service). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function completeKmsChunkEmbed(
  client: any,
  input: {
    chunk_id: string;
    embedding?: number[] | null;
    model_version?: string | null;
    failed?: boolean;
    error?: string | null;
  },
) {
  const { data, error } = await client.rpc("ai_kms_complete_chunk_embed", {
    p_chunk_id: input.chunk_id,
    p_embedding: input.embedding ?? null,
    p_model_version: input.model_version ?? null,
    p_failed: input.failed ?? false,
    p_error: input.error ?? null,
  });
  if (error) return { ok: false as const, error: String(error.message ?? error) };
  return { ok: true as const, data };
}
