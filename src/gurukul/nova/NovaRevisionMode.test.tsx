import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CONTRACT_ERROR } from "./novaRevisionClient";

/**
 * Revision mode end to end, against the edge function's real response shapes.
 * The network is the only thing faked: `invoke` answers from a queue and
 * records every request, so each test asserts both what the student sees and
 * what was sent.
 */

const invoke = vi.fn();
vi.mock("@/lib/edgeFunction", () => ({ invokeEdgeFunction: (...a: unknown[]) => invoke(...a) }));
vi.mock("@/gurukul/StudentContext", async () => {
  const { EMPTY_STUDENT } = await import("@/gurukul/emptyStudent");
  const value = { ...EMPTY_STUDENT, class: "Class 10-A" };
  return { useGurukulStudent: () => value };
});
vi.mock("@/academic", () => {
  const value = { ctx: { schoolId: "s", userId: "u" }, ready: true, settled: true };
  // The student's own chapters, as the practice catalog lists them.
  const rows = [{ subject: "Business Studies", chapter: "Planning", questions: 40 }];
  return {
    useAcademicContext: () => value,
    PracticeService: { listBankCatalog: () => Promise.resolve({ rows }) },
  };
});
vi.mock("@/gurukul/pages/useRevisionQueueV2", async (importOriginal) => {
  // The real due rule; only the read is faked.
  const { isRevisionDue } = await importOriginal<typeof import("@/gurukul/pages/useRevisionQueueV2")>();
  const items = [
    { chapter: "Triangles", subject: "Mathematics", dueIn: "3 days" },
    { chapter: "Light - Reflection and Refraction", subject: "Science", dueIn: "Now" },
  ];
  return { isRevisionDue, useRevisionItems: () => ({ items: { status: "ready", items }, reload: () => {} }) };
});
vi.mock("@/hooks/useConceptMastery", () => {
  // One concept missed, one mastered: only the missed one is offered.
  const items = [
    { subject: "Science", concept: "Ohm's law", mastery_score: 35, mistake_count: 3, total_attempts: 6, correct_attempts: 2, recovery_attempts: 0 },
    { subject: "Mathematics", concept: "Similar Triangles", mastery_score: 92, mistake_count: 0, total_attempts: 9, correct_attempts: 9, recovery_attempts: 0 },
  ];
  return { useConceptMastery: () => ({ items, loading: false, error: null }) };
});
import { NovaRevisionMode } from "./NovaRevisionMode";

const GIST = {
  title: "Decision Review System (DRS)",
  one_liner: "DRS lets players challenge an umpire's call using technology.",
  what_is_it: "It uses cameras and ball-tracking to check a decision.",
  key_points: [
    { heading: "Players can challenge calls", detail: "Each team gets limited reviews per innings." },
    { heading: "Ball-tracking predicts the path", detail: "Hawk-Eye projects where the ball would have gone." },
    { heading: "Umpire's call", detail: "Marginal cases stay with the on-field decision." },
  ],
  examples: ["An LBW appeal overturned on review."],
  opening_question: "Explain what DRS is in your own words. You could say: 'DRS is a system that…'",
};

const ok = (data: unknown) => Promise.resolve({ data, error: null, usedFallback: false });
const fail = (error: string) => Promise.resolve({ data: null, error, usedFallback: false });

function turn(over: Record<string, unknown>) {
  return ok({
    turn: { feedback: "Good start.", explained: [], covered: [], misconception: null, next_question: "Why?", complete: false, ...over },
  });
}

async function openGist(topic = "How cricket DRS works") {
  invoke.mockReturnValueOnce(ok({ gist: GIST }));
  render(<NovaRevisionMode />);
  fireEvent.change(screen.getByLabelText("Topic to revise"), { target: { value: topic } });
  fireEvent.click(screen.getByRole("button", { name: "Start revising" }));
  await screen.findByRole("heading", { name: GIST.title });
}

async function startTest() {
  await openGist();
  fireEvent.click(screen.getByRole("button", { name: /Start Feynman Test/ }));
  await screen.findByText(GIST.opening_question);
}

