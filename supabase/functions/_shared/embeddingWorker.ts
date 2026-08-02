/**
 * Edge embedding worker — claim batch via RPC, embed one-by-one, complete.
 * Cron / service invokes processEmbeddingJobsBatch.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  isEmbeddingProviderConfigured,
  processOneEmbeddingJob,
  type EmbeddingJobClaim,
} from "./embeddingProvider.ts";

function envMap(): Record<string, string | undefined> {
  return {
    OPENROUTER_API_KEY: Deno.env.get("OPENROUTER_API_KEY") ?? undefined,
    AI_EMBEDDING_API_KEY: Deno.env.get("AI_EMBEDDING_API_KEY") ?? undefined,
    EMBEDDING_API_KEY: Deno.env.get("EMBEDDING_API_KEY") ?? undefined,
    OPENAI_API_KEY: Deno.env.get("OPENAI_API_KEY") ?? undefined,
    AI_EMBEDDING_MODEL: Deno.env.get("AI_EMBEDDING_MODEL") ?? undefined,
    AI_EMBEDDING_ENDPOINT: Deno.env.get("AI_EMBEDDING_ENDPOINT") ?? undefined,
    OPENROUTER_EMBEDDING_MODEL: Deno.env.get("OPENROUTER_EMBEDDING_MODEL") ?? undefined,
    OPENROUTER_SITE_URL: Deno.env.get("OPENROUTER_SITE_URL") ?? undefined,
  };
}

/**
 * Process up to `limit` embedding jobs.
 * When provider unset → RPC defers safely (no fake vectors).
 * When configured → claim jobs, call OpenRouter/compatible embeddings, complete.
 */
export async function processEmbeddingJobsBatch(
  admin: SupabaseClient,
  limit = 10,
  opts?: { schoolId?: string | null },
): Promise<{
  provider_configured: boolean;
  claimed: number;
  embedded: number;
  deferred: number;
  failed: number;
  skipped_other_tenant: number;
  details: unknown;
}> {
  const env = envMap();
  const configured = isEmbeddingProviderConfigured(env);
  const schoolFilter = opts?.schoolId ? String(opts.schoolId) : null;

  const { data: batch, error } = await admin.rpc("ai_embedding_jobs_process_batch", {
    p_limit: limit,
    p_provider_configured: configured,
  });

  if (error) {
    return {
      provider_configured: configured,
      claimed: 0,
      embedded: 0,
      deferred: 0,
      failed: 0,
      skipped_other_tenant: 0,
      details: { error: String(error.message ?? error) },
    };
  }

  const payload = (batch && typeof batch === "object" ? batch : {}) as Record<string, unknown>;
  if (payload.action === "deferred" || !configured) {
    return {
      provider_configured: configured,
      claimed: 0,
      embedded: 0,
      deferred: Number(payload.deferred_count ?? 0),
      failed: 0,
      skipped_other_tenant: 0,
      details: payload,
    };
  }

  const jobsRaw = Array.isArray(payload.jobs) ? payload.jobs : [];
  let embedded = 0;
  let deferred = 0;
  let failed = 0;
  let skipped_other_tenant = 0;
  const results: unknown[] = [];

  for (const row of jobsRaw) {
    const j = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
    const job: EmbeddingJobClaim = {
      job_id: String(j.job_id ?? ""),
      chunk_id: String(j.chunk_id ?? ""),
      school_id: String(j.school_id ?? ""),
      document_id: j.document_id != null ? String(j.document_id) : undefined,
      version_id: j.version_id != null ? String(j.version_id) : undefined,
      chunk_text: String(j.chunk_text ?? ""),
    };
    if (!job.job_id || !job.chunk_id) continue;

    if (schoolFilter && job.school_id !== schoolFilter) {
      // Release claim so another tenant/cron can pick it up.
      await admin
        .from("ai_embedding_jobs")
        .update({ status: "pending_embed", updated_at: new Date().toISOString() })
        .eq("id", job.job_id)
        .eq("status", "processing");
      skipped_other_tenant += 1;
      continue;
    }

    const result = await processOneEmbeddingJob(job, { env });
    if (result.ok) {
      await admin.rpc("ai_kms_complete_chunk_embed", {
        p_chunk_id: job.chunk_id,
        p_embedding: result.embedding,
        p_model_version: result.model,
        p_failed: false,
        p_error: null,
      });
      embedded += 1;
      results.push({ chunk_id: job.chunk_id, status: "embedded", dims: result.dims });
    } else if (result.deferred) {
      await admin.rpc("ai_kms_complete_chunk_embed", {
        p_chunk_id: job.chunk_id,
        p_embedding: null,
        p_model_version: null,
        p_failed: true,
        p_error: result.error,
      });
      deferred += 1;
      results.push({ chunk_id: job.chunk_id, status: "deferred", error: result.error });
    } else {
      await admin.rpc("ai_kms_complete_chunk_embed", {
        p_chunk_id: job.chunk_id,
        p_embedding: null,
        p_model_version: null,
        p_failed: true,
        p_error: result.error,
      });
      failed += 1;
      results.push({ chunk_id: job.chunk_id, status: "failed", error: result.error });
    }
  }

  return {
    provider_configured: configured,
    claimed: jobsRaw.length,
    embedded,
    deferred,
    failed,
    skipped_other_tenant,
    details: { rpc: payload, results },
  };
}
