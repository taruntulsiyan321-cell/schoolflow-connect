/**
 * AI Coach voice (2026-10-02): the mic dictates into the message box through
 * the browser's own speech recognition. It was a "Coming Soon" toast. The
 * words are put in the box to check, never sent on their own, and the mic is
 * not offered where the browser has no recognition.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { RecognitionLike } from "@/gurukul/nova/useSpeechCapture";

const askAiCoach = vi.hoisted(() => vi.fn());
const toastMessage = vi.hoisted(() => vi.fn());

vi.mock("@/academic/ai/gatewayClient", async (orig) => ({
  ...(await orig<typeof import("@/academic/ai/gatewayClient")>()),
  askAiCoach,
}));
vi.mock("sonner", () => ({ toast: { message: toastMessage, success: vi.fn(), error: vi.fn() } }));
vi.mock("@/hooks/usePremiumStatus", () => ({ premiumChanged: vi.fn(), usePremiumStatus: () => ({ status: null }) }));
vi.mock("@/gurukul/StudentContext", () => ({
  useGurukulStudent: () => ({ name: "Riya Verma" }),
  useGurukulAcademicIdentity: () => ({ schoolKind: "individual", examName: "CUET", examCode: "cuet" }),
}));
vi.mock("@/academic/hooks/useAcademicContext", () => ({
  useAcademicContext: () => ({ studentId: "s1", schoolId: "sch1", ctx: null, ready: true }),
}));
vi.mock("@/auth", () => ({ useAuth: () => ({ user: { id: "u1" }, role: "student" }) }));
vi.mock("@/gurukul/nova/NovaRevisionMode", () => ({ NovaModeSwitch: () => null, NovaRevisionMode: () => null }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

Element.prototype.scrollIntoView = vi.fn();

/** The browser's SpeechRecognition, driven by hand. */
class FakeRecognition implements RecognitionLike {
  static all: FakeRecognition[] = [];
  lang = "";
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: RecognitionLike["onresult"] = null;
  onerror: RecognitionLike["onerror"] = null;
  onend: RecognitionLike["onend"] = null;
  constructor() { FakeRecognition.all.push(this); }
  start() {}
  stop() { setTimeout(() => this.onend?.(), 0); }
  abort() { this.onend?.(); }
  say(text: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text }, length: 1 }] });
  }
  fail(error: string) { this.onerror?.({ error }); }
}
const latest = () => FakeRecognition.all[FakeRecognition.all.length - 1];
const w = window as unknown as { webkitSpeechRecognition?: unknown };

const { default: AICoach } = await import("./AICoach");
const { CAPTURE_MESSAGES } = await import("@/gurukul/nova/useSpeechCapture");

const show = () => render(<MemoryRouter><AICoach setPage={() => {}} /></MemoryRouter>);
const box = () => screen.getByPlaceholderText(/Ask about a concept/) as HTMLTextAreaElement;

beforeEach(() => {
  localStorage.clear();
  askAiCoach.mockReset();
  toastMessage.mockReset();
  FakeRecognition.all = [];
  w.webkitSpeechRecognition = FakeRecognition;
});
afterEach(() => {
  delete w.webkitSpeechRecognition;
  vi.useRealTimers();
});

describe("AI Coach voice", () => {
  it("dictates into the message box, and does not send it", async () => {
    vi.useFakeTimers();
    show();
    fireEvent.click(screen.getByRole("button", { name: "Speak your question" }));
    expect(screen.getByRole("button", { name: "Stop listening" })).toBeTruthy();
    expect(screen.getByText(/Listening…/)).toBeTruthy();
    act(() => latest().say("what is goodwill"));
    expect(screen.getByText("“what is goodwill”")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop listening" }));
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(box().value).toBe("what is goodwill");
    expect(askAiCoach).not.toHaveBeenCalled();
  });

  it("adds to what is already typed", async () => {
    vi.useFakeTimers();
    show();
    fireEvent.change(box(), { target: { value: "In accountancy," } });
    fireEvent.click(screen.getByRole("button", { name: "Speak your question" }));
    act(() => latest().say("what is goodwill"));
    fireEvent.click(screen.getByRole("button", { name: "Stop listening" }));
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(box().value).toBe("In accountancy, what is goodwill");
  });

  it("says why when the microphone is blocked", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Speak your question" }));
    act(() => { latest().fail("not-allowed"); latest().onend?.(); });
    expect(toastMessage).toHaveBeenCalledWith(CAPTURE_MESSAGES.denied);
  });

  it("offers no mic, and no 'Coming Soon', where the browser cannot listen", () => {
    delete w.webkitSpeechRecognition;
    show();
    expect(screen.queryByRole("button", { name: "Speak your question" })).toBeNull();
    expect(document.body.innerHTML).not.toMatch(/Coming Soon/i);
    // CONTROL: the same page with recognition does offer it.
    w.webkitSpeechRecognition = FakeRecognition;
    show();
    expect(screen.getByRole("button", { name: "Speak your question" })).toBeTruthy();
  });
});
