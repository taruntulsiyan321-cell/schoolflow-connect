import { supabase } from "@/integrations/supabase/client";

const BUCKET = "chat-attachments";
const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_EXT = new Set(["pdf", "png", "jpg", "jpeg", "gif", "webp", "heic", "doc", "docx", "txt"]);

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

export type ChatUploadMeta = {
  name: string;
  url: string;
  mimeType?: string;
  sizeBytes?: number;
};

/**
 * Upload a chat attachment under `{schoolId}/{userId}/...`.
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

  const { data: signed, error: signErr } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 60 * 60 * 24 * 7);
  if (signErr || !signed?.signedUrl) {
    // Fallback path string that still encodes school/user for RPC validation
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    if (!data?.publicUrl) throw new Error("Failed to resolve uploaded file URL");
    return {
      name: file.name,
      url: data.publicUrl,
      mimeType: file.type || undefined,
      sizeBytes: file.size,
    };
  }

  return {
    name: file.name,
    url: signed.signedUrl,
    mimeType: file.type || undefined,
    sizeBytes: file.size,
  };
}
