/**
 * The Mock Tests screen offers what the bank can fill, and says why when it
 * cannot.
 *
 * The catalog it is fed is a 40-question paper at +4/−2 — deliberately not the
 * ruled shape — so anything this screen states from a literal rather than from
 * the server's answer fails here.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({
  catalog: null as unknown,
  history: [] as unknown[],
  native: false,
  started: null as unknown,
  startError: null as unknown,
  navigated: [] as string[],
  confirm: true,
}));

vi.mock("@/lib/mockTest", async (orig) => ({
  ...(await orig<typeof import("@/lib/mockTest")>()),
  fetchMockCatalog: () => Promise.resolve(state.catalog),
  fetchMockHistory: () => Promise.resolve(state.history),
  startMock: () => (state.startError ? Promise.reject(state.startError) : Promise.resolve(state.started)),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => state.native } }));
vi.mock("react-router-dom", async (orig) => ({
  ...(await orig<typeof import("react-router-dom")>()),
  useNavigate: () => (to: string) => state.navigated.push(to),
}));

const { default: MockTests } = await import("./MockTests");
const { PlanLimitError, planLimitFromDecision } = await import("@/lib/premium");
const { displaySubject } = await import("@/lib/academicDisplay");

const label = (s: string) => displaySubject(s) || s;

/** A paper that is NOT the ruled one, so nothing may hard-code the ruling. */
const PAPER = {
  questions: 40, minutes: 30, marks_correct: 4, marks_wrong: -2,
  min_chapters: 5, max_per_chapter: 8, max_score: 160,
};

const ALLOWED = { ok: true, feature: "mock_test.start", applies: true, enforced: true, tier: "pro", period: "month" as const, limit: 4, used: 1, remaining: 3 };
const REFUSED = { ok: false, feature: "mock_test.start", applies: true, enforced: true, tier: "free", period: "lifetime" as const, limit: 1, used: 1, remaining: 0, reason: "limit_reached" as const };

function catalog(over: Record<string, unknown> = {}) {
  return {
    individual: true,
    paper: PAPER,
    taken: 0,
    plan: ALLOWED,
    open: null,
    subjects: [
      { subject: "Mathematics", questions: 80, chapters: 8, ready: true },
      { subject: "Accountancy", questions: 22, chapters: 3, ready: false },
    ],
    ...over,
  };
}

const draw = () => render(<MemoryRouter><MockTests /></MemoryRouter>);

beforeEach(() => {
  state.catalog = catalog();
  state.history = [];
  state.native = false;
  state.started = { id: "new-paper", questions: [] };
  state.startError = null;
  state.navigated = [];
  state.confirm = true;
  vi.spyOn(window, "confirm").mockImplementation(() => state.confirm);
});

describe("what can be sat", () => {
  it("offers a subject that can fill a paper, with the server's numbers", async () => {
    draw();
    expect(await screen.findByText(label("Mathematics"))).toBeInTheDocument();
    // 40 questions in 30 minutes at +4/−2 — all four from the catalog.
    expect(screen.getByText(/40 questions in 30 minutes/)).toBeInTheDocument();
    expect(screen.getByText(/\+4 for a right answer, −2 for a wrong one, 0 if you leave it\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start/ })).toBeEnabled();
  });

  it("shows a subject that cannot, with both counts, instead of hiding it", async () => {
    draw();
    expect(await screen.findByText(label("Accountancy"))).toBeInTheDocument();
    expect(screen.getByTestId("mock-not-ready"))
      .toHaveTextContent("Not enough questions yet — 22 of 40 questions ready, from 3 chapters.");
    // CONTROL: the ready subject has no such sentence, so this is not on every card.
    expect(screen.getAllByTestId("mock-not-ready")).toHaveLength(1);
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

describe("starting one", () => {
  it("names the rules before it starts, and goes to the paper", async () => {
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /Start/ }));
    const asked = (window.confirm as unknown as { mock: { calls: string[][] } }).mock.calls[0][0];
    expect(asked).toContain("40 questions, 30 minutes, one attempt");
    expect(asked).toContain("+4 for a right answer");
    expect(asked).toContain("The clock does not stop once it starts.");
    await waitFor(() => expect(state.navigated).toEqual(["/student/mock/new-paper"]));
  });

  it("does not start when the student says no", async () => {
    state.confirm = false;
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /Start/ }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(state.navigated).toEqual([]);
  });

  it("shows the plan's refusal if the plan refuses at the last moment", async () => {
    state.startError = new PlanLimitError(planLimitFromDecision(REFUSED)!);
    draw();
    fireEvent.click(await screen.findByRole("button", { name: /Start/ }));
    expect(await screen.findByText("You've used your 1 mock test.")).toBeInTheDocument();
    expect(state.navigated).toEqual([]);
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
        id: "open-paper", subject: "Mathematics", started_at: "2026-09-27T10:00:00Z",
        deadline: new Date(Date.now() + 5 * 60_000).toISOString(), submitted_at: null,
        total: 40, marks_correct: 4, marks_wrong: -2, max_score: 160, questions: [],
      },
    });
  });

  it("offers to resume it and shows the time left", async () => {
    draw();
    expect(await screen.findByText("Paper in progress")).toBeInTheDocument();
    expect(screen.getByTestId("mock-open-clock").textContent).toMatch(/0[45]:\d\d left/);
    fireEvent.click(screen.getByRole("button", { name: /Resume/ }));
    expect(state.navigated).toEqual(["/student/mock/open-paper"]);
  });

  it("will not start a second one while it is open", async () => {
    draw();
    await screen.findByText("Paper in progress");
    expect(screen.getByRole("button", { name: /Start/ })).toBeDisabled();
  });
});

describe("the papers already sat", () => {
  it("lists each with its score out of the paper's marks", async () => {
    state.history = [{
      id: "p1", subject: "Mathematics", started_at: "2026-09-20T10:00:00Z",
      submitted_at: "2026-09-20T11:00:00Z", auto_submitted: true,
      correct: 20, wrong: 5, unanswered: 15, voided: 0, score: 70, total: 40, max_score: 160,
      seconds_taken: 3540,
    }];
    draw();
    expect(await screen.findByTestId("mock-history")).toBeInTheDocument();
    expect(screen.getByText("70")).toBeInTheDocument();
    expect(screen.getByText("of 160")).toBeInTheDocument();
    expect(screen.getByText(/20 right, 5 wrong, 15 left/)).toBeInTheDocument();
    expect(screen.getByText(/time ran out/)).toBeInTheDocument();
  });

  it("says there are none rather than showing an empty list", async () => {
    draw();
    expect(await screen.findByText("No papers yet")).toBeInTheDocument();
  });
});
