/**
 * The Mock Tests screen offers what the bank can fill — a whole subject or one
 * chapter — says why when it cannot, and tells the student what a paper holds
 * before its clock starts.
 *
 * The catalog it is fed is a 40-question paper at +4/−2 — deliberately not the
 * ruled shape — so anything this screen states from a literal rather than from
 * the server's answer fails here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  catalog: null as unknown,
  catalogReads: 0,
  history: [] as unknown[],
  native: false,
  preview: null as unknown,
  prepareError: null as unknown,
  prepared: [] as Array<[string, string | null]>,
  started: null as unknown,
  startedWith: [] as string[],
  startError: null as unknown,
  chosen: [] as string[][],
  navigated: [] as string[],
  confirm: true,
  toasts: [] as string[],
}));

vi.mock("@/lib/mockTest", async (orig) => ({
  ...(await orig<typeof import("@/lib/mockTest")>()),
  fetchMockCatalog: () => {
    state.catalogReads += 1;
    return Promise.resolve(state.catalog);
  },
  fetchMockHistory: () => Promise.resolve(state.history),
  setExamOption: (subject: string, group: string, option: string) => {
    state.chosen.push([subject, group, option]);
    return Promise.resolve({ label: option });
  },
  prepareMock: (subject: string, chapter: string | null = null) => {
    state.prepared.push([subject, chapter]);
    return state.prepareError ? Promise.reject(state.prepareError) : Promise.resolve(state.preview);
  },
  startMock: (paper: string) => {
    state.startedWith.push(paper);
    return state.startError ? Promise.reject(state.startError) : Promise.resolve(state.started);
  },
}));
vi.mock("sonner", () => ({ toast: { error: (m: string) => state.toasts.push(m), success: vi.fn(), message: vi.fn() } }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => state.native } }));
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => (to: string) => state.navigated.push(to),
}));

const { default: MockTests } = await import("./MockTests");
const { PlanLimitError, planLimitFromDecision } = await import("@/lib/premium");
const { MockError } = await import("@/lib/mockTest");
const { displaySubject } = await import("@/lib/academicDisplay");

const label = (s: string) => displaySubject(s) || s;

/** A paper that is NOT the ruled one, so nothing may hard-code the ruling. */
const PAPER = { questions: 40, minutes: 30, marks_correct: 4, marks_wrong: -2, max_score: 160 };

const ALLOWED = { ok: true, feature: "mock_test.start", applies: true, enforced: true, tier: "pro", period: "month" as const, limit: 4, used: 1, remaining: 3 };
const REFUSED = { ok: false, feature: "mock_test.start", applies: true, enforced: true, tier: "free", period: "lifetime" as const, limit: 1, used: 1, remaining: 0, reason: "limit_reached" as const };

const UNIT_V = {
  group: "unit_v", label: "Unit V", chosen: null as string | null,
  choices: [
    { option: "analysis", label: "Analysis of Financial Statements" },
    { option: "cas", label: "Computerised Accounting System" },
  ],
};

function catalog(over: Record<string, unknown> = {}) {
  return {
    individual: true,
    paper: PAPER,
    taken: 0,
    plan: ALLOWED,
    open: null,
    subjects: [
      {
        subject: "Business Studies", questions: 80, ready: true, options: [],
        chapters: [
          { chapter_id: "ch-plan", chapter: "Planning", questions: 55, ready: true },
          { chapter_id: "ch-staff", chapter: "Staffing", questions: 12, ready: false },
        ],
      },
      { subject: "Accountancy", questions: 300, ready: false, options: [UNIT_V], chapters: [] },
      { subject: "Economics", questions: 22, ready: false, options: [], chapters: [] },
    ],
    ...over,
  };
}

/** What the server says the prepared paper holds — again not the ruled numbers. */
function preview(over: Record<string, unknown> = {}) {
  return {
    paper_id: "paper-7", subject: "Business Studies", chapter_id: null, chapter: null, options: [],
    total: 40, minutes: 30, marks_correct: 4, marks_wrong: -2,
    seen_before: 0, troubled: 0, forms: { mcq: 40 }, blueprint_forms: { mcq: 40 }, short: [],
    ...over,
  };
}

const draw = () => render(<MemoryRouter><MockTests /></MemoryRouter>);
const subjectCard = async (s: string) =>
  (await screen.findAllByTestId("mock-subject")).find((el) => within(el).queryByText(label(s)))!;
const asked = () => (window.confirm as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];

beforeEach(() => {
  state.catalog = catalog();
  state.catalogReads = 0;
  state.history = [];
  state.native = false;
  state.preview = preview();
  state.prepareError = null;
  state.prepared = [];
  state.started = { id: "new-attempt", questions: [] };
  state.startedWith = [];
  state.startError = null;
  state.chosen = [];
  state.navigated = [];
  state.confirm = true;
  state.toasts = [];
  vi.spyOn(window, "confirm").mockImplementation(() => state.confirm);
});

