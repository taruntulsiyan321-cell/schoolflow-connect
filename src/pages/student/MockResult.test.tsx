/**
 * A marked mock paper. Every number shown is the server's, so the result is fed
 * a 4-question paper at +4/−2 — nothing here may reconstruct a score.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  result: null as unknown,
  error: null as unknown,
  navigated: [] as unknown[],
}));

vi.mock("@/lib/mockTest", async (orig) => ({
  ...(await orig<typeof import("@/lib/mockTest")>()),
  fetchMockResult: () => (state.error ? Promise.reject(state.error) : Promise.resolve(state.result)),
}));
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useParams: () => ({ id: "att" }),
  useNavigate: () => (to: string, opts?: unknown) => state.navigated.push([to, opts]),
}));

const { default: MockResult } = await import("./MockResult");
const { MockError } = await import("@/lib/mockTest");

const reviewed = (n: number, over: Record<string, unknown> = {}) => ({
  order: n,
  id: `q${n}`,
  available: true,
  question: `Question number ${n}?`,
  options: ["Alpha", "Beta", "Gamma", "Delta"],
  chapter: `Chapter ${n}`,
  topic: `Topic ${n}`,
  explanation: `Because of thing ${n}.`,
  correct: { index: 1, text: "Beta" },
  choice: 1,
  is_correct: true,
  marks: 4,
  time_ms: 5000,
  ...over,
});

function result(over: Record<string, unknown> = {}) {
  return {
    id: "att",
    subject: "Mathematics",
    started_at: "2026-09-27T10:00:00Z",
    submitted_at: "2026-09-27T10:25:00Z",
    auto_submitted: false,
    seconds_taken: 1500,
    total: 4,
    correct: 2,
    wrong: 1,
    unanswered: 1,
    voided: 0,
    score: 6,
    max_score: 16,
    marks_correct: 4,
    marks_wrong: -2,
    questions: [
      reviewed(1),
      reviewed(2),
      reviewed(3, { choice: 0, is_correct: false, marks: -2 }),
      reviewed(4, { choice: null, is_correct: null, marks: 0 }),
    ],
    ...over,
  };
}

const draw = () => render(<MemoryRouter><MockResult /></MemoryRouter>);

beforeEach(() => {
  state.result = result();
  state.error = null;
  state.navigated = [];
});

describe("the score", () => {
  it("is the server's, out of the server's total", async () => {
    draw();
    expect(await screen.findByText("6")).toBeInTheDocument();
    expect(screen.getByText("of 16")).toBeInTheDocument();
    expect(screen.getByText("+4 each")).toBeInTheDocument();
    expect(screen.getByText("-2 each")).toBeInTheDocument();
  });

  it("reports accuracy over what was answered, not over the paper", async () => {
    draw();
    // 2 right of 3 answered = 67%. Over the whole paper it would be 50%.
    expect(await screen.findByText("67%")).toBeInTheDocument();
    expect(screen.queryByText("50%")).toBeNull();
  });

  it("has no accuracy at all when nothing was answered", async () => {
    state.result = result({
      correct: 0, wrong: 0, unanswered: 4, score: 0,
      questions: [reviewed(1, { choice: null, is_correct: null, marks: 0 })],
    });
    draw();
    await screen.findByText("of 16");
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("says when the hour ended the paper rather than the student", async () => {
    state.result = result({ auto_submitted: true });
    draw();
    expect(await screen.findByText(/Submitted when the hour ran out\./)).toBeInTheDocument();
  });
});

describe("the review", () => {
  it("shows the right answer, the student's own, and why", async () => {
    draw();
    await screen.findByText("Question number 1?");
    expect(screen.getByText("Because of thing 1.")).toBeInTheDocument();
    expect(screen.getAllByText("Beta").length).toBeGreaterThan(0);
    // A question left blank says so.
    expect(screen.getByText("You left this one blank.")).toBeInTheDocument();
  });

  it("filters to the wrong ones, the blank ones and the right ones", async () => {
    draw();
    await screen.findByText("Question number 1?");
    fireEvent.click(screen.getByRole("button", { name: "Wrong" }));
    expect(screen.getByText("Question number 3?")).toBeInTheDocument();
    expect(screen.queryByText("Question number 1?")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Left blank" }));
    expect(screen.getByText("Question number 4?")).toBeInTheDocument();
    expect(screen.queryByText("Question number 3?")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Right" }));
    expect(screen.getByText("Question number 1?")).toBeInTheDocument();
    expect(screen.queryByText("Question number 4?")).toBeNull();
  });

  it("explains a withdrawn question instead of drawing an empty one", async () => {
    state.result = result({
      voided: 1,
      questions: [reviewed(1, { available: false, question: null, options: [], correct: null, is_correct: null, marks: 0 })],
    });
    draw();
    expect(await screen.findByTestId("mock-voided-note")).toHaveTextContent(
      "One question was withdrawn from the bank after your paper was made. It carried no marks either way.",
    );
    expect(screen.getByText(/withdrawn from the bank, so it cannot be reviewed/)).toBeInTheDocument();
  });

  it("says nothing about withdrawn questions when there were none", async () => {
    draw();
    await screen.findByText("Question number 1?");
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
  });

  it("shows any other failure as a failure", async () => {
    state.error = new MockError("mock_attempt_not_found", "That paper could not be found.");
    draw();
    expect(await screen.findByText("That paper could not be found.")).toBeInTheDocument();
    expect(state.navigated).toEqual([]);
  });
});
