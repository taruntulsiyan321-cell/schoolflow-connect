import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
// The page links into Practice, as the app renders it: inside the router.
import { MemoryRouter } from "react-router-dom";

// recharts' ResponsiveContainer observes its box on mount and jsdom has no
// ResizeObserver, so without this every chart on the page throws during the
// passive-effect flush and takes the whole render with it.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;

/**
 * THE ANALYSIS PAGE, RENDERED, WITH THE NUMBERS PRODUCTION ACTUALLY RETURNED.
 *
 * Why this exists. Every other guard on this page reads its SOURCE and
 * asserts what it does or does not mention. That catches a source going
 * missing; it cannot catch the page printing the wrong number from the right
 * source, and it cannot catch the page not rendering at all — a memo reading
 * a binding declared below it throws at runtime and typechecks clean.
 *
 * The fixture below is the real record of student d1000003-0001 as measured
 * against production on 2026-09-19, chosen because it contains every shape
 * the page has historically got wrong:
 *
 *   Circles         8 attempts, 7 SKIPPED, 1 answered and wrong
 *   Statistics      8 attempts, 5 skipped
 *   Real Numbers   44 attempts, 19 skipped — a genuine 8%
 *   Social Science 79 attempts, ALL of them skipped
 *   Hindi           1 timed question at 300s
 *
 * So the assertions are not "a number appeared". They are: this chapter must
 * NOT carry a verdict, that one MUST, and the page must not confuse the two.
 *
 * `timed` and `avg_sec` are restated in the contract of 20261115000000: they
 * count ANSWERS only. Measured, Social Science carried timed 79 and 0.3s off
 * 79 skips; the server now sends timed 0 and no pace for it, and Hindi's one
 * timed question is an answer (answered 1), so the floor on `timed` alone is
 * what keeps it off "Takes most time".
 */

const SUBJECTS = [
  { subject: "Mathematics",    attempts: 408, answered: 220, timed: 216, correct: 101, skipped: 188, accuracy: 45.9, avg_sec: 11.9, total_min: 45.5 },
  { subject: "Social Science", attempts: 79,  answered: 0,   timed: 0,   correct: 0,   skipped: 79,  accuracy: null, avg_sec: null, total_min: 0.4 },
  { subject: "English",        attempts: 54,  answered: 0,   timed: 0,   correct: 0,   skipped: 54,  accuracy: null, avg_sec: null, total_min: 0.5 },
  { subject: "Hindi",          attempts: 11,  answered: 1,   timed: 1,   correct: 0,   skipped: 10,  accuracy: 0,    avg_sec: 300,  total_min: 5.0 },
];

const CHAPTERS = [
  { chapter: "Circles",        subject: "Mathematics", attempts: 8,   answered: 1,  timed: 1,   correct: 0,  skipped: 7,  accuracy: 0,    avg_sec: 4.1,  total_min: 0.1 },
  { chapter: "Real Numbers",   subject: "Mathematics", attempts: 44,  answered: 25, timed: 25,  correct: 2,  skipped: 19, accuracy: 8,    avg_sec: 1.5,  total_min: 0.7 },
  { chapter: "Statistics",     subject: "Mathematics", attempts: 8,   answered: 3,  timed: 3,   correct: 1,  skipped: 5,  accuracy: 33.3, avg_sec: 8.7,  total_min: 0.5 },
  { chapter: "Triangles",      subject: "Mathematics", attempts: 9,   answered: 2,  timed: 2,   correct: 1,  skipped: 7,  accuracy: 50,   avg_sec: 300,  total_min: 10.1 },
];

const TOPICS = [
  { topic: "Reporting Imperative Sentences", subject: "English",     chapter: "Reported Speech", attempts: 5,  answered: 0,  timed: 0,  correct: 0,  skipped: 5,  accuracy: null, avg_sec: null, total_min: 0.1 },
  { topic: "Degree and Value of a Polynomial", subject: "Mathematics", chapter: "Polynomials",   attempts: 45, answered: 32, timed: 30, correct: 10, skipped: 13, accuracy: 31.3, avg_sec: 1.3, total_min: 0.7 },
];

