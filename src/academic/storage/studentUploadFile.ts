import { supabase } from "@/integrations/supabase/client";
import { UPLOAD_MAX_BYTES } from "@/academic/services/uploadLimits";

const BUCKET = "student-uploads";

/** Spec §3.1 — PDF or image of the student's own material. */
export const STUDENT_UPLOAD_ACCEPT =
  ".pdf,.png,.jpg,.jpeg,.webp,.heic,.gif,image/*,application/pdf";

const ALLOWED_EXT = new Set(["pdf", "png", "jpg", "jpeg", "webp", "heic", "gif"]);

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

/**
 * Upload a file into the private student-uploads bucket.
 * Path: `{auth.uid}/{ts}-{safeName}` — same convention as academic-files.
 */
export async function uploadStudentUploadFile(
  file: File,
): Promise<{ storagePath: string; mimeType: string; byteSize: number; originalFilename: string }> {
  if (file.size <= 0) throw new Error("That file is empty.");
  if (file.size > UPLOAD_MAX_BYTES) {
    throw new Error(`"${file.name}" is larger than ${UPLOAD_MAX_BYTES / (1024 * 1024)} MB`);
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (ext && !ALLOWED_EXT.has(ext)) {
    throw new Error(`File type .${ext} is not supported. Use a PDF or an image.`);
  }

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user?.id) throw new Error("Sign in required to upload files");

  const mimeType = file.type || (ext === "pdf" ? "application/pdf" : "application/octet-stream");
  // Include a short id so multi-file picks in the same millisecond never collide on UNIQUE(storage_path).
  const storagePath = `${user.id}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}-${safeFileName(file.name)}`;

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    upsert: false,
    contentType: mimeType,
  });
  if (error) {
    const msg = error.message || "Upload failed";
    if (/bucket|not found|row-level security|policy/i.test(msg)) {
      throw new Error(
        "Upload storage is not ready yet. Ask admin to apply migration 20261063000000.",
      );
    }
    throw new Error(msg);
  }

  return {
    storagePath,
    mimeType,
    byteSize: file.size,
    originalFilename: file.name,
  };
}

export async function createSignedStudentUploadUrl(
  storagePath: string,
  ttlSec = 3600,
): Promise<string> {
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, ttlSec);
  if (error || !data?.signedUrl) throw new Error(error?.message || "Could not open that file");
  return data.signedUrl;
}
