/**
 * Cropping a photo to the square it is shown in (docs/TODO.md D1).
 *
 * The arithmetic is in the source image's own pixels and touches no canvas,
 * so it is tested as it is; the drawing is one function at the end.
 */

/** The side of the photo the app stores: small enough to load fast, sharp at every size it is shown. */
export const PHOTO_SIZE = 512;
/** How far a student can zoom into their photo before cropping. */
export const MAX_ZOOM = 3;

export type Size = { width: number; height: number };
export type Offset = { x: number; y: number };
export type SquareRect = { sx: number; sy: number; size: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The square of the image a crop shows: the largest centred square, narrowed
 * by the zoom (1 to MAX_ZOOM), moved by the offset, and always inside the
 * image — a crop never shows past the photo's edge.
 */
export function cropRect(img: Size, zoom: number, offset: Offset): SquareRect {
  const size = Math.min(img.width, img.height) / clamp(zoom, 1, MAX_ZOOM);
  return {
    sx: clamp((img.width - size) / 2 + offset.x, 0, img.width - size),
    sy: clamp((img.height - size) / 2 + offset.y, 0, img.height - size),
    size,
  };
}

/**
 * The offset a crop actually shows. A drag past an edge stops there, so the
 * next drag starts from what is on screen, not from somewhere off it.
 */
export function clampOffset(img: Size, zoom: number, offset: Offset): Offset {
  const r = cropRect(img, zoom, offset);
  return { x: r.sx - (img.width - r.size) / 2, y: r.sy - (img.height - r.size) / 2 };
}

/** Open a chosen file as an image, or say plainly that this device cannot. */
export function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("This photo can't be opened here. Choose a JPEG or PNG."));
    };
    img.src = url;
  });
}

/** Draw the square at PHOTO_SIZE and encode it as a JPEG — the only kind the bucket takes. */
export function renderSquare(image: CanvasImageSource, rect: SquareRect, size = PHOTO_SIZE): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.reject(new Error("This device cannot prepare the photo."));
  ctx.drawImage(image, rect.sx, rect.sy, rect.size, rect.size, 0, 0, size, size);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The photo could not be prepared."))), "image/jpeg", 0.85),
  );
}