const SNAPSHOT = {
  mistake_count: 66,
  recovery_pending: 11,
  xp: { xp: 3195, level: 8 },
  weak_topics: [
    // Two rows: one with enough answers to be judged, one with a single
    // attempt. The tile must count what the list shows — one, not two.
    { subject: "Mathematics", chapter: "Polynomials", topic: "Word Problems on AP", accuracy: 31, attempts: 32 },
    { subject: "Mathematics", chapter: "Circles", topic: "Tangent Length", accuracy: 0, attempts: 1 },
  ],
  activity_heatmap: [
    { date: isoDaysAgo(1),   test: 0, homework: 0, battles: 0, self_practice: 3, minutes: 40 },
    { date: isoDaysAgo(3),   test: 0, homework: 0, battles: 0, self_practice: 2, minutes: 35 },
    { date: isoDaysAgo(10),  test: 0, homework: 0, battles: 0, self_practice: 4, minutes: 32 },
    // OUTSIDE the four-week window. Any figure labelled "4 weeks" that
    // includes this is summing the wrong span.
    { date: isoDaysAgo(120), test: 0, homework: 0, battles: 0, self_practice: 9, minutes: 600 },
  ],
};

// Time on the questions, per day of the student's calendar. 40 + 35 + 32
// minutes inside the four-week grid; the 600-minute day is 40 days back —
// inside last month's reach, outside every "4 weeks" figure.
const PRACTICE_TIME = {
  from: isoDaysAgo(62),
  today: isoDaysAgo(0),
  days: [
    { date: isoDaysAgo(40), ms: 600 * 60000, answered: 50, correct: 30, sessions: 9 },
    { date: isoDaysAgo(10), ms: 32 * 60000,  answered: 20, correct: 10, sessions: 4 },
    { date: isoDaysAgo(3),  ms: 35 * 60000,  answered: 15, correct: 7,  sessions: 2 },
    { date: isoDaysAgo(1),  ms: 40 * 60000,  answered: 18, correct: 9,  sessions: 3 },
  ],
  hours: (() => { const h = new Array(24).fill(0); h[17] = 9; return h; })(),
};

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

vi.mock("@/gurukul/StudentContext", async () => {
  const { EMPTY_STUDENT: E } = await import("@/gurukul/emptyStudent");
  const value = { ...E, name: "Arjun Mehta", firstName: "Arjun", class: "10-A", xp: 3195, level: 8, streak: 2 };
  return { useGurukulStudent: () => value };
});

vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = {
    ctx: { schoolId: "s1", userId: "u1", role: "student", studentId: "stu1" },
    ready: true,
    studentId: "stu1",
    classId: "c1",
  };
  return { useAcademicContext: () => value };
});

vi.mock("@/academic", () => ({
  useAcademicLive: () => 0,
  RecoveryEngineService: {
    getChapterStates: () => Promise.resolve([]),
    getRecoveryQueue: () => Promise.resolve([]),
  },
}));

vi.mock("@/academic/services/decisionEngineService", () => ({
  DecisionEngineService: { getWeakAreasV2: () => Promise.resolve([]) },
}));

vi.mock("@/hooks/useAnalysisPageData", () => ({
  useAnalysisPageData: () => ({
    data: {
      totals: { correct: 101, wrong: 119, skipped: 344, accuracy_pct: 46 },
      recent_sessions: [],
    },
    loading: false,
    error: null,
  }),
}));


vi.mock("@/hooks/useStudentAcademicSnapshot", () => ({
  useStudentAcademicSnapshot: () => ({ data: SNAPSHOT, loading: false, error: null }),
}));

vi.mock("@/hooks/useStudentPracticeTime", () => ({
  useStudentPracticeTime: () => ({ data: PRACTICE_TIME, loading: false, error: null }),
}));

