import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { PracticeSessionResultState } from "@/lib/practiceSessionSnapshot";

/**
 * The session's analysis as the student reads it (owner, 2026-10-03): filed in
 * four tabs — Summary, Topics, Time, Questions — from a session played on this
 * device and the server's context (the paper, the last session on the chapter,
 * earlier answers). Every expected figure below is worked by hand.
 */

const ctx = vi.hoisted(() => ({ value: null as unknown, fail: false }));
vi.mock("@/lib/sessionAnalysisContext", () => ({
  fetchSessionAnalysisContext: () => (ctx.fail ? Promise.reject(new Error("offline")) : Promise.resolve(ctx.value)),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/academic", () => ({ useAcademicContext: () => ({ ctx: null, ready: false }), PracticeService: {} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/components/learn/ExplainPanel", () => ({ ExplainPanel: () => null }));
vi.mock("@/components/student/ConceptRecoveryReport", () => ({ ConceptRecoveryReport: () => <div data-testid="concept-report" /> }));
vi.mock("@/components/MathText", () => ({ MathText: ({ text }: { text: string }) => <span>{text}</span> }));

import PracticeSessionResult from "./PracticeSessionResult";

const SESSION = "6f1d1d2a-1111-4c2b-9a3e-000000000001";

function show(state: PracticeSessionResultState) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: `/student/practice/session/${SESSION}/result`, state }]}>
      <Routes>
        <Route path="/student/practice/session/:id/result" element={<PracticeSessionResult />} />
      </Routes>
    </MemoryRouter>,
  );
}

type Q = PracticeSessionResultState["attempts"][number];
const q = (i: number, over: Partial<Q> = {}): Q => ({
  question: `Question ${i}`, options: ["A", "B", "C", "D"], correctIndex: 0, selectedIndex: 0, isCorrect: true,
  topic: "Goodwill", difficulty: "medium", timeTakenMs: 40_000, bankQuestionId: `b${i}`, ...over,
});

// Ten questions. Goodwill: 5 asked, 5 right. Ratio: 5 asked, 2 right, 3 wrong —
// Q8 in 10 s (rushed), Q9 in 90 s (stuck). Times: median 40 s, 42 s on average.
const STATE = {
  subject: "Accountancy",
  chapter: "Admission of a Partner",
  attempts: [
    q(1), q(2), q(3), q(4), q(5),
    q(6, { topic: "Ratio" }),
    q(7, { topic: "Ratio" }),
    q(8, { topic: "Ratio", isCorrect: false, selectedIndex: 1, timeTakenMs: 10_000 }),
    q(9, { topic: "Ratio", isCorrect: false, selectedIndex: 1, timeTakenMs: 90_000 }),
    q(10, { topic: "Ratio", isCorrect: false, selectedIndex: 2 }),
  ],
} as PracticeSessionResultState;

// Last time on this chapter: five Ratio questions, four right, 30 s each.
// Before this session: Q1 was answered wrong (now right — fixed), Q8 wrong (wrong again).
const CONTEXT = {
  paper: { questions: 50, minutes: 60, marks_correct: 5, marks_wrong: -1 },
  previous: {
    finishedAt: "2026-10-01T10:00:00Z",
    attempts: Array.from({ length: 5 }, (_, i) => ({ topic: "Ratio", isCorrect: i < 4, skipped: false, timedOut: false, timeMs: 30_000, excluded: false })),
  },
  earlier: [
    { bankQuestionId: "b8", isCorrect: false, skipped: false },
    { bankQuestionId: "b1", isCorrect: false, skipped: false },
  ],
};

// jsdom has no layout, so no scrollIntoView; record where the page was sent.
let scrolledTo: string[] = [];
Element.prototype.scrollIntoView = function (this: Element) { scrolledTo.push(this.id); };

const tab = (name: string) => fireEvent.click(screen.getByRole("tab", { name }));

beforeEach(() => {
  sessionStorage.clear();
  scrolledTo = [];
  ctx.value = CONTEXT;
  ctx.fail = false;
});

