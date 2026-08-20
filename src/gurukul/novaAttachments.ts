/**
 * Nova attachment processing — photos (camera/gallery) and PDFs, unified into one
 * output shape: a list of compressed JPEG data URIs. A PDF becomes "its pages, as
 * images" so the rest of the pipeline (upload UI, preview, network payload, backend)
 * never needs to know the difference between a photo and a scanned page.
 *
 * Never persisted anywhere — processed entirely client-side, sent inline per-request.
 */
// pdfjs-dist (~370KB) is loaded lazily inside pdfFileToDataUris — a static import here would
// ship it in every student's initial dashboard bundle even if they never attach a PDF.
let pdfjsLibPromise: ReturnType<typeof loadPdfjs> | null = null;
async function loadPdfjs() {
  const [pdfjsLib, { default: pdfWorkerUrl }] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  return pdfjsLib;
}

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;
const MAX_PDF_PAGES = 3;

export const ACCEPTED_ATTACHMENT_TYPES = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";
export const MAX_ATTACHMENTS = 3;

export class AttachmentError extends Error {}

function drawToJpegDataUri(source: CanvasImageSource, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AttachmentError("Your browser does not support image processing.");
  ctx.drawImage(source, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

async function imageFileToDataUri(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new AttachmentError(`Could not read "${file.name}" as an image.`);
  }
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const uri = drawToJpegDataUri(bitmap, width, height);
  bitmap.close();
  return uri;
}

async function pdfFileToDataUris(file: File): Promise<string[]> {
  let pdf;
  try {
    pdfjsLibPromise ??= loadPdfjs();
    const pdfjsLib = await pdfjsLibPromise;
    const buf = await file.arrayBuffer();
    pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  } catch {
    throw new AttachmentError(`Could not read "${file.name}" as a PDF.`);
  }
  const pageCount = Math.min(pdf.numPages, MAX_PDF_PAGES);
  const out: string[] = [];
  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const unscaled = page.getViewport({ scale: 1 });
    const scale = Math.min(2, MAX_DIMENSION / Math.max(unscaled.width, unscaled.height));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new AttachmentError("Your browser does not support PDF rendering.");
    await page.render({ canvasContext: ctx, viewport, canvas }).promise;
    out.push(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
  }
  return out;
}

/** Converts one selected file (photo or PDF) into one or more image data URIs. */
export async function processAttachmentFile(file: File): Promise<string[]> {
  if (file.type === "application/pdf") {
    return pdfFileToDataUris(file);
  }
  if (file.type.startsWith("image/")) {
    return [await imageFileToDataUri(file)];
  }
  throw new AttachmentError(`"${file.name}" is not a supported photo or PDF.`);
}
