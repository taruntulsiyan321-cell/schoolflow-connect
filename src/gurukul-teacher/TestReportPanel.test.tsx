import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The teacher's test report, held to the four things it is for.
 *
 *   1. the class RANKED BY MARK, not by roll number
 *   2. which question cost the time, QUESTION BY QUESTION — not one average
 *      for the whole paper, and not one "slowest question" either
 *   3. clicking a student opens THEIR PERFORMANCE: every question with their
 *      answer, the key and their own time, not only what they got wrong
 *   4. an untimed answer reads as untimed and never as 0s (§7)
 *
 * Every assertion here is on CONTENT — a name next to a mark, a duration next
 * to a question — so a panel that rendered its headings and nothing else fails
 * all of them.
 */
const classReport = vi.fn();
const leaderboard = vi.fn();
const questionBreakdown = vi.fn();
const answerSheet = vi.fn();

vi.mock("@/academic", () => ({
  TestService: {
    classReport: (...a: unknown[]) => classReport(...a),
    leaderboard: (...a: unknown[]) => leaderboard(...a),
    questionBreakdown: (...a: unknown[]) => questionBreakdown(...a),
    answerSheet: (...a: unknown[]) => answerSheet(...a),
  },
}));

vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = {
    ctx: { schoolId: "school-1", userId: "teacher-1", role: "teacher" },
    ready: true,
  };
  return { useAcademicContext: () => value };
});

import { TestReportPanel } from "./TestReportPanel";

const REPORT = {
  test_id: "test-1",
  title: "Unit Test 1",
  max_mark: 2,
  class_id: "class-1",
  submitted_count: 2,
  class_average: 1.5,
  average_seconds_per_question: 30,
  weakest_topics: [{ topic: "Fractions", asked: 2, wrong: 1, wrong_pct: 50 }],
  // IN ROLL ORDER, and the roll disagrees with the marks on purpose: Bilal is
  // first on the register and second on the board. A leaderboard that quietly
  // fell back to roll order would be indistinguishable from a correct one if
  // the two agreed.
  students: [
    {
      student_id: "s-2",
      full_name: "Bilal Khan",
      roll_number: 1,
      submitted: true,
      mark: 1,
      correct_count: 1,
      total_count: 2,
      submitted_at: "2026-09-13T09:05:00Z",
    },
    {
      student_id: "s-3",
      full_name: "Chetan Iyer",
      roll_number: 2,
      submitted: false,
      mark: null,
      correct_count: null,
      total_count: null,
      submitted_at: null,
    },
    {
      student_id: "s-1",
      full_name: "Asha Rao",
      roll_number: 3,
      submitted: true,
      mark: 2,
      correct_count: 2,
      total_count: 2,
      submitted_at: "2026-09-13T09:00:00Z",
    },
  ],
};

const BOARD = {
  test_id: "test-1",
  title: "Unit Test 1",
  max_mark: 2,
  subject: "Mathematics",
  submitted_count: 2,
  roll_count: 3,
  entries: [
    {
      student_id: "s-1",
      full_name: "Asha Rao",
      roll_number: 3,
      mark: 2,
      correct_count: 2,
      total_count: 2,
      submitted_at: "2026-09-13T09:00:00Z",
      rank: 1,
      is_me: false,
    },
    {
      student_id: "s-2",
      full_name: "Bilal Khan",
      roll_number: 1,
      mark: 1,
      correct_count: 1,
      total_count: 2,
      submitted_at: "2026-09-13T09:05:00Z",
      rank: 2,
      is_me: false,
    },
  ],
};

