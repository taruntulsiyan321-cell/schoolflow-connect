import { supabase } from "@/integrations/supabase/client";

const BUCKET = "chat-attachments";
const MAX_BYTES = 10 * 1024 * 1024;
/** Fresh signed URL TTL for reads (object stays; URL is ephemeral). */
const SIGN_TTL_SEC = 60 * 60;

const ALLOWED_EXT = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp", "heic", "doc", "docx", "txt"]);

export const CHAT_FILE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.doc,.docx,.txt,image/*,application/pdf";

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

export type ChatUploadMeta = {
  name: string;
  /** Durable storage ref (`chat-attachments/{school}/{user}/…`), not a short-lived signed URL. */
  url: string;
  mimeType?: string;
  sizeBytes?: number;
};

/** Persistable ref that passes `chat_attachment_url_allowed`. */
export function toDurableChatAttachmentRef(objectPath: string): string {
  const cleaned = objectPath.replace(/^\/+/, "");
  return cleaned.startsWith(`${BUCKET}/`) ? cleaned : `${BUCKET}/${cleaned}`;
}

/** Extract bucket-relative object path from a durable ref or legacy signed/public URL. */
export function extractChatStoragePath(stored: string): string | null {
  const u = stored.trim();
  if (!u) return null;

  if (!u.includes("://")) {
    if (u.startsWith(`${BUCKET}/`)) return u.slice(BUCKET.length + 1);
    // schoolId/userId/...
    if (/^[0-9a-f-]{36}\/[0-9a-f-]{36}\//i.test(u)) return u;
    return null;
  }

  const fromPath = u.match(/\/chat-attachments\/([^?]+)/i);
  if (fromPath?.[1]) {
    try {
      return decodeURIComponent(fromPath[1]);
    } catch {
      return fromPath[1];
    }
  }
  return null;
}

/** Turn a durable ref or legacy URL into a usable short-lived signed URL. */
export async function resolveChatAttachmentUrl(stored: string): Promise<string> {
  const path = extractChatStoragePath(stored);
  if (!path) return stored;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL_SEC);
  if (error || !data?.signedUrl) return stored;
  return data.signedUrl;
}

/**
 * Upload a chat attachment under `{schoolId}/{userId}/...`.
 * Returns a durable path ref for DB storage (re-sign on read).
 * Storage RLS rejects any other path prefix.
 */
export async function uploadChatAttachment(
  file: File,
  schoolId: string,
  threadKey = "dm",
): Promise<ChatUploadMeta> {
  if (!schoolId) throw new Error("Missing school context for upload");
  if (file.size > MAX_BYTES) {
    throw new Error(`"${file.name}" is larger than 10 MB`);
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext && !ALLOWED_EXT.has(ext)) {
    throw new Error(`File type .${ext} is not supported in chat`);
  }

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user?.id) throw new Error("Sign in required to upload files");

  const path = `${schoolId}/${user.id}/${threadKey}/${Date.now()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) {
    const msg = error.message || "Upload failed";
    if (/bucket|not found|row-level security|policy/i.test(msg)) {
      throw new Error(
        "Chat file storage is not ready yet. Ask admin to run APPLY_GURUKUL_CHAT_SECURITY.sql.",
      );
    }
    throw new Error(msg);
  }

  return {
    name: file.name,
    url: toDurableChatAttachmentRef(path),
    mimeType: file.type || undefined,
    sizeBytes: file.size,
  };
}
