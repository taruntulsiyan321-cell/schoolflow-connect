import { supabase } from "@/integrations/supabase/client";
import type { HomeworkAttachmentMeta } from "../repository/homeworkRepository";

const BUCKET = "academic-files";
const MAX_BYTES = 20 * 1024 * 1024;

export const ACADEMIC_FILE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,image/*,application/pdf";

const ALLOWED_EXT = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
]);

export function formatFileSize(bytes?: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileKindFromName(name: string, mimeType?: string | null): "pdf" | "image" | "doc" | "sheet" | "slides" | "link" | "file" {
  const lower = name.toLowerCase();
  const mime = (mimeType ?? "").toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|heic)$/.test(lower)) return "image";
  if (mime.includes("pdf") || lower.endsWith(".pdf")) return "pdf";
  if (mime.includes("sheet") || mime.includes("excel") || /\.(xls|xlsx|csv)$/.test(lower)) return "sheet";
  if (mime.includes("presentation") || mime.includes("powerpoint") || /\.(ppt|pptx)$/.test(lower))
    return "slides";
  if (
    mime.includes("word") ||
    mime.includes("document") ||
    /\.(doc|docx|txt)$/.test(lower)
  )
    return "doc";
  if (/^https?:\/\//i.test(name) || mime === "text/uri-list") return "link";
  return "file";
}

/** Fresh signed-URL TTL for reads. The object stays; only the URL expires. */
const SIGN_TTL_SEC = 60 * 60;

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

/**
 * Returns the attachment meta plus the bucket-relative object path.
 *
 * `storagePath` is additive: every existing caller destructures
 * HomeworkAttachmentMeta and is unaffected. It exists because
 * learning_resources stores `storage_path` and resolves it back through
 * publicAcademicFileUrl, so that caller needs the path, not just the URL.
 */
export async function uploadAcademicFile(
  file: File,
): Promise<HomeworkAttachmentMeta & { storagePath: string }> {
  if (file.size > MAX_BYTES) {
    throw new Error(`"${file.name}" is larger than 20 MB`);
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext && !ALLOWED_EXT.has(ext)) {
    throw new Error(`File type .${ext} is not supported`);
  }

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user?.id) throw new Error("Sign in required to upload files");

  const path = `${user.id}/${Date.now()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) {
    const msg = error.message || "Upload failed";
    if (/bucket|not found|row-level security|policy/i.test(msg)) {
      throw new Error(
        "File storage is not ready yet. Ask admin to run the academic-files storage migration.",
      );
    }
    throw new Error(msg);
  }

  // A DURABLE REF, NOT A URL. `url` is persisted into `homework.attachments`
  // and `homework_submissions.attachments` and read back months later; a public
  // URL baked into a row is a permanent decision that the bucket stays public.
  // This stores what the object IS and lets the reader decide how to reach it —
  // the same shape `toDurableChatAttachmentRef` already uses for chat, and the
  // prerequisite for KNOWN_ISSUES 7's fence, which cannot land while rows hold
  // URLs that stop working the moment the bucket turns private.
  return {
    name: file.name,
    url: toDurableAcademicFileRef(path),
    mimeType: file.type || guessMime(ext),
    sizeBytes: file.size,
    storagePath: path,
  };
}

function guessMime(ext: string): string | undefined {
  const map: Record<string, string> = {
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    txt: "text/plain",
  };
  return map[ext];
}

/**
 * Persistable ref for an object in this bucket: `academic-files/{uid}/{file}`.
 *
 * Mirrors `toDurableChatAttachmentRef`. Prefixing with the bucket makes a
 * stored value self-describing, so `extractAcademicStoragePath` can tell a
 * bucket ref from an external link without guessing.
 */
export function toDurableAcademicFileRef(objectPath: string): string {
  const cleaned = objectPath.replace(/^\/+/, "");
  return cleaned.startsWith(`${BUCKET}/`) ? cleaned : `${BUCKET}/${cleaned}`;
}

/**
 * Bucket-relative object path from anything this app has ever stored, or null
 * when the value is not an object in this bucket.
 *
 * THREE INPUTS, and all three exist in live rows:
 *   - a durable ref            `academic-files/{uid}/{ts}-{name}`
 *   - a bare object path       `{uid}/{ts}-{name}`   (learning_resources.storage_path)
 *   - a legacy PUBLIC URL      `https://…/storage/v1/object/public/academic-files/…`
 *
 * Anything else — a teacher's link to a YouTube video or an NCERT page — is not
 * ours and returns null so the caller passes it through untouched.
 */
export function extractAcademicStoragePath(stored: string): string | null {
  const u = stored.trim();
  if (!u) return null;

  if (!u.includes("://")) {
    if (u.startsWith(`${BUCKET}/`)) return u.slice(BUCKET.length + 1);
    // `{uuid}/{filename}` — the shape uploadAcademicFile writes.
    if (/^[0-9a-f-]{36}\//i.test(u)) return u;
    return null;
  }

  const fromPath = u.match(/\/academic-files\/([^?]+)/i);
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
 * external links.
 *
 * SIGNED RATHER THAN PUBLIC, and it works either way round. Today the bucket is
 * public and `academic files read` admits any authenticated caller, so signing
 * succeeds for everyone it should. When KNOWN_ISSUES 7's fence lands, signing
 * starts failing for callers outside the uploader's school — which is the whole
 * point — and no client change is needed at that moment. Doing it in this order
 * means the fence is a one-line migration rather than a migration plus a
 * scramble to fix every broken download.
 *
 * Returns null only for an empty ref. A signing FAILURE falls back to the
 * stored value: for a legacy public URL that still works, and for a durable ref
 * it produces a broken link rather than a silently missing one — a visible
 * failure is the better of the two.
 */
export async function academicFileUrl(stored: string | null | undefined): Promise<string | null> {
  const trimmed = (stored ?? "").trim();
  if (!trimmed) return null;
  const path = extractAcademicStoragePath(trimmed);
  if (!path) return trimmed;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL_SEC);
  if (error || !data?.signedUrl) return trimmed;
  return data.signedUrl;
}

export function attachmentFromLink(url: string, name?: string): HomeworkAttachmentMeta {
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Link must start with http:// or https://");
  }
  let label = name?.trim();
  if (!label) {
    try {
      label = new URL(trimmed).hostname.replace(/^www\./, "");
    } catch {
      label = "Link";
    }
  }
  return {
    name: label,
    url: trimmed,
    mimeType: "text/uri-list",
  };
}