describe("what can be sat", () => {
  it("offers a subject that can fill a paper, with the server's numbers", async () => {
    draw();
    const card = await subjectCard("Business Studies");
    expect(screen.getByText(/40 questions in 30 minutes/)).toBeInTheDocument();
    expect(screen.getByText(/\+4 for a right answer, −2 for a wrong one, 0 if you leave it\./)).toBeInTheDocument();
    expect(within(card).getByText(/40 questions across the chapters as the real paper spreads them, 30 minutes/)).toBeInTheDocument();
    expect(within(card).getByTestId("mock-start-subject")).toBeEnabled();
  });

  it("shows a subject that cannot, with both counts, instead of hiding it", async () => {
    draw();
    const card = await subjectCard("Economics");
    expect(within(card).getByTestId("mock-not-ready"))
      .toHaveTextContent("Not enough questions yet — 22 of 40 questions ready.");
    // CONTROL: only the subject short of questions says so — not the ready one,
    // and not the one waiting on a choice.
    expect(screen.getAllByTestId("mock-not-ready")).toHaveLength(1);
  });

  it("lists a subject's chapter papers, each ready or short by its own count", async () => {
    draw();
    const card = await subjectCard("Business Studies");
    expect(within(card).getByText(/1 of 2 ready/)).toBeInTheDocument();
    const chapters = within(card).getByTestId("mock-chapters");
    expect(within(chapters).getByText("40 questions from this chapter, 30 minutes")).toBeInTheDocument();
    expect(within(chapters).getByText("12 of 40 questions ready.")).toBeInTheDocument();
    // Only the ready chapter can be started.
    expect(within(chapters).getAllByRole("button", { name: /Start/ })).toHaveLength(1);
  });

  it("says so plainly when the syllabus has nothing yet", async () => {
    state.catalog = catalog({ subjects: [] });
    draw();
    expect(await screen.findByText("No subjects yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start/ })).toBeNull();
  });

  it("is not for a school student", async () => {
    state.catalog = { individual: false, paper: PAPER };
    draw();
    expect(await screen.findByText("Mock tests are for exam accounts")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start/ })).toBeNull();
  });
});

describe("a subject that asks for a choice", () => {
  it("asks for it before it offers a paper, and saves it once chosen", async () => {
    draw();
    const card = await subjectCard("Accountancy");
    expect(within(card).getByTestId("mock-needs-choice")).toHaveTextContent("Choose your Unit V first.");
    expect(within(card).queryByTestId("mock-start-subject")).toBeNull();
    const group = within(card).getByRole("group", { name: "Your Unit V" });
    expect(within(group).getAllByRole("button").map((b) => b.getAttribute("aria-pressed"))).toEqual(["false", "false"]);

    const reads = state.catalogReads;
    fireEvent.click(within(group).getByRole("button", { name: "Computerised Accounting System" }));
    await waitFor(() => expect(state.chosen).toEqual([["Accountancy", "unit_v", "cas"]]));
    // The catalog is read again, so what is ready now comes from the server.
    await waitFor(() => expect(state.catalogReads).toBe(reads + 1));
  });

  it("shows the choice made, and does not save it again when it is tapped", async () => {
    state.catalog = catalog({
      subjects: [{ subject: "Accountancy", questions: 300, ready: true, options: [{ ...UNIT_V, chosen: "analysis" }], chapters: [] }],
    });
    draw();
    const card = await subjectCard("Accountancy");
    const chosen = within(card).getByRole("button", { name: "Analysis of Financial Statements" });
    expect(chosen).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(chosen);
    expect(state.chosen).toEqual([]);
  });
});

