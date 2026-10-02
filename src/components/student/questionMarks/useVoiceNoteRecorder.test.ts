import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { VOICE_MAX_SECONDS } from "@/lib/questionMarks";
import { useVoiceNoteRecorder } from "./useVoiceNoteRecorder";

/**
 * A voice note is at most VOICE_MAX_SECONDS: the recorder stops itself there,
 * whatever the student does. It lets go of the microphone when it stops, when
 * the recording is thrown away, and when the screen goes.
 */

class FakeRecorder {
  static made: FakeRecorder[] = [];
  static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  options: { mimeType?: string; audioBitsPerSecond?: number };
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(_stream: unknown, options: { mimeType?: string; audioBitsPerSecond?: number }) {
    this.options = options;
    this.mimeType = options.mimeType ?? "";
    FakeRecorder.made.push(this);
  }
  start() { this.state = "recording"; }
  // As a browser does it: the data and the stop event come a moment AFTER
  // stop() returns — which is when a discarded recording could land.
  stop() {
    this.state = "inactive";
    setTimeout(() => {
      this.ondataavailable?.({ data: new Blob(["sound"], { type: this.mimeType }) });
      this.onstop?.();
    }, 0);
  }
}

let track: { stop: ReturnType<typeof vi.fn> };
let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecorder.made = [];
  track = { stop: vi.fn() };
  getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [track] });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function started() {
  const hook = renderHook(() => useVoiceNoteRecorder());
  await act(async () => { await hook.result.current.start(); });
  return hook;
}

describe("a voice note", () => {
  it("stops itself at the limit, and is that long", async () => {
    const { result } = await started();
    expect(result.current.state).toBe("recording");
    expect(FakeRecorder.made[0].options).toEqual({ mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32_000 });

    act(() => { vi.advanceTimersByTime(VOICE_MAX_SECONDS * 1000 - 1); });
    expect(result.current.state).toBe("recording");
    act(() => { vi.advanceTimersByTime(1); });
    act(() => { vi.advanceTimersByTime(1); });

    expect(result.current.state).toBe("recorded");
    expect(result.current.seconds).toBe(VOICE_MAX_SECONDS);
    expect(result.current.blob?.type).toBe("audio/webm;codecs=opus");
    expect(track.stop).toHaveBeenCalled();
  });

  it("stopped early, it is as long as it ran", async () => {
    const { result } = await started();
    act(() => { vi.advanceTimersByTime(12_400); });
    expect(result.current.seconds).toBe(12);
    act(() => { result.current.stop(); });
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.state).toBe("recorded");
    expect(result.current.seconds).toBe(12);
  });

  it("a tap too short to say anything is not kept", async () => {
    const { result } = await started();
    act(() => { vi.advanceTimersByTime(300); });
    act(() => { result.current.stop(); });
    act(() => { vi.advanceTimersByTime(1); });
    expect(result.current.state).toBe("idle");
    expect(result.current.blob).toBeNull();
    expect(result.current.error).toBe("too_short");
  });

  it("a refused microphone says so, and records nothing", async () => {
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error("no"), { name: "NotAllowedError" }));
    const { result } = await started();
    expect(result.current.error).toBe("denied");
    expect(result.current.state).toBe("idle");
    expect(FakeRecorder.made).toHaveLength(0);
  });

  it("thrown away mid-recording, it stays thrown away", async () => {
    const { result } = await started();
    act(() => { vi.advanceTimersByTime(5_000); });
    act(() => { result.current.discard(); });
    act(() => { vi.advanceTimersByTime(VOICE_MAX_SECONDS * 1000); });
    expect(result.current.state).toBe("idle");
    expect(result.current.blob).toBeNull();
    expect(track.stop).toHaveBeenCalled();
  });

  it("leaving the screen mid-recording lets go of the microphone", async () => {
    const { unmount } = await started();
    expect(track.stop).not.toHaveBeenCalled();
    unmount();
    expect(track.stop).toHaveBeenCalled();
    expect(FakeRecorder.made[0].state).toBe("inactive");
  });

  it("a browser that cannot record says so and does nothing", async () => {
    vi.stubGlobal("MediaRecorder", undefined);
    const { result } = await started();
    expect(result.current.supported).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
