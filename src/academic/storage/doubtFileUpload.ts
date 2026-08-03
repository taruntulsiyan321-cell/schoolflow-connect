import { supabase } from "@/integrations/supabase/client";

const BUCKET = "doubt-attachments";
const MAX_BYTES = 20 * 1024 * 1024;

export const DOUBT_FILE_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.doc,.docx,.txt,image/*,application/pdf";

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
  "txt",
]);

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

export type DoubtUploadMeta = {
  storagePath: string;
  fileName: string;
  fileType: string | null;
  fileSizeBytes: number;
  signedUrl: string | null;
};

/**
 * Upload under `{schoolId}/{classId}/{userId}/...`.
 * Storage RLS rejects other path prefixes.
 */
export async function uploadDoubtAttachment(
  file: File,
  schoolId: string,
  classId: string,
): Promise<DoubtUploadMeta> {
  if (!schoolId || !classId) throw new Error("Missing school/class context for upload");
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

  const storagePath = `${schoolId}/${classId}/${user.id}/${Date.now()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) {
    const msg = error.message || "Upload failed";
    if (/bucket|not found|row-level security|policy/i.test(msg)) {
      throw new Error(
        "Doubt file storage is not ready yet. Ask admin to run APPLY_DOUBT_PORTAL.sql.",
      );
    }
    throw new Error(msg);
  }

  const { data: signed } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60 * 24 * 7);

  return {
    storagePath,
    fileName: file.name,
    fileType: file.type || null,
    fileSizeBytes: file.size,
    signedUrl: signed?.signedUrl ?? null,
  };
}

export async function signedDoubtUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 60 * 60);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