const BREAKDOWN = {
  test_id: "test-1",
  title: "Unit Test 1",
  max_mark: 2,
  submitted_count: 2,
  questions: [
    {
      question_id: "q-1",
      order_index: 0,
      question: "What is one half of four?",
      question_format: "mcq",
      marks: 1,
      topic: "Fractions",
      answered_count: 2,
      correct_count: 2,
      wrong_count: 0,
      blank_count: 0,
      timed_count: 2,
      avg_time_ms: 5000,
      max_time_ms: 6000,
      slowest_student_id: "s-2",
      slowest_student_name: "Bilal Khan",
      slowest_time_ms: 6000,
    },
    {
      question_id: "q-2",
      order_index: 1,
      question: "Which fraction is larger?",
      question_format: "mcq",
      marks: 1,
      topic: "Fractions",
      answered_count: 2,
      correct_count: 1,
      wrong_count: 1,
      blank_count: 0,
      timed_count: 2,
      avg_time_ms: 95000,
      max_time_ms: 130000,
      slowest_student_id: "s-1",
      slowest_student_name: "Asha Rao",
      slowest_time_ms: 130000,
    },
  ],
};

const SHEET = {
  test_id: "test-1",
  student_id: "s-1",
  title: "Unit Test 1",
  max_mark: 2,
  mark: 2,
  correct_count: 2,
  total_count: 2,
  submitted_at: "2026-09-13T09:00:00Z",
  time_spent_sec: 140,
  submitted: true,
  questions: [
    {
      question_id: "q-1",
      order_index: 0,
      question: "What is one half of four?",
      options: ["1", "2"],
      question_format: "mcq",
      marks: 1,
      topic: "Fractions",
      their_answer: { indexes: [1] },
      correct_answer: { indexes: [1] },
      explanation: null,
      marks_awarded: 1,
      answered: true,
      is_correct: true,
      time_ms: 10000,
    },
    {
      question_id: "q-2",
      order_index: 1,
      question: "Which fraction is larger?",
      options: ["1/2", "1/3"],
      question_format: "mcq",
      marks: 1,
      topic: "Fractions",
      their_answer: { indexes: [0] },
      correct_answer: { indexes: [0] },
      explanation: null,
      marks_awarded: 1,
      answered: true,
      is_correct: true,
      time_ms: 130000,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  classReport.mockResolvedValue(REPORT);
  leaderboard.mockResolvedValue(BOARD);
  questionBreakdown.mockResolvedValue(BREAKDOWN);
  answerSheet.mockResolvedValue(SHEET);
});

const open = async () => {
  render(<TestReportPanel testId="test-1" />);
  await waitFor(() => expect(questionBreakdown).toHaveBeenCalledWith(expect.anything(), "test-1"));
};

describe("the class leaderboard", () => {
  it("opens on the board and ranks by mark, top first", async () => {
    await open();
    const asha = await screen.findByRole("button", { name: /Asha Rao/ });
    const bilal = screen.getByRole("button", { name: /Bilal Khan/ });

    // Asha is LAST on the register and FIRST here, because she scored higher.
    // Rendering the roll instead would put Bilal first and label him 1.
    expect(asha.compareDocumentPosition(bilal) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Rank first, then the roll: "1" then "3. Asha Rao". Rendering the roll in
    // the rank slot would read "3" then "3. Asha Rao".
    expect(asha.textContent?.startsWith("13. Asha Rao")).toBe(true);
    expect(bilal.textContent?.startsWith("21. Bilal Khan")).toBe(true);
    expect(asha.textContent).toContain("2 / 2");
    expect(bilal.textContent).toContain("1 / 2");
    // The student who never sat it is not on a board of results.
    expect(screen.queryByText(/Chetan Iyer/)).toBeNull();
  });

  it("keeps the class list on the register's order, which is a different list", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Class list" }));
    const bilal = await screen.findByRole("button", { name: /Bilal Khan/ });
    const asha = screen.getByRole("button", { name: /Asha Rao/ });
    // Roll order here, mark order on the board: two orders, two questions.
    expect(bilal.compareDocumentPosition(asha) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // And the register carries the student the board cannot: the one missing.
    expect(screen.getByRole("button", { name: /Chetan Iyer/ }).textContent).toContain(
      "Not submitted",
    );
  });
});

describe("where the class's time went", () => {
  it("times every question separately and marks the costliest", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Questions" }));

    const slow = (await screen.findByText(/Which fraction is larger/)).closest("div.rounded-lg");
    const fast = screen.getByText(/What is one half of four/).closest("div.rounded-lg");
    expect(slow).not.toBeNull();
    expect(fast).not.toBeNull();

    // Two different averages on two questions: the fact a single
    // "average seconds per question" for the paper could never carry.
    expect(fast!.textContent).toContain("5s average");
    expect(slow!.textContent).toContain("1m 35s average");
    // And the one that cost the most is named, with who it cost.
    expect(slow!.textContent).toContain("Took longest");
    expect(slow!.textContent).toContain("Asha Rao");
    expect(fast!.textContent).not.toContain("Took longest");
  });

  it("never prints a time for an answer nobody timed", async () => {
    questionBreakdown.mockResolvedValue({
      ...BREAKDOWN,
      questions: BREAKDOWN.questions.map((q) => ({
        ...q,
        timed_count: 0,
        avg_time_ms: null,
        max_time_ms: null,
        slowest_student_id: null,
        slowest_student_name: null,
        slowest_time_ms: null,
      })),
    });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Questions" }));

    const row = (await screen.findByText(/Which fraction is larger/)).closest("div.rounded-lg");
    expect(row!.textContent).not.toContain("0s");
    expect(row!.textContent).toContain("— average");
    // With no clock anywhere, nothing is the slowest.
    expect(screen.queryByText("Took longest")).toBeNull();
  });
});

describe("one student's performance", () => {
  it("opens the whole paper, not only what went wrong", async () => {
    await open();
    fireEvent.click(await screen.findByRole("button", { name: /Asha Rao/ }));
    await waitFor(() => expect(answerSheet).toHaveBeenCalledWith(expect.anything(), "test-1", "s-1"));

    // She scored full marks. The report this replaces showed wrong answers
    // only, so this student's panel was empty — the defect the test names.
    expect(await screen.findByText(/What is one half of four/)).toBeTruthy();
    expect(screen.getByText(/Which fraction is larger/)).toBeTruthy();
    expect(screen.getAllByText("Right")).toHaveLength(2);

    const panel = screen.getByText(/Rank 1 of 2/).closest("div");
    expect(panel!.textContent).toContain("2 / 2");
    expect(panel!.textContent).toContain("0 wrong");
    expect(panel!.textContent).toContain("0 left blank");
    expect(panel!.textContent).toContain("2m 20s on the paper");

    // HER slowest question, by her own clock, marked on her own paper.
    const hers = screen.getByText(/Which fraction is larger/).closest("div.rounded-lg");
    expect(hers!.textContent).toContain("their longest");
    expect(hers!.textContent).toContain("2m 10s");
  });

  it("says a student did not sit it rather than showing an empty paper", async () => {
    answerSheet.mockResolvedValue({ ...SHEET, student_id: "s-3", submitted: false, questions: [] });
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Class list" }));
    fireEvent.click(await screen.findByRole("button", { name: /Chetan Iyer/ }));
    expect(await screen.findByText(/did not sit the test/)).toBeTruthy();
  });
});

describe("what the panel says when there is nothing to say", () => {
  it("does not offer a ranking or a timing for a test nobody has sat", async () => {
    classReport.mockResolvedValue({
      ...REPORT,
      submitted_count: 0,
      class_average: null,
      weakest_topics: [],
      students: REPORT.students.map((s) => ({
        ...s,
        submitted: false,
        mark: null,
        correct_count: null,
        total_count: null,
        submitted_at: null,
      })),
    });
    leaderboard.mockResolvedValue({ ...BOARD, submitted_count: 0, entries: [] });
    questionBreakdown.mockResolvedValue({ ...BREAKDOWN, submitted_count: 0, questions: [] });
    await open();

    expect(await screen.findByText(/Nobody has submitted this test yet/)).toBeTruthy();
    expect(screen.getByText(/nothing to rank/)).toBeTruthy();
    // A class average of 0 is a different fact from an unsat test (§7).
    expect(screen.queryByText("0 / 2")).toBeNull();
  });
});