describe("starting one", () => {
  it("prepares the paper, says what it holds, starts the paper it prepared and goes to it", async () => {
    state.preview = preview({
      seen_before: 18, troubled: 7,
      short: [{ chapter_id: "c", chapter: "Financial Markets", wanted: 2, got: 1 }],
      forms: { mcq: 37, match: 3 }, blueprint_forms: { mcq: 33, match: 4, sequence: 3 },
    });
    draw();
    fireEvent.click(within(await subjectCard("Business Studies")).getByTestId("mock-start-subject"));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(state.prepared).toEqual([["Business Studies", null]]);
    const text = asked();
    expect(text).toContain("40 questions, 30 minutes, one attempt");
    expect(text).toContain("+4 for a right answer");
    expect(text).toContain("18 questions you've seen before — first the 7 you got wrong");
    expect(text).toContain("Financial Markets gave 1 of its 2");
    expect(text).toContain("The real paper sets 7 statement, match, sequence and passage questions; this one has 3");
    expect(text).toContain("The clock does not stop once it starts.");
    await waitFor(() => expect(state.navigated).toEqual(["/student/mock/new-attempt"]));
    expect(state.startedWith).toEqual(["paper-7"]);
  });

  it("says nothing of repeats, short chapters or forms when there are none", async () => {
    draw();
    fireEvent.click(within(await subjectCard("Business Studies")).getByTestId("mock-start-subject"));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(asked()).not.toMatch(/seen before|gave \d+ of its|The real paper sets/);
  });

  it("prepares a chapter paper by its chapter", async () => {
    state.preview = preview({ chapter_id: "ch-plan", chapter: "Planning" });
    draw();
    const chapters = within(await subjectCard("Business Studies")).getByTestId("mock-chapters");
    fireEvent.click(within(chapters).getByRole("button", { name: /Start/ }));
    await waitFor(() => expect(state.prepared).toEqual([["Business Studies", "ch-plan"]]));
    expect(asked()).toContain("Start Planning — a chapter paper?");
  });

  it("does not start when the student says no — preparing counted nothing", async () => {
    state.confirm = false;
    draw();
    fireEvent.click(within(await subjectCard("Business Studies")).getByTestId("mock-start-subject"));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(state.startedWith).toEqual([]);
    expect(state.navigated).toEqual([]);
  });

  it("shows the plan's refusal if the plan refuses at the last moment", async () => {
    state.startError = new PlanLimitError(planLimitFromDecision(REFUSED)!);
    draw();
    fireEvent.click(within(await subjectCard("Business Studies")).getByTestId("mock-start-subject"));
    expect(await screen.findByText("You've used your 1 mock test.")).toBeInTheDocument();
    expect(state.navigated).toEqual([]);
  });

  it("says the server's refusal and reads the catalog again", async () => {
    state.prepareError = new MockError("mock_paper_exhausted", "Every paper these questions can make is one you have already sat.");
    draw();
    const card = await subjectCard("Business Studies");
    const reads = state.catalogReads;
    fireEvent.click(within(card).getByTestId("mock-start-subject"));
    await waitFor(() => expect(state.toasts).toEqual(["Every paper these questions can make is one you have already sat."]));
    await waitFor(() => expect(state.catalogReads).toBe(reads + 1));
    expect(window.confirm).not.toHaveBeenCalled();
  });
});

describe("when the plan has already refused", () => {
  beforeEach(() => {
    state.catalog = catalog({ plan: REFUSED });
  });

  it("says so before anything is clicked, and offers the plans on the web", async () => {
    draw();
    expect(await screen.findByText("You've used your 1 mock test.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "See plans" })).toBeInTheDocument();
  });

  it("names no price and offers no way to buy in the Android app", async () => {
    state.native = true;
    draw();
    expect(await screen.findByText("You've used your 1 mock test.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "See plans" })).toBeNull();
  });
});

describe("a paper already open", () => {
  beforeEach(() => {
    state.catalog = catalog({
      open: {
        id: "open-paper", paper_id: "p", subject: "Business Studies", chapter_id: "ch-plan", chapter: "Planning",
        started_at: "2026-09-27T10:00:00Z", deadline: new Date(Date.now() + 5 * 60_000).toISOString(), submitted_at: null,
        total: 40, seen_before: 0, marks_correct: 4, marks_wrong: -2, max_score: 160, questions: [],
      },
    });
  });

  it("offers to resume it, names its chapter and shows the time left", async () => {
    draw();
    expect(await screen.findByText("Paper in progress")).toBeInTheDocument();
    expect(screen.getAllByText("Planning").length).toBeGreaterThan(0);
    expect(screen.getByTestId("mock-open-clock").textContent).toMatch(/0[45]:\d\d left/);
    fireEvent.click(screen.getByRole("button", { name: /Resume/ }));
    expect(state.navigated).toEqual(["/student/mock/open-paper"]);
  });

  it("will not start a second one while it is open", async () => {
    draw();
    await screen.findByText("Paper in progress");
    const starts = screen.getAllByRole("button", { name: /Start/ });
    expect(starts.length).toBe(2);
    for (const b of starts) expect(b).toBeDisabled();
  });
});

describe("the papers already sat", () => {
  it("lists each with its chapter and its score out of the paper's marks", async () => {
    state.history = [{
      id: "p1", subject: "Business Studies", chapter: "Planning", started_at: "2026-09-20T10:00:00Z",
      submitted_at: "2026-09-20T11:00:00Z", auto_submitted: true,
      correct: 20, wrong: 5, unanswered: 15, voided: 0, score: 70, total: 40, max_score: 160,
      seconds_taken: 3540,
    }];
    draw();
    const list = await screen.findByTestId("mock-history");
    expect(within(list).getByText(`${label("Business Studies")} · Planning`)).toBeInTheDocument();
    expect(within(list).getByText("70")).toBeInTheDocument();
    expect(within(list).getByText("of 160")).toBeInTheDocument();
    expect(within(list).getByText(/20 right, 5 wrong, 15 left/)).toBeInTheDocument();
    expect(within(list).getByText(/time ran out/)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole("button"));
    expect(state.navigated).toEqual(["/student/mock/p1/result"]);
  });

  it("says there are none rather than showing an empty list", async () => {
    draw();
    expect(await screen.findByText("No papers yet")).toBeInTheDocument();
  });
});
