/**
 * Download + prepare upload bytes for classification.
 * Images → data-URIs (vision). PDFs → text via unpdf when possible;
 * otherwise a PDF data-URI for the model file path.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import type { MediaPayload } from "./types.ts";

const BUCKET = "student-uploads";
/** Match Nova / aiRouter caps — keep payloads within edge + OpenRouter limits. */
const MAX_IMAGE_BYTES = 6_000_000;
const MAX_PDF_BYTES = 12_000_000;
const MIN_PDF_TEXT_CHARS = 80;

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function mimeFromPath(path: string, declared: string): string {
  const d = (declared || "").toLowerCase().trim();
  if (d.startsWith("image/") || d === "application/pdf") return d;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "gif") return "image/gif";
  if (ext === "heic") return "image/heic";
  return d || "application/octet-stream";
}

async function extractPdfText(bytes: Uint8Array): Promise<{ text: string; pages: number | null }> {
  try {
    const { extractText, getDocumentProxy } = await import("https://esm.sh/unpdf@0.12.1");
    const pdf = await getDocumentProxy(bytes);
    const result = await extractText(pdf, { mergePages: true });
    const raw = result?.text;
    const text = Array.isArray(raw)
      ? raw.join("\n").trim()
      : typeof raw === "string"
      ? raw.trim()
      : "";
    const pages =
      typeof result?.totalPages === "number" && result.totalPages > 0
        ? result.totalPages
        : null;
    return { text, pages };
  } catch {
    return { text: "", pages: null };
  }
}

export type LoadMediaResult =
  | { ok: true; media: MediaPayload }
  | { ok: false; error: string };

/**
 * Load the owner's file from the private bucket and shape it for the classifier.
 * `ownerId` must own the path (`{ownerId}/…`) — service_role download must never
 * follow an unbound storage_path (confused-deputy / orphan claim).
 */
export async function loadUploadMedia(
  admin: SupabaseClient,
  storagePath: string,
  mimeType: string,
  ownerId: string,
): Promise<LoadMediaResult> {
  const path = (storagePath || "").trim();
  const uid = (ownerId || "").trim();
  if (!uid) {
    return { ok: false, error: "Upload owner is missing." };
  }
  if (!path.startsWith(`${uid}/`) || path.includes("..")) {
    return {
      ok: false,
      error: "Upload file path does not belong to this account.",
    };
  }

  const { data, error } = await admin.storage.from(BUCKET).download(path);
  if (error || !data) {
    return {
      ok: false,
      error: error?.message || "Could not download the uploaded file from storage.",
    };
  }

  const buf = new Uint8Array(await data.arrayBuffer());
  if (buf.byteLength === 0) {
    return { ok: false, error: "The uploaded file is empty." };
  }

  const mime = mimeFromPath(path, mimeType);

  if (mime.startsWith("image/")) {
    if (buf.byteLength > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        error: "That image is too large to classify. Use a smaller photo (under ~6 MB).",
      };
    }
    const dataUri = `data:${mime};base64,${bytesToBase64(buf)}`;
    return { ok: true, media: { kind: "images", images: [dataUri], page_count: 1 } };
  }

  if (mime === "application/pdf") {
    if (buf.byteLength > MAX_PDF_BYTES) {
      return {
        ok: false,
        error: "That PDF is too large to classify. Use a shorter file (under ~12 MB).",
      };
    }
    const { text, pages } = await extractPdfText(buf);
    if (text.length >= MIN_PDF_TEXT_CHARS) {
      // Cap text so the prompt stays bounded.
      return {
        ok: true,
        media: { kind: "text", text: text.slice(0, 40_000), page_count: pages },
      };
    }
    // Scanned / image-only PDF — send bytes for vision/file OCR, never invent.
    const dataUri = `data:application/pdf;base64,${bytesToBase64(buf)}`;
    return {
      ok: true,
      media: { kind: "pdf_bytes", dataUri, page_count: pages },
    };
  }

  return {
    ok: false,
    error: `Unsupported file type (${mime || "unknown"}). Upload a PDF or an image.`,
  };
}
