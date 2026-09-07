import { supabase } from "@/integrations/supabase/client";

/**
 * `doubt-images` — the community doubt portal's photographs.
 *
 * WHAT IS IN THIS BUCKET. Student-uploaded pictures of homework and
 * handwriting: faces, names, and a child's own work. It was `public = true`
 * with **no size limit at all** — the only bucket in the project with neither —
 * so every object was URL-enumerable with no token, no signature and no expiry,
 * and it was an unmetered upload target as well. KNOWN_ISSUES 7b.
 *
 * This module is the read/write half of closing that. It is a copy of the shape
 * `chatFileUpload.ts` established and `academicFileUpload.ts` follows: store a
 * DURABLE REF, resolve a signed URL on read. A public URL persisted into
 * `community_doubts.image_url` is a permanent bet that the bucket stays public,
 * and every such row breaks the moment it does not.
 */

const BUCKET = "doubt-images";
/** Matches `doubt-attachments`, the private bucket this one now behaves like. */
const MAX_BYTES = 20 * 1024 * 1024;
/** Fresh signed-URL TTL for reads. The object stays; only the URL expires. */
const SIGN_TTL_SEC = 60 * 60;

const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic"]);

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

/** Persistable ref: `doubt-images/{uid}/{ts}-{name}`. */
export function toDurableDoubtImageRef(objectPath: string): string {
  const cleaned = objectPath.replace(/^\/+/, "");
  return cleaned.startsWith(`${BUCKET}/`) ? cleaned : `${BUCKET}/${cleaned}`;
}

/**
 * Bucket-relative object path from a stored ref, or null when the value is not
 * an object in this bucket.
 *
 * The legacy public-URL branch exists for symmetry with the other two buckets,
 * not because such a row was found: measured 2026-09-07, `community_doubts` and
 * `community_doubt_answers` hold **zero** non-null `image_url`, and the bucket
 * holds **zero** objects. That is why this could be changed without migrating
 * anything — and it is the cheapest this will ever be.
 */
export function extractDoubtImagePath(stored: string): string | null {
  const u = stored.trim();
  if (!u) return null;

  if (!u.includes("://")) {
    if (u.startsWith(`${BUCKET}/`)) return u.slice(BUCKET.length + 1);
    if (/^[0-9a-f-]{36}\//i.test(u)) return u;
    return null;
  }

  const fromPath = u.match(/\/doubt-images\/([^?]+)/i);
  if (fromPath?.[1]) {
    try {
      return decodeURIComponent(fromPath[1]);
    } catch {
      return fromPath[1];
    }
  }
  return null;
}

/**
 * A usable URL for a stored ref: signed for our own objects, passthrough for
 * anything else. Returns null only for an empty ref.
 *
 * A signing FAILURE falls back to the stored value rather than to null: a
 * visibly broken image is better than one that silently disappears, because the
 * second reads as "this doubt had no picture".
 */
export async function doubtImageUrl(stored: string | null | undefined): Promise<string | null> {
  const trimmed = (stored ?? "").trim();
  if (!trimmed) return null;
  const path = extractDoubtImagePath(trimmed);
  if (!path) return trimmed;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL_SEC);
  if (error || !data?.signedUrl) return trimmed;
  return data.signedUrl;
}

/**
 * Upload one doubt image and return the durable ref to persist.
 *
 * The path is `{userId}/{ts}-{name}`: the INSERT policy pins segment 1 to
 * `auth.uid()`, so no other shape is accepted. Returns null when there is no
 * file, which is the common case — a doubt does not need a picture.
 */
export async function uploadDoubtImage(
  file: File | null,
  userId: string | undefined,
): Promise<string | null> {
  if (!file || !userId) return null;
  if (file.size > MAX_BYTES) {
    throw new Error(`"${file.name}" is larger than 20 MB`);
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext && !ALLOWED_EXT.has(ext)) {
    throw new Error(`${file.name} is not an image the portal accepts`);
  }

  const path = `${userId}/${Date.now()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) throw error;
  return toDurableDoubtImageRef(path);
}
