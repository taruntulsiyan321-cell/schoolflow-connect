import { describe, expect, it } from "vitest";
import { MAX_ZOOM, clampOffset, cropRect } from "./cropSquare";

/** A landscape photo, 1200 × 800. Its largest square is 800, centred at x 200. */
const PHOTO = { width: 1200, height: 800 };

describe("cropping a photo to a square (D1)", () => {
  it("starts on the largest square, centred", () => {
    expect(cropRect(PHOTO, 1, { x: 0, y: 0 })).toEqual({ sx: 200, sy: 0, size: 800 });
    // A portrait photo centres the other way.
    expect(cropRect({ width: 600, height: 900 }, 1, { x: 0, y: 0 })).toEqual({ sx: 0, sy: 150, size: 600 });
  });

  it("zooms in on the centre, and no further than MAX_ZOOM or out past the photo", () => {
    expect(cropRect(PHOTO, 2, { x: 0, y: 0 })).toEqual({ sx: 400, sy: 200, size: 400 });
    expect(cropRect(PHOTO, MAX_ZOOM + 5, { x: 0, y: 0 }).size).toBeCloseTo(800 / MAX_ZOOM);
    expect(cropRect(PHOTO, 0.2, { x: 0, y: 0 }).size).toBe(800);
  });

  it("moves with the offset and stops at every edge", () => {
    expect(cropRect(PHOTO, 1, { x: 150, y: 0 })).toEqual({ sx: 350, sy: 0, size: 800 });
    // Past the right and left edges, and up and down when the square is the full height.
    expect(cropRect(PHOTO, 1, { x: 999, y: 0 }).sx).toBe(400);
    expect(cropRect(PHOTO, 1, { x: -999, y: 0 }).sx).toBe(0);
    expect(cropRect(PHOTO, 1, { x: 0, y: 500 }).sy).toBe(0);
    // Zoomed, there is room to move down.
    expect(cropRect(PHOTO, 2, { x: 0, y: 500 })).toEqual({ sx: 400, sy: 400, size: 400 });
  });

  it("brings a drag past an edge back to it, so the next drag starts from what is shown", () => {
    expect(clampOffset(PHOTO, 1, { x: 999, y: 50 })).toEqual({ x: 200, y: 0 });
    // CONTROL: an offset inside the photo is kept as it is.
    expect(clampOffset(PHOTO, 2, { x: -100, y: 100 })).toEqual({ x: -100, y: 100 });
  });
});