describe("Summary: the session at a glance", () => {
  it("the real paper's marks: +5 right, −1 wrong", async () => {
    show(STATE);
    const marks = await screen.findByTestId("summary-marks");
    expect(marks).toHaveTextContent("32 / 50 marks"); // 7 × 5 − 3 × 1, out of 10 × 5
    expect(marks).toHaveTextContent("+5 for each of 7 right, −1 for each of 3 wrong, 0 for 0 questions left");
  });

  it("since the last session on this chapter: right, pace, and each topic both asked", async () => {
    show(STATE);
    const c = await screen.findByTestId("summary-comparison");
    expect(c).toHaveTextContent("4/5 · 80% → 7/10 · 70%");
    expect(c).toHaveTextContent("−10 points");
    expect(c).toHaveTextContent("30s → 42s");
    expect(c).toHaveTextContent("12 s slower");
    const row = within(within(c).getByTestId("comparison-topics")).getByText("Ratio").closest("tr")!;
    expect(row).toHaveTextContent("Ratio4/5 · 80%2/5 · 40%");
  });

  it("the questions met before, and the one thing to do next", async () => {
    show(STATE);
    const met = await screen.findByTestId("summary-met-before");
    expect(within(met).getByRole("button", { name: "Fixed since last time: 1" })).toBeInTheDocument();
    expect(within(met).getByRole("button", { name: "Wrong again: 1" })).toBeInTheDocument();
    const next = screen.getByTestId("summary-next");
    expect(next).toHaveTextContent("Ratio cost you 3 of 5 answers.");
    expect(within(next).getByRole("link", { name: "Practise Ratio" }))
      .toHaveAttribute("href", "/student/practice?subject=Accountancy&chapter=Admission+of+a+Partner&topic=Ratio");
  });

  it("without the server's context: the session alone — no marks, no claim of a first session", async () => {
    ctx.fail = true;
    show(STATE);
    await screen.findByTestId("summary-score");
    await waitFor(() => expect(screen.queryByTestId("summary-marks")).toBeNull());
    expect(screen.queryByTestId("summary-comparison")).toBeNull();
    expect(screen.queryByText(/first session/)).toBeNull();
  });
});

describe("Topics: where the marks went", () => {
  it("weakest first, and a way to practise only what went wrong", async () => {
    show(STATE);
    tab("Topics");
    const rows = within(await screen.findByTestId("topics-by-topic")).getAllByTestId("breakdown-row");
    // Ratio: 2 of 5 right, 3 wrong, (40+40+10+90+40)/5 = 44 s. Goodwill: 5 of 5, 40 s.
    // Nothing was skipped, so there is no Skipped column.
    expect(rows.map((r) => r.textContent)).toEqual(["Ratio2/5340%44sPractise", "Goodwill5/50100%40s"]);
    expect(within(screen.getByTestId("topics-by-topic")).queryByRole("columnheader", { name: "Skipped" })).toBeNull();
    expect(within(rows[0]).getByRole("link", { name: "Practise" }))
      .toHaveAttribute("href", "/student/practice?subject=Accountancy&chapter=Admission+of+a+Partner&topic=Ratio");
    expect(within(rows[1]).queryByRole("link")).toBeNull();
    // Every question was medium and a plain MCQ: nothing to break down by either.
    expect(screen.queryByTestId("topics-by-difficulty")).toBeNull();
    expect(screen.queryByTestId("topics-by-form")).toBeNull();
    expect(screen.getByTestId("concept-report")).toBeInTheDocument();
  });
});

describe("Topics: a skipped question", () => {
  it("brings its column, counted where it was skipped", async () => {
    show({ ...STATE, attempts: [...STATE.attempts, q(11, { topic: "Ratio", isCorrect: false, selectedIndex: -1, skipped: true })] });
    tab("Topics");
    const card = await screen.findByTestId("topics-by-topic");
    expect(within(card).getByRole("columnheader", { name: "Skipped" })).toBeInTheDocument();
    // Ratio: 6 asked, 5 answered, 2 right, 3 wrong, 1 skipped.
    expect(within(card).getAllByTestId("breakdown-row").map((r) => r.textContent))
      .toEqual(["Ratio2/53140%44sPractise", "Goodwill5/500100%40s"]);
  });
});

describe("Time: how the time went", () => {
  it("usual time against the paper, rushed and stuck answers, and the second half giving way", async () => {
    show(STATE);
    tab("Time");
    const pace = await screen.findByTestId("time-pace");
    expect(pace).toHaveTextContent("Your usual time per answer40s");
    expect(pace).toHaveTextContent("The real paper allows72s");
    expect(pace).toHaveTextContent("1 answer of 10 took longer than the paper allows.");
    expect(within(screen.getByTestId("time-careless")).getByRole("button", { name: "Q8" })).toBeInTheDocument();
    expect(within(screen.getByTestId("time-stuck")).getByRole("button", { name: "Q9" })).toBeInTheDocument();
    expect(screen.queryByTestId("time-slowRight")).toBeNull();
    // Q1–5 all right; Q6–10 two of five.
    const halves = screen.getByTestId("time-halves");
    expect(halves).toHaveTextContent("First half5/5 · 100%40s per answer");
    expect(halves).toHaveTextContent("Second half2/5 · 40%44s per answer");
    expect(screen.getByTestId("time-gave-way")).toHaveTextContent("fell by 60 points in the second half");
  });

  it("a question chip opens that question", async () => {
    show(STATE);
    tab("Time");
    fireEvent.click(within(await screen.findByTestId("time-stuck")).getByRole("button", { name: "Q9" }));
    expect(screen.getByRole("tab", { name: "Questions" })).toHaveAttribute("aria-selected", "true");
    // All ten are listed, and the page is taken to the ninth.
    expect(screen.getAllByTestId("session-question")).toHaveLength(10);
    expect(scrolledTo).toEqual(["question-9"]);
  });
});