// The whole syllabus (rpc_student_syllabus_map): one chapter practised, one not;
// one topic down from 8 of 10 before to 2 of 5 in the last 14 days.
vi.mock("@/hooks/useSyllabusMap", () => ({
  useSyllabusMap: () => ({
    data: {
      examFound: true,
      recentDays: 14,
      chapters: [
        { chapterId: "c1", chapter: "Polynomials", subject: "Mathematics", sequence: 1, answered: 15, correct: 10, recentAnswered: 5, recentCorrect: 2, lastAt: null },
        { chapterId: "c2", chapter: "Probability", subject: "Mathematics", sequence: 2, answered: 0, correct: 0, recentAnswered: 0, recentCorrect: 0, lastAt: null },
      ],
      topics: [
        { topicId: "t1", topic: "Zeroes of a Polynomial", chapterId: "c1", answered: 15, correct: 10, recentAnswered: 5, recentCorrect: 2, lastAt: null },
      ],
      topicsLocked: false,
    },
    error: null,
  }),
}));
// The real paper (rpc_exam_paper): 60 minutes for 50 questions.
vi.mock("@/hooks/useExamPaper", () => ({
  useExamPaper: () => ({ data: { questions: 50, minutes: 60, marks_correct: 5, marks_wrong: -1 }, error: null }),
}));
// by_form per test: the fixture student met direct questions only.
const forms = vi.hoisted(() => ({ rows: [] as unknown[], guesses: null as unknown }));
vi.mock("@/hooks/useStudentPracticeAnalytics", () => ({
  useStudentPracticeAnalytics: () => ({
    data: {
      by_subject: SUBJECTS,
      by_chapter: CHAPTERS,
      by_topic: TOPICS,
      by_difficulty: [
        { difficulty: "easy",   rank: 1, attempts: 207, answered: 70, timed: 70, correct: 29, skipped: 137, accuracy: 41.4, avg_sec: 2.9 },
        { difficulty: "medium", rank: 2, attempts: 234, answered: 96, timed: 94, correct: 46, skipped: 138, accuracy: 47.9, avg_sec: 2.6 },
      ],
      by_form: forms.rows,
      guesses: forms.guesses,
      effort: { attempts: 564, questions_seen_again: 481, first_try_attempts: 56, first_try_correct: 20 },
      recurring: [],
    },
    loading: false,
    error: null,
  }),
}));

import Analysis from "./Analysis";

const openTab = (label: string) => fireEvent.click(screen.getByRole("tab", { name: label }));

