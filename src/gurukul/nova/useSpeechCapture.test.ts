import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { mergeFinals, useSpeechCapture, type RecognitionLike } from "./useSpeechCapture";

/**
 * A stand-in for the browser's SpeechRecognition that the test drives by hand:
 * `say` delivers results, `endOnItsOwn` is the browser ending a session the
 * student did not stop (Android does this after a short pause).
 */
class FakeRecognition implements RecognitionLike {
  static all: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: RecognitionLike["onresult"] = null;
  onerror: RecognitionLike["onerror"] = null;
  onend: RecognitionLike["onend"] = null;
  started = false;
  constructor() {
    FakeRecognition.all.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    // A real browser delivers onend after stop(), asynchronously.
    setTimeout(() => this.onend?.(), 0);
  }
  abort() {
    this.onend?.();
  }
  say(results: [string, boolean][], resultIndex = 0) {
    this.onresult?.({
      resultIndex,
      results: results.map(([t, isFinal]) => ({ isFinal, 0: { transcript: t }, length: 1 })),
    });
  }
  fail(error: string) {
    this.onerror?.({ error });
  }
  endOnItsOwn() {
    this.onend?.();
  }
}

const latest = () => FakeRecognition.all[FakeRecognition.all.length - 1];

function setup(extra: Partial<Parameters<typeof useSpeechCapture>[0]> = {}) {
  const onDone = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(() => useSpeechCapture({ onDone, onError, silenceMs: 3500, startSilenceMs: 9000, ...extra }));
  return { hook, onDone, onError };
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeRecognition.all = [];
  (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
});
afterEach(() => {
  vi.useRealTimers();
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
});

describe("mergeFinals", () => {
  it("replaces a cumulative final and keeps separate ones", () => {
    expect(mergeFinals(["the", "The hypotenuse", "the hypotenuse is longest", "and a squared"])).toEqual([
      "the hypotenuse is longest",
      "and a squared",
    ]);
    expect(mergeFinals(["first part", "second part", " "])).toEqual(["first part", "second part"]);
  });
});

describe("useSpeechCapture", () => {
  it("reports unsupported when the browser has no speech recognition", () => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    const { hook } = setup();
    expect(hook.result.current.supported).toBe(false);
  });

  it("configures the recogniser for continuous Indian English", () => {
    const { hook } = setup();
    act(() => hook.result.current.start());
    expect(hook.result.current.listening).toBe(true);
    expect(latest()).toMatchObject({ lang: "en-IN", continuous: true, interimResults: true, started: true });
  });

  it("sends the answer on its own after the student stops talking — and not before", () => {
    const { hook, onDone } = setup();
    act(() => hook.result.current.start());
    act(() => latest().say([["it only works for right triangles", true], ["and the", false]]));
    expect(hook.result.current.transcript).toBe("it only works for right triangles and the");

    // A two-second pause to think does not end the answer.
    act(() => vi.advanceTimersByTime(2000));
    act(() => latest().say([["it only works for right triangles", true], ["and the hypotenuse is longest", true]]));
    act(() => vi.advanceTimersByTime(3000));
    expect(onDone).not.toHaveBeenCalled();

    // 3.5 s of silence after the last word does.
    act(() => vi.advanceTimersByTime(600));
    expect(onDone).toHaveBeenCalledWith("it only works for right triangles and the hypotenuse is longest");
    expect(hook.result.current.listening).toBe(false);
  });

  it("sends immediately when the student taps finish", () => {
    const { hook, onDone } = setup();
    act(() => hook.result.current.start());
    act(() => latest().say([["photosynthesis makes food from light", true]]));
    act(() => hook.result.current.finish());
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledWith("photosynthesis makes food from light");
  });

  it("keeps listening through a session the browser ended on its own, and keeps the words", () => {
    const { hook, onDone } = setup();
    act(() => hook.result.current.start());
    act(() => latest().say([["the formula is a squared", true]]));
    act(() => latest().endOnItsOwn());
    expect(FakeRecognition.all).toHaveLength(2);
    expect(hook.result.current.listening).toBe(true);
    expect(onDone).not.toHaveBeenCalled();

    act(() => latest().say([["plus b squared", true]]));
    act(() => hook.result.current.finish());
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledWith("the formula is a squared plus b squared");
  });

  it("does not repeat words when Android reports finals cumulatively", () => {
    const { hook, onDone } = setup();
    act(() => hook.result.current.start());
    act(() => latest().say([["the", true], ["the longest side", true], ["the longest side is the hypotenuse", true]]));
    act(() => hook.result.current.finish());
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledWith("the longest side is the hypotenuse");
  });

  it("reports nothing said when the student stays silent", () => {
    const { hook, onDone, onError } = setup();
    act(() => hook.result.current.start());
    act(() => vi.advanceTimersByTime(9001));
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith("no-speech");
  });

  it("reports a blocked microphone and does not restart", () => {
    const { hook, onError } = setup();
    act(() => hook.result.current.start());
    act(() => latest().fail("not-allowed"));
    act(() => latest().endOnItsOwn());
    expect(FakeRecognition.all).toHaveLength(1);
    expect(onError).toHaveBeenCalledWith("denied");
    expect(hook.result.current.listening).toBe(false);
  });

  it("sends nothing after cancel", () => {
    const { hook, onDone, onError } = setup();
    act(() => hook.result.current.start());
    act(() => latest().say([["half an answer", true]]));
    act(() => hook.result.current.cancel());
    act(() => vi.advanceTimersByTime(10_000));
    expect(onDone).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(hook.result.current.listening).toBe(false);
  });
});
