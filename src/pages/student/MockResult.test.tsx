/**
 * A marked mock paper, read with practice's four tabs (B5). The score is the
 * server's, so the result is fed a 4-question paper at +4/−2 — nothing here may
 * reconstruct a score from the ruled +5/−1 — and the analysis context comes in
 * the server's own shape (rpc_mock_analysis_context), not pre-read.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  result: null as unknown,
  error: null as unknown,
  context: null as unknown,
  contextFails: false,
  contextAsked: [] as string[],
  navigated: [] as unknown[],
}));

vi.mock("@/lib/mockTest", async (orig) => ({
  ...(await orig<typeof import("@/lib/mockTest")>()),
  fetchMockResult: () => (state.error ? Promise.reject(state.error) : Promise.resolve(state.result)),
  fetchMockAnalysisContext: (attempt: string) => {
    state.contextAsked.push(attempt);
    return state.contextFails ? Promise.reject(new Error("offline")) : Promise.resolve(state.context);
  },
}));
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useParams: () => ({ id: "att" }),
  useNavigate: () => (to: string, opts?: unknown) => state.navigated.push([to, opts]),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/components/student/questionMarks/useQuestionMarks", () => ({
  useQuestionMarks: () => ({ tags: [], marks: new Map(), setMark: vi.fn() }),
}));
vi.mock("@/components/student/questionReports/useQuestionReports", () => ({
  useQuestionReports: () => ({ reports: new Map(), setReport: vi.fn() }),
}));
vi.mock("@/components/learn/ExplainPanel", () => ({ ExplainPanel: () => null }));
vi.mock("@/components/MathText", () => ({ MathText: ({ text }: { text: string }) => <span>{text}</span> }));

const { default: MockResult } = await import("./MockResult");
const { MockError } = await import("@/lib/mockTest");

const reviewed = (n: number, over: Record<string, unknown> = {}) => ({
  order: n,
  id: `q${n}`,
  available: true,
  question: `Question number ${n}?`,
  options: ["Alpha", "Beta", "Gamma", "Delta"],
  format: "mcq",
  chapter: `Chapter ${n}`,
  topic: `Topic ${n}`,
  difficulty: "medium",
  explanation: `Because of thing ${n}.`,
  correct: { index: 1, text: "Beta" },
  choice: 1,
  is_correct: true,
  guessed: false,
  marks: 4,
  time_ms: 5000,
  ...over,
});

// Q1 right but guessed, Q2 right, Q3 wrong, Q4 left blank: 2 × 4 − 1 × 2 = 6 of 16.
function result(over: Record<string, unknown> = {}) {
  return {
    id: "att",
    paper_id: "paper-1",
    subject: "Mathematics",
    chapter_id: null,
    chapter: null,
    started_at: "2026-09-27T10:00:00Z",
    submitted_at: "2026-09-27T10:25:00Z",
    auto_submitted: false,
    seconds_taken: 1500,
    total: 4,
    seen_before: 1,
    correct: 2,
    wrong: 1,
    unanswered: 1,
    voided: 0,
    score: 6,
    max_score: 16,
    marks_correct: 4,
    marks_wrong: -2,
    questions: [
      reviewed(1, { guessed: true }),
      reviewed(2),
      reviewed(3, { choice: 0, is_correct: false, marks: -2 }),
      reviewed(4, { choice: null, is_correct: null, guessed: null, marks: 0 }),
    ],
    ...over,
  };
}

/** The server's reply: the paper's shape, the last paper of the kind, and Q3's earlier answer (wrong). */
function context(over: Record<string, unknown> = {}) {
  return {
    paper: { questions: 4, minutes: 10, marks_correct: 4, marks_wrong: -2 },
    previous: {
      id: "old",
      finished_at: "2026-09-20T10:00:00Z",
      attempts: Array.from({ length: 4 }, (_, i) => ({
        topic: "Topic 1", is_correct: i === 0, skipped: false, timed_out: false, time_taken_ms: 5000, excluded: false,
      })),
    },
    earlier: [{ bank_question_id: "q3", is_correct: false, skipped: false, at: "2026-09-20T10:00:00Z" }],
    ...over,
  };
}

const draw = () => render(<MemoryRouter><MockResult /></MemoryRouter>);
const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));
Element.prototype.scrollIntoView = function () {};

beforeEach(() => {
  state.result = result();
  state.error = null;
  state.context = context();
  state.contextFails = false;
  state.contextAsked = [];
  state.navigated = [];
});

describe("the score", () => {
  it("is the server's, out of the server's total", async () => {
    draw();
    expect(await screen.findByTestId("mock-score")).toHaveTextContent("6 of 16 marks");
  });

  it("is marked on the Summary as the paper marks it, from the paper the server sent", async () => {
    draw();
    const marks = await screen.findByTestId("summary-marks");
    expect(marks).toHaveTextContent("6 / 16 marks");
    expect(marks).toHaveTextContent("+4 for each of 2 right, −2 for each of 1 wrong, 0 for 1 question left");
  });

  it("reports accuracy over what was answered, and no XP — a paper earns none", async () => {
    const { container } = draw();
    const score = await screen.findByTestId("summary-score");
    // 2 right of 3 answered = 67%. Over the whole paper it would be 50%.
    expect(score).toHaveTextContent("Accuracy67%");
    expect(score).toHaveTextContent("Right2/4");
    expect(score).toHaveTextContent("Skipped1");
    expect(within(score).queryByText("XP earned")).toBeNull();
    expect(container.textContent).not.toContain("50%");
  });

  it("has no accuracy at all when nothing was answered", async () => {
    state.result = result({
      correct: 0, wrong: 0, unanswered: 1, score: 0, total: 1, max_score: 4,
      questions: [reviewed(1, { choice: null, is_correct: null, guessed: null, marks: 0 })],
    });
    draw();
    expect(await screen.findByTestId("summary-score")).toHaveTextContent("Accuracy—");
  });

  it("says when the hour ended the paper rather than the student", async () => {
    state.result = result({ auto_submitted: true });
    draw();
    expect(await screen.findByText(/submitted when the hour ran out/)).toBeInTheDocument();
  });

  it("CONTROL: and when the student did", async () => {
    draw();
    expect(await screen.findByText(/submitted by you/)).toBeInTheDocument();
  });
});

