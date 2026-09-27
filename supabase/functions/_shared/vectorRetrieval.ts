/**
 * Vector Retrieval v0 — evidence packs from KMS-approved published chunks.
 * Similarity uses embedding_compat when present; lexical overlap otherwise.
 * Never treats similarity as permission — RPC filters published + visibility.
 */

export type RetrievalMatchMode = "vector_compat" | "lexical" | "none";

export type RetrievalHit = {
  chunk_id: string;
  document_id: string;
  version_id?: string;
  chunk_index?: number;
  chunk_text: string;
  chunk_metadata?: Record<string, unknown>;
  document_title?: string;
  content_type?: string;
  document_status?: string;
  embed_status?: string;
  embedding_model_version?: string | null;
  score: number;
  match_mode: RetrievalMatchMode | string;
};

export type RetrievalPack = {
  school_id: string;
  query: string;
  mode: RetrievalMatchMode | string;
  /** Whether a real vector similarity search actually executed, independent
   *  of whether it returned any hits — distinguishes "ran, found nothing" from
   *  "never ran" now that `mode` alone collapses both to "lexical" when the
   *  vector branch comes back empty and the RPC falls through. */
  vector_attempted?: boolean;
  min_score: number;
  hits: RetrievalHit[];
  hit_count: number;
  approved_only: boolean;
  sufficient: boolean;
};

type RetrieveInput = {
  school_id: string;
  query: string;
  role?: "admin" | "teacher" | "student" | "parent" | "principal";
  limit?: number;
  min_score?: number;
  query_embedding?: number[] | null;
  subject?: string | null;
  grade?: string | null;
};



function isEvidenceSufficient(
  hits: RetrievalHit[],
  opts: { minHits?: number; minScore?: number } = {},
): boolean {
  const minHits = opts.minHits ?? 1;
  const minScore = opts.minScore ?? 0.12;
  const ok = hits.filter((h) => Number(h.score) >= minScore);
  return ok.length >= minHits;
}

export function buildEvidenceCitations(hits: RetrievalHit[], max = 3): Array<{
  chunk_id: string;
  document_id: string;
  title?: string;
  excerpt: string;
  score: number;
}> {
  return hits.slice(0, max).map((h) => ({
    chunk_id: h.chunk_id,
    document_id: h.document_id,
    title: h.document_title,
    excerpt: (h.chunk_text ?? "").slice(0, 280),
    score: Number(h.score) || 0,
  }));
}


function parseRetrievalRpcPayload(raw: unknown, schoolId: string, query: string): RetrievalPack {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const hitsRaw = Array.isArray(obj.hits) ? obj.hits : [];
  const hits: RetrievalHit[] = hitsRaw.map((h) => {
    const row = (h && typeof h === "object" ? h : {}) as Record<string, unknown>;
    return {
      chunk_id: String(row.chunk_id ?? ""),
      document_id: String(row.document_id ?? ""),
      version_id: row.version_id != null ? String(row.version_id) : undefined,
      chunk_index: typeof row.chunk_index === "number" ? row.chunk_index : undefined,
      chunk_text: String(row.chunk_text ?? ""),
      chunk_metadata:
        row.chunk_metadata && typeof row.chunk_metadata === "object"
          ? (row.chunk_metadata as Record<string, unknown>)
          : undefined,
      document_title: row.document_title != null ? String(row.document_title) : undefined,
      content_type: row.content_type != null ? String(row.content_type) : undefined,
      document_status: row.document_status != null ? String(row.document_status) : undefined,
      embed_status: row.embed_status != null ? String(row.embed_status) : undefined,
      embedding_model_version:
        row.embedding_model_version != null ? String(row.embedding_model_version) : null,
      score: Number(row.score) || 0,
      match_mode: String(row.match_mode ?? obj.mode ?? "lexical"),
    };
  });
  const minScore = Number(obj.min_score) || 0.12;
  return {
    school_id: String(obj.school_id ?? schoolId),
    query: String(obj.query ?? query),
    mode: String(obj.mode ?? (hits.length ? "lexical" : "none")),
    vector_attempted: obj.vector_attempted === true,
    min_score: minScore,
    hits,
    hit_count: Number(obj.hit_count) || hits.length,
    approved_only: obj.approved_only !== false,
    sufficient: isEvidenceSufficient(hits, { minScore }),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function retrieveKmsChunks(client: any, input: RetrieveInput): Promise<RetrievalPack> {
  const { data, error } = await client.rpc("ai_kms_retrieve_chunks", {
    p_school_id: input.school_id,
    p_query: input.query,
    p_role: input.role ?? "student",
    p_limit: input.limit ?? 5,
    p_min_score: input.min_score ?? 0.12,
    p_query_embedding: input.query_embedding ?? null,
    p_subject: input.subject ?? null,
    p_grade: input.grade ?? null,
  });
  if (error) {
    return {
      school_id: input.school_id,
      query: input.query,
      mode: "none",
      min_score: input.min_score ?? 0.12,
      hits: [],
      hit_count: 0,
      approved_only: true,
      sufficient: false,
    };
  }
  return parseRetrievalRpcPayload(data, input.school_id, input.query);
}