/**
 * The browser's speech recognition, driven by hand. `speak` is a student
 * tapping the mic, saying `text`, and tapping to finish.
 */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  lang = ""; continuous = false; interimResults = false; maxAlternatives = 0;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() { FakeRecognition.last = this; }
  start() {}
  stop() { setTimeout(() => this.onend?.(), 0); }
  abort() { this.onend?.(); }
  hear(text: string) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: text }, length: 1 }] });
  }
}
const setMic = (on: boolean) => {
  const w = window as unknown as { webkitSpeechRecognition?: unknown };
  if (on) w.webkitSpeechRecognition = FakeRecognition;
  else delete w.webkitSpeechRecognition;
};

async function speak(text: string) {
  fireEvent.click(screen.getByRole("button", { name: "Start answering" }));
  act(() => FakeRecognition.last?.hear(text));
  fireEvent.click(screen.getByRole("button", { name: "Finish answer" }));
  await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
}

beforeEach(() => {
  invoke.mockReset();
  setMic(true);
});
afterEach(() => setMic(false));

describe("Revision mode — choosing a topic", () => {
  it("offers the student's own revision chapters, due first, and their missed concepts", () => {
    render(<NovaRevisionMode />);
    const chapters = screen.getByText("Your revision chapters").parentElement as HTMLElement;
    const buttons = within(chapters).getAllByRole("button").map((b) => b.textContent);
    expect(buttons).toEqual(["Light - Reflection and Refraction · Science · due", "Triangles · Mathematics"]);
    expect(screen.getByRole("button", { name: "Ohm's law" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Similar Triangles" })).toBeNull();
  });

  it("sends any topic, with the student's class, and shows the gist", async () => {
    await openGist("How cricket DRS works");
    expect(invoke).toHaveBeenCalledWith(
      "ai-nova-revision",
      { mode: "gist", topic: "How cricket DRS works", subject: "", grade: "Class 10-A", style: "standard" },
      expect.objectContaining({ timeoutMs: 60_000 }),
    );
    expect(screen.getByText(GIST.one_liner)).toBeInTheDocument();
    expect(screen.getByText("These 3 are what you'll explain back to Nova.")).toBeInTheDocument();
    for (const p of GIST.key_points) expect(screen.getByText(p.heading)).toBeInTheDocument();
    expect(screen.getByText(GIST.examples[0])).toBeInTheDocument();
  });

  it("a revision chapter chip starts straight away and carries its subject", async () => {
    invoke.mockReturnValueOnce(ok({ gist: GIST }));
    render(<NovaRevisionMode />);
    fireEvent.click(screen.getByRole("button", { name: /^Triangles/ }));
    await screen.findByRole("heading", { name: GIST.title });
    expect(invoke.mock.calls[0][1]).toMatchObject({ topic: "Triangles", subject: "Mathematics" });
  });

  it("a typed topic that is one of the student's chapters carries its subject", async () => {
    // Measured 2026-09-25: "Planning" typed by a CUET Business Studies student
    // was sent with no subject and came back as planning a road trip.
    invoke.mockReturnValueOnce(ok({ gist: GIST }));
    render(<NovaRevisionMode />);
    await act(async () => {}); // the catalog read
    fireEvent.change(screen.getByLabelText("Topic to revise"), { target: { value: "planning" } });
    fireEvent.click(screen.getByRole("button", { name: "Start revising" }));
    await screen.findByRole("heading", { name: GIST.title });
    expect(invoke.mock.calls[0][1]).toMatchObject({ topic: "planning", subject: "Business Studies" });
  });

  it("shows the server's refusal on the picker and stays there", async () => {
    invoke.mockReturnValueOnce(fail("Nova can't help with that topic here. Try a different one."));
    render(<NovaRevisionMode />);
    fireEvent.change(screen.getByLabelText("Topic to revise"), { target: { value: "something unsafe" } });
    fireEvent.click(screen.getByRole("button", { name: "Start revising" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nova can't help with that topic here.");
    expect(screen.getByLabelText("Topic to revise")).toHaveValue("something unsafe");
  });

  it("announces what it is loading, and Cancel goes back to the picker without an error", async () => {
    let seenSignal: AbortSignal | undefined;
    invoke.mockImplementationOnce((_n: string, _b: unknown, opts: { signal?: AbortSignal }) => {
      seenSignal = opts.signal;
      return new Promise((resolve) =>
        opts.signal?.addEventListener("abort", () => resolve({ data: null, error: null, usedFallback: false })),
      );
    });
    render(<NovaRevisionMode />);
    fireEvent.change(screen.getByLabelText("Topic to revise"), { target: { value: "Atoms" } });
    fireEvent.click(screen.getByRole("button", { name: "Start revising" }));
    expect(screen.getByRole("status")).toHaveTextContent("Reading up on Atoms…");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(seenSignal?.aborted).toBe(true);
    expect(await screen.findByLabelText("Topic to revise")).toHaveValue("Atoms");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("refuses a gist the screen cannot read instead of rendering a blank one", async () => {
    invoke.mockReturnValueOnce(ok({ gist: { ...GIST, key_points: [] } }));
    render(<NovaRevisionMode />);
    fireEvent.change(screen.getByLabelText("Topic to revise"), { target: { value: "Atoms" } });
    fireEvent.click(screen.getByRole("button", { name: "Start revising" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(CONTRACT_ERROR);
  });
});

describe("Revision mode — the Feynman test", () => {
  it("hides the key ideas until they are explained, then reveals each one", async () => {
    await startTest();
    expect(screen.getByText("0/3 ideas")).toBeInTheDocument();
    expect(screen.getAllByTestId("idea-open").map((e) => e.textContent)).toEqual(["Idea 1", "Idea 2", "Idea 3"]);

    invoke.mockReturnValueOnce(
      turn({
        feedback: "You explained challenges and ball-tracking.",
        explained: [0, 1], covered: [0, 1],
        misconception: "Reviews are limited, not unlimited.",
        next_question: "What happens when a review is very close? You could say: 'Then…'",
      }),
    );
    await speak("players can review as many times as they want and hawk eye tracks the ball");

    await screen.findByText("What happens when a review is very close? You could say: 'Then…'");
    expect(screen.getByText("2/3 ideas")).toBeInTheDocument();
    expect(screen.getAllByTestId("idea-done").map((e) => e.textContent)).toEqual([
      "Players can challenge calls",
      "Ball-tracking predicts the path",
    ]);
    expect(screen.getByText("Reviews are limited, not unlimited.")).toBeInTheDocument();

    const [, body] = invoke.mock.calls[1];
    expect(body).toMatchObject({
      mode: "turn",
      topic: GIST.title,
      grade: "Class 10-A",
      covered: [],
      answer: "players can review as many times as they want and hawk eye tracks the ball",
      history: [{ role: "nova", text: GIST.opening_question }],
    });
  });

  it("has no way to type an answer — only the microphone", async () => {
    await startTest();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(screen.queryByText(/type/i)).toBeNull();
    expect(screen.getByRole("button", { name: "Start answering" })).toBeInTheDocument();
  });

  it("sends what was already covered and the whole conversation, then finishes when every idea is explained", async () => {
    await startTest();
    invoke.mockReturnValueOnce(turn({ explained: [0, 1], covered: [0, 1], next_question: "What about close calls?" }));
    await speak("first answer");
    await screen.findByText("What about close calls?");

    invoke.mockReturnValueOnce(turn({ feedback: "Spot on.", explained: [2], covered: [0, 1, 2], complete: true, next_question: "Well done!" }));
    await speak("close calls stay with the umpire");
    await screen.findByText("Well done!");

    expect(invoke.mock.calls[2][1]).toMatchObject({
      covered: [0, 1],
      history: [
        { role: "nova", text: GIST.opening_question },
        { role: "student", text: "first answer" },
        { role: "nova", text: "Good start. What about close calls?" },
      ],
    });
    expect(screen.queryByRole("button", { name: "Start answering" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Every idea explained/ }));
    expect(screen.getByText("You explained every key idea")).toBeInTheDocument();
    expect(screen.getByText("2 answers given")).toBeInTheDocument();
    expect(screen.queryAllByTestId("summary-missed")).toHaveLength(0);
  });

  it("on a failed reply keeps the answer and retries it without repeating it", async () => {
    await startTest();
    invoke.mockReturnValueOnce(fail("Learning service unavailable. Please retry."));
    await speak("my explanation");
    expect(await screen.findByRole("alert")).toHaveTextContent("Learning service unavailable. Please retry.");

    invoke.mockReturnValueOnce(turn({ next_question: "Tell me more." }));
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Tell me more.");
    expect(invoke.mock.calls[2][1]).toMatchObject({ answer: "my explanation", history: [{ role: "nova", text: GIST.opening_question }] });
    expect(screen.getAllByText("my explanation")).toHaveLength(1);
  });

  it("shows a reply the screen cannot read as an error, not as a question", async () => {
    await startTest();
    invoke.mockReturnValueOnce(ok({ turn: { feedback: "x", next_question: "y", explained: [], covered: [7], misconception: null, complete: false } }));
    await speak("answer");
    expect(await screen.findByRole("alert")).toHaveTextContent(CONTRACT_ERROR);
  });

  it("finishing early lists the missed ideas with what to remember", async () => {
    await startTest();
    invoke.mockReturnValueOnce(turn({ explained: [1], covered: [1], next_question: "Next?" }));
    await speak("ball tracking");
    await screen.findByText("Next?");
    fireEvent.click(screen.getByRole("button", { name: "Finish" }));

    expect(screen.getByText("You explained 1 of 3 key ideas")).toBeInTheDocument();
    expect(screen.getAllByTestId("summary-done").map((e) => e.textContent)).toEqual(["Ball-tracking predicts the path"]);
    const missed = screen.getAllByTestId("summary-missed").map((e) => e.textContent);
    expect(missed).toEqual([
      "Players can challenge callsRemember: Each team gets limited reviews per innings.",
      "Umpire's callRemember: Marginal cases stay with the on-field decision.",
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Explain it again/ }));
    expect(await screen.findByText("0/3 ideas")).toBeInTheDocument();
  });

  it("a blocked microphone says how to fix it and keeps the mic — no keyboard appears", async () => {
    await startTest();
    fireEvent.click(screen.getByRole("button", { name: "Start answering" }));
    act(() => {
      FakeRecognition.last?.onerror?.({ error: "not-allowed" });
      FakeRecognition.last?.onend?.();
    });
    expect(screen.getByText(/Microphone access is blocked/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start answering" })).toBeInTheDocument();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});

describe("Revision mode — a browser that cannot hear", () => {
  it("says so on the picker, and the test offers no mic and no keyboard", async () => {
    setMic(false);
    invoke.mockReturnValueOnce(ok({ gist: GIST }));
    render(<NovaRevisionMode />);
    expect(screen.getByRole("alert")).toHaveTextContent("this browser can't hear you");
    fireEvent.change(screen.getByLabelText("Topic to revise"), { target: { value: "Atoms" } });
    fireEvent.click(screen.getByRole("button", { name: "Start revising" }));
    fireEvent.click(await screen.findByRole("button", { name: /Start Feynman Test/ }));

    expect(screen.getByRole("alert")).toHaveTextContent("Open Gurukul in Chrome, Edge or Safari");
    expect(screen.queryByRole("button", { name: "Start answering" })).toBeNull();
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });
});

describe("Revision mode — stopping talking sends the answer", () => {
  it("sends the spoken answer after a pause, without a tap", async () => {
    await startTest();
    fireEvent.click(screen.getByRole("button", { name: "Start answering" }));
    expect(screen.getByText("Tap to finish — or just stop talking")).toBeInTheDocument();

    invoke.mockReturnValueOnce(turn({ explained: [0], covered: [0], next_question: "And ball-tracking?" }));
    vi.useFakeTimers();
    try {
      act(() => FakeRecognition.last?.hear("teams can challenge the umpire"));
      expect(screen.getByText("teams can challenge the umpire")).toBeInTheDocument();
      await act(async () => { vi.advanceTimersByTime(3600); });
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(2));
    expect(invoke.mock.calls[1][1]).toMatchObject({ answer: "teams can challenge the umpire" });
    await screen.findByText("And ball-tracking?");
  });
});
