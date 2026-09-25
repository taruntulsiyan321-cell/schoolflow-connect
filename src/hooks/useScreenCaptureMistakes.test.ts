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
import { supabase } from "@/integrations/supabase/client";
import { setCaptureAppAllowed } from "./useScreenCaptureMistakes";
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

describe("adding an app to the capture list", () => {
  it("inserts or leaves it — never an update, which students are not granted", async () => {
    // A merging upsert failed for every student with 42501 (permission denied
    // for UPDATE), so nothing could be put on the list and every captured
    // frame was dropped as app_not_allowed (live, 2026-09-25).
    const upsert = vi.fn(async () => ({ error: null }));
    vi.mocked(supabase.from).mockReturnValueOnce({ upsert } as never);
    await setCaptureAppAllowed("u-1", "com.physicswallah.pw", "Physics Wallah", true);
    expect(upsert).toHaveBeenCalledWith(
      { owner_id: "u-1", package_name: "com.physicswallah.pw", label: "Physics Wallah" },
      { onConflict: "owner_id,package_name", ignoreDuplicates: true },
    );
  });

  it("CONTROL: a failed write is reported, not swallowed", async () => {
    vi.mocked(supabase.from).mockReturnValueOnce({ upsert: async () => ({ error: { message: "permission denied" } }) } as never);
    await expect(setCaptureAppAllowed("u-1", "com.physicswallah.pw", "Physics Wallah", true)).rejects.toThrow("permission denied");
  });
});