describe("Analysis — rendered", () => {
  beforeEach(() => {
    forms.rows = [];
    forms.guesses = null;
  });

  it("agrees the verb with the count it just pluralised", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    // One weak topic survives the filter, and the sentence read
    // "1 topic need attention" — noun pluralised, verb left plural.
    expect(screen.getByText("1 topic needs attention")).toBeInTheDocument();
  });

  it("mounts and shows the page's one accuracy in the header", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    // Not from exam_readiness — the fixture has no exam_readiness at all, so
    // if this renders a percentage it came from analysis.totals.
    // The summary row renders "<label>: <value>" as one node. The fixture has
    // NO exam_readiness, so a percentage here can only have come from
    // analysis.totals — which is the point of the assertion.
    // The summary renders each row as <p>Label: <strong>value</strong></p>,
    // so the label alone is not its own text node. Match on the whole <p>.
    const row = (label: string) => {
      const p = Array.from(document.querySelectorAll("p")).find((el) =>
        (el.textContent ?? "").startsWith(`${label}:`),
      );
      expect(p, `no summary row for ${label}`).toBeTruthy();
      return p!.textContent ?? "";
    };
    expect(row("Practice accuracy")).toContain("46%");
    expect(row("Open mistakes")).toContain("66");
    // The Overview tile computes the same rate from the counts beside it.
    expect(screen.getByText("Questions solved")).toBeInTheDocument();
    expect(screen.getByText("220")).toBeInTheDocument();
  });

  it("refuses a verdict on a chapter whose attempts were mostly skips", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Subjects & Chapters");
    const circles = screen.getByText("Circles").closest("div.p-4") as HTMLElement;
    expect(circles).toBeTruthy();
    // 8 attempts, 1 answered and wrong. It shows what happened...
    expect(within(circles).getByText("8")).toBeInTheDocument();
    // ...and refuses to call it 0%.
    expect(within(circles).getByText("not enough yet")).toBeInTheDocument();
    expect(within(circles).queryByText("0%")).toBeNull();
    expect(within(circles).queryByText("Needs attention")).toBeNull();
  });

  it("keeps the verdict on a chapter that earned one", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Subjects & Chapters");
    const real = screen.getByText("Real Numbers").closest("div.p-4") as HTMLElement;
    // 44 attempts, 25 answered, a genuine 8%. The fix must not silence this.
    expect(within(real).getByText("8%")).toBeInTheDocument();
    expect(within(real).queryByText("not enough yet")).toBeNull();
  });

  it("says nothing about a subject where every attempt was skipped", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Subjects & Chapters");
    const ss = screen.getByText("Social Science").closest("div.p-3, div.p-4") as HTMLElement;
    expect(ss).toBeTruthy();
    expect(within(ss).getByText("not enough yet")).toBeInTheDocument();
    expect(within(ss).queryByText("0%")).toBeNull();
  });

  it("does not name a one-question subject as the one that takes longest", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Practice");
    const slowest = screen.getByText("Takes most time").closest("div") as HTMLElement;
    // Hindi has the largest avg_sec (300s) and ONE timed question.
    expect(within(slowest).queryByText("Hindi")).toBeNull();
  });

  it("will not call a subject fast when nothing in it was answered", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Practice");
    // Social Science: 79 attempts, ALL skipped, 0.3s each. It was named the
    // "fastest subject" at "0s avg" — a subject with no answers in it, on a
    // panel headed "how fast you SOLVE", with a time of zero.
    const fastest = screen.getByText("Fastest subject").parentElement as HTMLElement;
    expect(within(fastest).queryByText("Social Science")).toBeNull();
    expect(within(fastest).getByText("Mathematics")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("0s avg");
    // Only one subject qualifies, so there is no slowest to name.
    const slowest = screen.getByText("Takes most time").parentElement as HTMLElement;
    expect(within(slowest).getByText("\u2014")).toBeInTheDocument();
  });

  it("counts practice over the same days it calls consistent", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Practice");
    // The heat-map fixture has 9 practice sessions on 3 days inside the window.
    // The tile used to sum a DIFFERENT table (and all activity kinds) and
    // disagree with Consistency beside it.
    const total = screen.getByText("Practice in 4 weeks").parentElement as HTMLElement;
    expect(within(total).getByText("9")).toBeInTheDocument();
    expect(within(total).queryByText("0")).toBeNull();
  });

  it("counts only the topics the tab is willing to list", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Topics");
    // weak_topics has TWO rows and one of them has a single attempt behind
    // it, so the list drops it. The tile must say 1, not 2.
    const tile = screen.getByText("Need attention").parentElement as HTMLElement;
    expect(within(tile).getByText("1")).toBeInTheDocument();
    expect(within(tile).queryByText("2")).toBeNull();
  });

  it("does not sum activity from outside the four-week window", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Activity & Speed");
    // 40 + 35 + 32 = 107 minutes inside the window -> "1h 47m".
    // The 600-minute day 40 days back would make it "11h 47m".
    const tile = screen.getByText("Study time (4 weeks)").parentElement as HTMLElement;
    expect(within(tile).getByText("1h 47m")).toBeInTheDocument();
    expect(within(tile).queryByText("11h 47m")).toBeNull();
  });

  it("shows nothing by kind of question when only direct questions were met (C1)", () => {
    // The fixture student's own record, measured 2026-10-09: 3,007 attempts, all direct.
    forms.rows = [{ form: "mcq", attempts: 3007, answered: 796, timed: 787, correct: 365, skipped: 2211, accuracy: 45.9, avg_sec: 1.0 }];
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Practice");
    expect(screen.queryByText("How you do by kind of question")).toBeNull();
    // CONTROL: the tab itself is drawn.
    expect(screen.getByText("How you do by difficulty")).toBeInTheDocument();
  });

  it("shows accuracy by kind of question, weakest first, a percentage only past the floor (C1)", () => {
    // The exam account 095998bc's record, measured 2026-10-09, in the server's order.
    forms.rows = [
      { form: "mcq", attempts: 237, answered: 112, timed: 112, correct: 29, skipped: 125, accuracy: 25.9, avg_sec: 3.4 },
      { form: "assertion_reason", attempts: 10, answered: 3, timed: 3, correct: 1, skipped: 7, accuracy: 33.3, avg_sec: 2.5 },
      { form: "match", attempts: 10, answered: 0, timed: 0, correct: 0, skipped: 10, accuracy: null, avg_sec: null },
    ];
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Practice");
    expect(screen.getByText("How you do by kind of question")).toBeInTheDocument();
    const rows = screen.getAllByTestId("form-accuracy-row");
    expect(rows.map((r) => r.querySelector("td")?.textContent)).toEqual(["Direct question", "Assertion–reason", "Match the following"]);
    expect(rows[0]).toHaveTextContent("29 of 112");
    expect(rows[0]).toHaveTextContent("26%");
    // Three answers are not enough for a percentage: the counts, and a dash.
    expect(rows[1]).toHaveTextContent("1 of 3");
    expect(within(rows[1]).queryByText("33%")).toBeNull();
    expect(rows[1]).toHaveTextContent("—");
    // Every match question skipped: said as skips, not as 0%.
    expect(rows[2]).toHaveTextContent("0 of 0 · 10 skips");
    expect(within(rows[2]).queryByText("0%")).toBeNull();
  });

  it("says whether guessing pays, against the real paper's marking (C3)", () => {
    // 2 of 10 right: 20% beats one in six at +5/−1; 2 × 5 − 8 × 1 = +2.
    forms.guesses = { answered: 10, correct: 2 };
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Practice");
    const card = screen.getByTestId("guessing-pays");
    expect(card).toHaveAttribute("data-verdict", "pays");
    expect(card).toHaveTextContent("Your guesses pay.");
    expect(card).toHaveTextContent("2 of 10 guesses right (20%) — more than the 1 in 6 a guess must get right to gain marks at +5/−1. Marked that way they came to +2 marks.");
    expect(card).toHaveTextContent("On the paper, an answer you would guess is worth giving.");
  });

  it("says to leave them when guessing loses marks, and waits for enough guesses (C3)", () => {
    forms.guesses = { answered: 10, correct: 1 };
    const { unmount } = render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Practice");
    expect(screen.getByTestId("guessing-pays")).toHaveTextContent("Leave them blank.");
    expect(screen.getByTestId("guessing-pays")).toHaveTextContent("came to −4 marks");
    expect(screen.getByTestId("guessing-pays")).toHaveTextContent("On the paper, leave a question blank rather than guess it.");
    unmount();
    forms.guesses = { answered: 3, correct: 3 };
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Practice");
    expect(screen.getByTestId("guessing-pays")).toHaveAttribute("data-verdict", "unknown");
    expect(screen.queryByText("Your guesses pay.")).toBeNull();
  });

  it("shows no guessing card for a student who has never marked a guess (C3)", () => {
    forms.guesses = { answered: 0, correct: 0 };
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Practice");
    expect(screen.queryByText("Does guessing pay for you?")).toBeNull();
    // CONTROL: the tab is drawn.
    expect(screen.getByText("How you do by difficulty")).toBeInTheDocument();
  });

  it("reports how the student works per question, and not what it cannot measure", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Practice");
    expect(screen.getByText("How you work")).toBeInTheDocument();
    const seen = screen.getByText("Seen again").parentElement as HTMLElement;
    expect(within(seen).getByText("481")).toBeInTheDocument();
    // The explanation shows after every answer: "opened" was never a choice.
    expect(screen.queryByText("Solution opened")).toBeNull();
    const first = screen.getByText("Right first time").parentElement as HTMLElement;
    expect(first.textContent).toContain("36%"); // 20 of 56
    expect(first.textContent).toContain("56 questions answered on first meeting");
  });

  it("counts the days practised in the last fourteen of the student's own", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    // Sessions on days 1, 3 and 10 back; day 40 is outside the window.
    const p = Array.from(document.querySelectorAll("p")).find((el) =>
      (el.textContent ?? "").startsWith("Study consistency:"),
    );
    expect(p?.textContent).toContain("3 of 14 days practised");
  });

  it("names the busiest hour from the student's own clock", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Activity & Speed");
    const tile = screen.getByText("Most active hour").parentElement as HTMLElement;
    expect(within(tile).getByText("5 PM")).toBeInTheDocument();
  });

  it("does not list a chapter by pace on two timed answers", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Activity & Speed");
    // Triangles: two answers, 300s each — a tab left open, twice. The
    // floor keeps it off "Chapters that take you longest".
    expect(screen.queryByText("Triangles")).toBeNull();
  });

  it("does not rank a topic the student never answered anything in", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Activity & Speed");
    // "Reporting Imperative Sentences" is five straight SKIPS through an
    // English topic at 0.9s each. It headed "topics that take you longest"
    // and printed a blank where its success rate goes.
    expect(screen.queryByText("Reporting Imperative Sentences")).toBeNull();
    expect(document.body.textContent).not.toContain("none answered");
  });

  it("counts a month's practice from the same rows as its study time", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Activity & Speed");
    // Practice count and minutes both come from the heat-map (rule 11:
    // self_practice only). Pick the month-comparison label, not the tab.
    const label = screen.getAllByText("Practice").find((el) =>
      el.className.includes("uppercase"),
    );
    expect(label).toBeTruthy();
    const card = label!.parentElement as HTMLElement;
    expect(card.querySelector(".text-xl")).toBeTruthy();
  });

  it("writes one spelling of practised", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Topics");
    expect(document.body.textContent).not.toContain("practiced");
  });

  it("does not report a capped list length as a session count", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    // The fixture supplies no self_practice.sessions_completed, and the page
    // used to fall back to recent_sessions.length — an array fetched with
    // .limit(40). A student with 72 sessions would have been shown 40.
    const row = screen.getByText("Practice sessions").parentElement as HTMLElement;
    expect(row.textContent).toContain("\u2014");
    expect(row.textContent).not.toContain("40");
    expect(row.textContent).not.toContain("0");
  });

  it("does not draw a radar out of one point", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Subjects & Chapters");
    // The fixture has four subjects and only Mathematics is measured — the
    // other three are 100% skipped, so they have no accuracy and are
    // correctly filtered out. A one-axis radar is a dot, on a panel whose
    // whole purpose is comparing subjects.
    expect(screen.getByText(/A radar needs 3 subjects to compare/)).toBeInTheDocument();
    // And the list beside it still shows every subject, so nothing is lost.
    expect(screen.getByText("Social Science")).toBeInTheDocument();
    expect(screen.getAllByText("Mathematics").length).toBeGreaterThan(0);
  });

  it("calls one quantity by one name across the tab", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Subjects & Chapters");
    // Subject cards said "408 questions" while the chapter cards below said
    // "44 Attempts" — the same count, two nouns, one screen.
    const text = document.body.textContent ?? "";
    expect(text).toContain("408 attempts");
    expect(text).not.toContain("408 questions");
  });

  it("never renders a source comment as page text", () => {
    // A bare /* ... */ inside JSX is not a comment, it is TEXT, and tsc
    // accepts it silently. Introduced and caught here while moving an
    // explanation out of a conditional: the whole paragraph would have
    // shipped onto the screen above the error banner.
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    for (const t of ["Overview", "Subjects & Chapters", "Topics", "Practice", "Activity & Speed", "Milestones & Reports"]) {
      openTab(t);
      const text = document.body.textContent ?? "";
      expect(text).not.toContain("/*");
      expect(text).not.toContain("*/");
      expect(text).not.toContain("THE PAGE DOES");
    }
  });

  it("renders every tab without throwing", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    for (const t of ["Overview", "Subjects & Chapters", "Topics", "Practice", "Activity & Speed", "Milestones & Reports"]) {
      openTab(t);
      expect(screen.getByText("Analysis")).toBeInTheDocument();
    }
  });

  it("puts a chapter with a real figure on the grid before one-answer chapters", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Subjects & Chapters");
    const text = document.body.textContent ?? "";
    const grid = text.slice(text.indexOf("Chapter by chapter"));
    // Real Numbers: 25 answered, 8%. Circles: one answer, 0% — which the
    // server's raw-accuracy order put first, and twelve like it filled the grid.
    expect(grid.indexOf("Real Numbers")).toBeGreaterThan(-1);
    expect(grid.indexOf("Real Numbers")).toBeLessThan(grid.indexOf("Circles"));
  });

  it("draws no bar for a subject with nothing measured", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Subjects & Chapters");
    const card = (name: string) => screen.getAllByText(name)
      .map((el) => el.closest("div.p-3") as HTMLElement | null)
      .find((el): el is HTMLElement => !!el?.querySelector("div.w-2.h-10"))!;
    // `${null}%` is not a width, and the browser drew the bar full.
    expect(card("Social Science").querySelector("div.h-1 > div")).toBeNull();
    // CONTROL: a measured subject has one.
    expect(card("Mathematics").querySelector("div.h-1 > div")).not.toBeNull();
  });

  it("names a weak topic with its chapter, so two of one name can be told apart", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Topics");
    expect(screen.getByText("Word Problems on AP")).toBeInTheDocument();
    expect(document.body.textContent).toContain("Polynomials · Mathematics");
  });
});

