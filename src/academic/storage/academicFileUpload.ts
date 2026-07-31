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

function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120);
}

export async function uploadAcademicFile(file: File): Promise<HomeworkAttachmentMeta> {
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

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error("Failed to resolve uploaded file URL");

  return {
    name: file.name,
    url: data.publicUrl,
    mimeType: file.type || guessMime(ext),
    sizeBytes: file.size,
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
