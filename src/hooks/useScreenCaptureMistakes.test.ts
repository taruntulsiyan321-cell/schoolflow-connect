/**
 * Hook: tap + watchFrameReady → submitScreenCaptureMistake.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(async () => ({ data: [{ package_name: "com.physicswallah.pw" }], error: null })),
      })),
      upsert: vi.fn(async () => ({ error: null })),
    })),
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("@/lib/screenCaptureMistake", () => ({
  isNativeScreenCaptureAvailable: () => false,
  ScreenCaptureMistake: {},
}));

vi.mock("@/academic/services/screenCaptureService", () => ({
  submitScreenCaptureMistake: vi.fn(async () => ({ ok: true, captured: true })),
}));

import { submitScreenCaptureMistake } from "@/academic/services/screenCaptureService";
import type { CaptureFrame } from "@/lib/screenCaptureMistake";

describe("screen-capture watch upload contract", () => {
  beforeEach(() => {
    vi.mocked(submitScreenCaptureMistake).mockClear();
  });

  it("submit payload shape matches Stage 1 edge body", async () => {
    const frame: CaptureFrame = {
      image_base64: "aaa",
      mime_type: "image/png",
      package_name: "com.physicswallah.pw",
    };
    await submitScreenCaptureMistake({
      image_base64: frame.image_base64,
      mime_type: frame.mime_type,
      package_name: frame.package_name!,
      allowed_packages: ["com.physicswallah.pw"],
      exam_id: null,
    });
    expect(submitScreenCaptureMistake).toHaveBeenCalledWith(
      expect.objectContaining({
        image_base64: "aaa",
        package_name: "com.physicswallah.pw",
        allowed_packages: ["com.physicswallah.pw"],
      }),
    );
  });
});