describe("Analysis — the student against the real paper", () => {
  it("Activity & Speed says what the paper allows, and that no subject read is slower — Hindi's one 300s answer is not a pace", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Activity & Speed");
    const card = screen.getByTestId("exam-pace");
    expect(card).toHaveTextContent("The paper allows 72s a question — 60 minutes for 50.");
    expect(card).toHaveTextContent("No subject you have practised takes longer than that.");
    expect(within(card).queryByText("Hindi")).toBeNull();
  });
});

describe("Analysis — the whole syllabus, and what is slipping", () => {
  it("Subjects & Chapters maps every syllabus chapter, practised or not", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Subjects & Chapters");
    const map = screen.getByTestId("syllabus-coverage");
    expect(map).toHaveTextContent("You have practised 1 of 2 chapters in your syllabus.");
    expect(map).toHaveTextContent("ProbabilityNot practised");
  });

  it("Topics leads to the student's mistake types, where their trend is", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Topics");
    expect(screen.getByTestId("to-mistake-types")).toHaveAttribute("href", "/student/mistakes/types");
  });

  it("Topics names the topic slipping lately", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    openTab("Topics");
    expect(screen.getByTestId("slipping-topic")).toHaveTextContent("80% → 40%");
  });
});

describe("Analysis — if the paper were today", () => {
  it("Overview estimates a subject with enough behind it: Mathematics, 101 of 220 right, 1 of 2 chapters", () => {
    render(<MemoryRouter><Analysis /></MemoryRouter>);
    // 50 × (101/220 × 5 − 119/220 × 1) = 87.7.
    const est = screen.getByTestId("readiness-estimate");
    expect(est).toHaveTextContent("Mathematics88 of 250");
    expect(est).toHaveTextContent("At 46% right over 220 answers, answering all 50 · 1 of 2 chapters practised");
  });
});