describe("Questions: filtered to what the analysis found", () => {
  it("each filter shows its questions, and each card says what stood out", async () => {
    show(STATE);
    tab("Questions");
    const group = await screen.findByRole("group", { name: "Show questions" });
    expect(within(group).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "All (10)", "Wrong (3)", "Rushed (1)", "Stuck (1)", "Fixed since last time (1)", "Wrong again (1)",
    ]);
    fireEvent.click(within(group).getByRole("button", { name: "Rushed (1)" }));
    const cards = screen.getAllByTestId("session-question");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("Question 8");
    expect(cards[0]).toHaveTextContent("Rushed");
    expect(cards[0]).toHaveTextContent("Wrong again");
  });

  it("the right answer is drawn as right — never in the rose of a wrong one", async () => {
    show(STATE);
    tab("Questions");
    const card = (await screen.findByText("Question 8")).closest("[data-testid='session-question']") as HTMLElement;
    const right = within(card).getByTestId("option-right");
    expect(right.className).toContain("bg-success/10");
    expect(right.className).not.toContain("accent");
    expect(within(card).getByTestId("option-chosen-wrong").className).toContain("bg-destructive/10");
  });
});

describe("Guesses: the \"I'm guessing\" tap", () => {
  // Q1 marked as a guess and right (lucky); Q8 marked and wrong; Q9 and Q10
  // wrong without a guess; every other answer given without one.
  const tapped = (guessAt: number[] = [1, 8]) => ({
    ...STATE,
    attempts: STATE.attempts.map((a, i) => ({ ...a, confidence: guessAt.includes(i + 1) ? 0 : 1 })),
  }) as PracticeSessionResultState;

  it("says what the guesses came to, and opens each kind", async () => {
    show(tapped());
    const card = await screen.findByTestId("summary-guesses");
    // 1 right × +5, 1 wrong × −1.
    expect(card).toHaveTextContent("2 answers marked as a guess: 1 right, 1 wrong, which came to +4 marks on the real paper.");
    expect(within(card).getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Lucky guess: 1", "Wrong, not a guess: 2", "Guessed wrong: 1",
    ]);
    fireEvent.click(within(card).getByRole("button", { name: "Lucky guess: 1" }));
    const cards = screen.getAllByTestId("session-question");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("Question 1");
    expect(cards[0]).toHaveTextContent("Lucky guess");
  });

  it("files the guesses among the Questions tab's filters", async () => {
    show(tapped());
    tab("Questions");
    const group = await screen.findByRole("group", { name: "Show questions" });
    const labels = within(group).getAllByRole("button").map((b) => b.textContent);
    expect(labels.slice(-3)).toEqual(["Lucky guess (1)", "Guessed wrong (1)", "Wrong, not a guess (2)"]);
  });

  it("says the right guesses are in the Mistake Book (C2), and only when there are any", async () => {
    show(tapped([1, 2, 8]));
    expect(await screen.findByTestId("summary-lucky-to-book"))
      .toHaveTextContent("The 2 right by a guess are in your Mistake Book, so recovery and revision will ask them again.");
  });

  it("one mark is a mark: a single wrong guess came to −1 mark", async () => {
    show(tapped([8]));
    expect(await screen.findByTestId("summary-guesses"))
      .toHaveTextContent("1 answer marked as a guess: 0 right, 1 wrong, which came to −1 mark on the real paper.");
    // CONTROL: no right guess, so nothing is said of the Mistake Book.
    expect(screen.queryByTestId("summary-lucky-to-book")).toBeNull();
  });

  it("offered and never used: a word on what the tap is for, and no verdict on the wrong answers", async () => {
    show(tapped([]));
    const card = await screen.findByTestId("summary-guesses");
    expect(card).toHaveTextContent("You marked no answer as a guess.");
    expect(within(card).queryByRole("button")).toBeNull();
    tab("Questions");
    expect(screen.queryByRole("button", { name: /Wrong, not a guess/ })).toBeNull();
  });

  it("a session from before the tap says nothing about guesses", async () => {
    show(STATE);
    await screen.findByTestId("summary-score");
    await waitFor(() => expect(screen.queryByTestId("summary-marks")).not.toBeNull());
    expect(screen.queryByTestId("summary-guesses")).toBeNull();
  });
});