describe("Summary: what practice's analysis says of a paper", () => {
  it("reads the guess tap", async () => {
    draw();
    // The card is drawn before the paper's shape arrives; what the guesses came
    // to in marks needs that shape, so it is waited for, not read at first draw.
    await waitFor(() => expect(screen.getByTestId("summary-guesses"))
      .toHaveTextContent("1 answer marked as a guess: 1 right, 0 wrong, which came to +4 marks on the real paper"));
    const g = screen.getByTestId("summary-guesses");
    expect(within(g).getByRole("button", { name: "Lucky guess: 1" })).toBeInTheDocument();
  });

  it("compares with the last paper of the same kind", async () => {
    draw();
    const c = await screen.findByTestId("summary-comparison");
    expect(c).toHaveTextContent(/Since your last Math\w* paper/);
    // Four answers then, three now: below the floor for a percentage on either side.
    expect(c).toHaveTextContent("1/4 → 2/3");
  });

  it("says when this is the first paper of its kind", async () => {
    state.context = context({ previous: null });
    draw();
    expect(await screen.findByTestId("summary-comparison")).toHaveTextContent(/This is your first Math\w* paper\./);
  });

  it("names the questions met before", async () => {
    draw();
    const met = await screen.findByTestId("summary-met-before");
    expect(within(met).getByRole("button", { name: "Wrong again: 1" })).toBeInTheDocument();
  });

  it("asks the context of this attempt, and reads the paper alone without it", async () => {
    state.contextFails = true;
    draw();
    await screen.findByTestId("summary-score");
    expect(state.contextAsked).toEqual(["att"]);
    await waitFor(() => expect(screen.queryByTestId("summary-marks")).toBeNull());
    expect(screen.queryByTestId("summary-comparison")).toBeNull();
    // The server's score does not depend on it.
    expect(screen.getByTestId("mock-score")).toHaveTextContent("6 of 16 marks");
  });
});

describe("Topics: where the marks went", () => {
  it("by chapter on a whole-subject paper, each linking to practice on that chapter", async () => {
    draw();
    await screen.findByTestId("summary-score");
    tab("Topics");
    const byChapter = screen.getByTestId("topics-by-chapter");
    const row = within(byChapter).getByText("Chapter 3").closest("tr")!;
    expect(within(row).getByRole("link", { name: "Practise" }))
      .toHaveAttribute("href", "/student/practice?subject=Mathematics&chapter=Chapter+3");
  });

  it("not by chapter on a chapter paper — it has one", async () => {
    state.result = result({
      chapter_id: "c", chapter: "Matrices",
      questions: result().questions.map((q) => ({ ...q, chapter: "Matrices" })),
    });
    draw();
    await screen.findByTestId("summary-score");
    tab("Topics");
    expect(screen.queryByTestId("topics-by-chapter")).toBeNull();
    // CONTROL: the tab itself is there.
    expect(screen.getByTestId("topics-by-topic")).toBeInTheDocument();
  });
});

describe("Questions: every question with its answer", () => {
  it("shows the right answer and the student's own, filtered by what went wrong", async () => {
    draw();
    await screen.findByTestId("summary-score");
    tab("Questions");
    expect(screen.getAllByTestId("session-question")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: /^Wrong \(/ }));
    expect(screen.getByText("Question number 3?")).toBeInTheDocument();
    expect(screen.queryByText("Question number 1?")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Skipped \(/ }));
    expect(screen.getByText("Question number 4?")).toBeInTheDocument();
    expect(screen.queryByText("Question number 3?")).toBeNull();
  });

  it("explains a withdrawn question instead of drawing an empty one", async () => {
    state.result = result({
      voided: 1,
      questions: [reviewed(1, { available: false, question: null, options: [], correct: null, choice: 2, is_correct: null, marks: 0 })],
    });
    draw();
    expect(await screen.findByTestId("mock-voided-note")).toHaveTextContent(
      "One question was withdrawn from the bank after your paper was made. It carried no marks either way.",
    );
    tab("Questions");
    expect(screen.getByText(/withdrawn from the bank after your paper was made, so it cannot be reviewed/)).toBeInTheDocument();
  });

  it("says nothing about withdrawn questions when there were none", async () => {
    draw();
    await screen.findByTestId("summary-score");
    expect(screen.queryByTestId("mock-voided-note")).toBeNull();
  });
});

describe("a paper that is not marked yet", () => {
  it("sends the student back to it rather than showing an empty result", async () => {
    state.error = new MockError("mock_not_submitted", "This paper has not been submitted yet.");
    draw();
    await waitFor(() =>
      expect(state.navigated[0]).toEqual(["/student/mock/att", { replace: true }]),
    );
    expect(state.contextAsked).toEqual([]);
  });

  it("shows any other failure as a failure", async () => {
    state.error = new MockError("mock_attempt_not_found", "That paper could not be found.");
    draw();
    expect(await screen.findByText("That paper could not be found.")).toBeInTheDocument();
    expect(state.navigated).toEqual([]);
  });
});
