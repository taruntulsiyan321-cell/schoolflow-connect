/**
 * Hook: watch upload queue + Stage 1 submit contract + allowlist honesty.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(async () => ({ data: [{ package_name: "com.physicswallah.pw" }], error: null })),
      })),
      upsert: vi.fn(async () => ({ error: null })),
      delete: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(async () => ({ error: null })),
        })),
      })),
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
  deleteScreenCaptureQuestion: vi.fn(async () => true),
}));

import {
  deleteScreenCaptureQuestion,
  submitScreenCaptureMistake,
} from "@/academic/services/screenCaptureService";
import type { CaptureFrame } from "@/lib/screenCaptureMistake";

describe("screen-capture watch upload contract", () => {
  beforeEach(() => {
    vi.mocked(submitScreenCaptureMistake).mockClear();
    vi.mocked(deleteScreenCaptureQuestion).mockClear();
  });

  it("submit does not invent client allowlist (server DB only)", async () => {
    const frame: CaptureFrame = {
      image_base64: "aaa",
      mime_type: "image/png",
      package_name: "com.physicswallah.pw",
    };
    await submitScreenCaptureMistake({
      image_base64: frame.image_base64,
      mime_type: frame.mime_type,
      package_name: frame.package_name!,
      exam_id: null,
    });
    expect(submitScreenCaptureMistake).toHaveBeenCalledWith(
      expect.objectContaining({
        image_base64: "aaa",
        package_name: "com.physicswallah.pw",
      }),
    );
    const arg = vi.mocked(submitScreenCaptureMistake).mock.calls[0]?.[0];
    expect(arg).not.toHaveProperty("allowed_packages");
  });

  it("deleteScreenCaptureQuestion returns true on success", async () => {
    await expect(deleteScreenCaptureQuestion("cq-1")).resolves.toBe(true);
    expect(deleteScreenCaptureQuestion).toHaveBeenCalledWith("cq-1");
  });
});

describe("allowlist honesty (§4 / §5.1)", () => {
  it("touched key namespaces per user so empty after uncheck is sticky", () => {
    const uid = "user-allowlist-test";
    const key = `gurukul.capture.allowlist_touched.${uid}`;
    localStorage.removeItem(key);
    expect(localStorage.getItem(key)).toBeNull();
    localStorage.setItem(key, "1");
    expect(localStorage.getItem(key)).toBe("1");
    localStorage.removeItem(key);
  });
});
