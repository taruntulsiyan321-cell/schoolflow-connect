/**
 * Sitting a mock paper: the clock, the palette, the saves, the guess tap, and
 * the two ways a paper ends.
 *
 * The paper fed in is four questions with a 90-second deadline, so the hour
 * running out can actually be reached in a test.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  paper: null as unknown,
  saveError: null as unknown,
  saved: [] as Record<string, unknown>[],
  submitted: 0,
  submitError: null as unknown,
  navigated: [] as unknown[],
  confirm: true,
}));

vi.mock("@/lib/mockTest", async (orig) => {
  const real = await orig<typeof import("@/lib/mockTest")>();
  return {
    ...real,
    fetchMockPaper: () => Promise.resolve(state.paper),
    saveMockAnswer: (input: Record<string, unknown>) => {
      state.saved.push(input);
      return state.saveError ? Promise.reject(state.saveError) : Promise.resolve({ saved: true, deadline: "x" });
    },
    submitMock: () => {
      state.submitted += 1;
      return state.submitError ? Promise.reject(state.submitError) : Promise.resolve({ id: "att" });
    },
  };
});
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useParams: () => ({ id: "att" }),
  useNavigate: () => (to: string, opts?: unknown) => state.navigated.push([to, opts]),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { default: MockAttempt } = await import("./MockAttempt");
const { MockError } = await import("@/lib/mockTest");
const { QuestionRenderer } = await import("@/components/student/QuestionRenderer");

const question = (n: number, over: Record<string, unknown> = {}) => ({
  order: n,
  id: `q${n}`,
  available: true,
  question: `Question number ${n}?`,
  options: ["Alpha", "Beta", "Gamma", "Delta"],
  format: "mcq",
  chapter: `Chapter ${n}`,
  choice: null,
  marked: false,
  guessed: null,
  ...over,
});

function paper(over: Record<string, unknown> = {}) {
  return {
    id: "att",
    paper_id: "paper-1",
    subject: "Mathematics",
    chapter_id: null,
    chapter: null,
    started_at: new Date().toISOString(),
    deadline: new Date(Date.now() + 90_000).toISOString(),
    submitted_at: null,
    total: 4,
    seen_before: 0,
    marks_correct: 4,
    marks_wrong: -2,
    max_score: 16,
    questions: [question(1), question(2), question(3), question(4)],
    ...over,
  };
}

const draw = () => render(<MemoryRouter><MockAttempt /></MemoryRouter>);

beforeEach(() => {
  state.paper = paper();
  state.saveError = null;
  state.saved = [];
  state.submitted = 0;
  state.submitError = null;
  state.navigated = [];
  state.confirm = true;
  vi.spyOn(window, "confirm").mockImplementation(() => state.confirm);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the paper on screen", () => {
  it("shows the clock, the palette and the first question", async () => {
    draw();
    expect(await screen.findByText("Question number 1?")).toBeInTheDocument();
    expect(screen.getByTestId("mock-clock").textContent).toMatch(/01:2\d|01:3\d/);
    expect(screen.getAllByRole("button", { name: /^Question \d/ })).toHaveLength(4);
    expect(screen.getByText("0/4 answered")).toBeInTheDocument();
  });

  it("marks no option as the right one while the paper is being sat", async () => {
    const { container } = draw();
    await screen.findByText("Question number 1?");
    // The renderer marks a right option with the accent border, and only in
    // review mode. On a paper being sat there must be none.
    expect(container.querySelectorAll("button.border-accent")).toHaveLength(0);
    expect(document.body.textContent).not.toMatch(/correct answer/i);
  });

  it("CONTROL: the same probe does find one when a reviewed question is drawn", () => {
    const { container } = render(
      <QuestionRenderer
        question={{
          id: "q1", order_index: 1, question_format: "mcq", question: "Question number 1?",
          options: ["Alpha", "Beta", "Gamma", "Delta"], correct: { indexes: [1] }, marks: 4,
        }}
        mode="review"
        value={{ indexes: [0] }}
        isCorrect={false}
      />,
    );
    expect(container.querySelectorAll("button.border-accent").length).toBeGreaterThan(0);
  });

  it("marks the palette by what each question is", async () => {
    state.paper = paper({
      questions: [
        question(1, { choice: 2 }),
        question(2, { marked: true }),
        question(3, { choice: 0, marked: true }),
        question(4, { available: false }),
      ],
    });
    draw();
    await screen.findByText("Question number 1?");
    const states = screen.getAllByRole("button", { name: /^Question \d/ })
      .map((b) => b.getAttribute("data-state"));
    expect(states).toEqual(["answered", "marked", "answered_marked", "unavailable"]);
  });

  it("says a withdrawn question carries no marks, and offers no options", async () => {
    state.paper = paper({ questions: [question(1, { available: false })] });
    draw();
    expect(await screen.findByTestId("mock-question-withdrawn")).toBeInTheDocument();
    expect(screen.queryByText("Alpha")).toBeNull();
  });
});

describe("answering", () => {
  it("saves the option chosen, with the time spent on it, and says so", async () => {
    draw();
    fireEvent.click(await screen.findByText("Beta"));
    await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
    expect(state.saved).toHaveLength(1);
    // Answered with the tap left off: "not a guess", which is a value, not "not said".
    expect(state.saved[0]).toMatchObject({ attempt: "att", question: "q1", choice: 1, marked: false, guessed: false });
    expect(typeof state.saved[0].timeMs).toBe("number");
    expect(screen.getByText("1/4 answered")).toBeInTheDocument();
  });

  it("keeps the choice on screen when the save fails, and says it is not saved", async () => {
    state.saveError = new Error("network gone");
    draw();
    fireEvent.click(await screen.findByText("Gamma"));
    await waitFor(() => expect(screen.getByText("Not saved.")).toBeInTheDocument());
    // The answer is NOT taken back: the palette still shows it answered.
    expect(screen.getAllByRole("button", { name: /^Question 1/ })[0].getAttribute("data-state"))
      .toBe("answered");
  });

  it("clears an answer and flags a question for review", async () => {
    draw();
    fireEvent.click(await screen.findByText("Alpha"));
    await waitFor(() => expect(state.saved).toHaveLength(1));
    fireEvent.click(screen.getByText("Clear answer"));
    await waitFor(() => expect(state.saved).toHaveLength(2));
    expect(state.saved[1].choice).toBeNull();
    fireEvent.click(screen.getByText("Mark for review"));
    await waitFor(() => expect(state.saved).toHaveLength(3));
    expect(state.saved[2].marked).toBe(true);
  });

  it("submits when the server says the hour is already over", async () => {
    state.saveError = new MockError("mock_time_is_up", "The hour is over.");
    draw();
    fireEvent.click(await screen.findByText("Delta"));
    await waitFor(() => expect(state.submitted).toBe(1));
    await waitFor(() => expect(state.navigated[0]).toEqual(["/student/mock/att/result", { replace: true }]));
  });
});

describe("the guess tap", () => {
  const tap = () => screen.getByRole("button", { name: "I'm guessing" });

  it("marks an answer as a guess, saved with the answer", async () => {
    draw();
    fireEvent.click(await screen.findByText("Beta"));
    await waitFor(() => expect(state.saved).toHaveLength(1));
    expect(tap()).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(tap());
    await waitFor(() => expect(state.saved).toHaveLength(2));
    expect(state.saved[1]).toMatchObject({ question: "q1", choice: 1, guessed: true });
    expect(tap()).toHaveAttribute("aria-pressed", "true");
    // And off again.
    fireEvent.click(tap());
    await waitFor(() => expect(state.saved).toHaveLength(3));
    expect(state.saved[2]).toMatchObject({ choice: 1, guessed: false });
  });

  it("tapped before answering, saves nothing on its own and goes with the answer", async () => {
    draw();
    await screen.findByText("Question number 1?");
    fireEvent.click(tap());
    expect(tap()).toHaveAttribute("aria-pressed", "true");
    // Nothing is saving, and once every queued save has had its turn, nothing was sent.
    expect(screen.queryByText("Saving…")).toBeNull();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(state.saved).toHaveLength(0);
    fireEvent.click(screen.getByText("Gamma"));
    await waitFor(() => expect(state.saved).toHaveLength(1));
    expect(state.saved[0]).toMatchObject({ choice: 2, guessed: true });
  });

  it("is cleared with the answer — a blank is no guess", async () => {
    draw();
    await screen.findByText("Question number 1?");
    fireEvent.click(tap());
    fireEvent.click(screen.getByText("Alpha"));
    await waitFor(() => expect(state.saved).toHaveLength(1));
    fireEvent.click(screen.getByText("Clear answer"));
    await waitFor(() => expect(state.saved).toHaveLength(2));
    expect(state.saved[1]).toMatchObject({ choice: null, guessed: null });
    expect(tap()).toHaveAttribute("aria-pressed", "false");
  });

  it("shows a guess saved earlier, and is not offered on a withdrawn question", async () => {
    state.paper = paper({ questions: [question(1, { choice: 1, guessed: true }), question(2, { available: false })] });
    draw();
    await screen.findByText("Question number 1?");
    expect(tap()).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: /^Question 2/ }));
    await screen.findByTestId("mock-question-withdrawn");
    expect(screen.queryByRole("button", { name: "I'm guessing" })).toBeNull();
  });
});

describe("the two ways a paper ends", () => {
  it("asks before submitting, naming what is unanswered", async () => {
    draw();
    fireEvent.click(await screen.findByText("Beta"));
    fireEvent.click(screen.getByRole("button", { name: /Submit the paper/ }));
    const asked = (window.confirm as unknown as { mock: { calls: string[][] } }).mock.calls.at(-1)![0];
    expect(asked).toContain("3 questions unanswered");
    expect(asked).toContain("You cannot reopen this paper.");
    await waitFor(() => expect(state.submitted).toBe(1));
  });

  it("does not submit when the student says no", async () => {
    state.confirm = false;
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /Submit the paper/ }));
    expect(state.submitted).toBe(0);
  });

  it("submits itself when the clock runs out, asking nobody", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.paper = paper({ deadline: new Date(Date.now() + 1_200).toISOString() });
    draw();
    await screen.findByText("Question number 1?");
    await act(async () => {
      vi.advanceTimersByTime(2_500);
    });
    await waitFor(() => expect(state.submitted).toBe(1));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(state.navigated.at(-1)).toEqual(["/student/mock/att/result", { replace: true }]);
  });

  it("submits once, however many times the clock ticks past zero", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.paper = paper({ deadline: new Date(Date.now() + 500).toISOString() });
    draw();
    await screen.findByText("Question number 1?");
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    await waitFor(() => expect(state.submitted).toBe(1));
    expect(state.submitted).toBe(1);
  });

  it("goes straight to the result for a paper that is already marked", async () => {
    state.paper = paper({ submitted_at: new Date().toISOString() });
    draw();
    await waitFor(() =>
      expect(state.navigated[0]).toEqual(["/student/mock/att/result", { replace: true }]),
    );
  });
});
