import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

/**
 * The result screen is what the student sees "as soon as they submit", so the
 * thing worth asserting is that it states three different facts three different
 * ways: right, wrong, and never answered.
 *
 * It could not do any of that before 2026-09-12. `rpc_test_submit` deleted
 * `test_answers` at submit and the student's own read of the paper omits the
 * answer key on purpose, so the review had neither their answers nor the right
 * ones — every student, every test, saw rule 27's honest empty state. The
 * screen now reads `rpc_test_answer_sheet`, and this holds it to the three
 * states plus that empty state for the case where the rows genuinely are gone.
 *
 * `QuestionRenderer` is deliberately NOT mocked: it is what turns a position
 * into the option it names, and a review that renders the wrong option would
 * pass every test that stubbed it.
 */
const answerSheet = vi.fn();
const studentReport = vi.fn();
const getMyAttempt = vi.fn();
const getTest = vi.fn();

vi.mock("@/academic", () => ({
  TestService: {
    get: (...a: unknown[]) => getTest(...a),
    getMyAttempt: (...a: unknown[]) => getMyAttempt(...a),
    answerSheet: (...a: unknown[]) => answerSheet(...a),
    studentReport: (...a: unknown[]) => studentReport(...a),
  },
  useAcademicContext: () => ({ ctx: null, ready: false }),
  resolveStudentServiceContext: async () => ({
    schoolId: "school-1",
    userId: "user-1",
    role: "student",
    studentId: "stu-1",
  }),
}));

vi.mock("@/hooks/useAuth", () => {
  const value = { user: { id: "user-1" } };
  return { useAuth: () => value };
});

// Children that reach services of their own. The review itself is the subject.
vi.mock("@/components/learn/ExplainPanel", () => ({ ExplainPanel: () => null }));
vi.mock("@/components/student/ConceptRecoveryReport", () => ({ ConceptRecoveryReport: () => null }));
vi.mock("@/components/student/TestLeaderboard", () => ({
  TestLeaderboard: () => <div>leaderboard</div>,
}));

import TestResult from "./TestResult";

const attempt = {
  id: "att-1",
  submitted_at: "2026-09-12T11:00:00Z",
  score: 1,
  max_score: 3,
  correct_count: 1,
  total_count: 3,
  time_spent_sec: 95,
};

const sheet = {
  test_id: "t1",
  student_id: "stu-1",
  title: "Unit Test 1",
  max_mark: 3,
  mark: 1,
  correct_count: 1,
  total_count: 3,
  submitted_at: "2026-09-12T11:00:00Z",
  time_spent_sec: 95,
  submitted: true,
  questions: [
    {
      question_id: "q1", order_index: 0, question: "HCF of 12 and 18?",
      options: ["2", "4", "6", "12"], question_format: "mcq", marks: 1, topic: "HCF and LCM",
      their_answer: { indexes: [2] }, correct_answer: { indexes: [2] },
      explanation: "six", marks_awarded: 1, answered: true, is_correct: true, time_ms: 4000,
    },
    {
      question_id: "q2", order_index: 1, question: "LCM of 4 and 6?",
      options: ["12", "24", "6", "8"], question_format: "mcq", marks: 1, topic: "HCF and LCM",
      their_answer: { indexes: [1] }, correct_answer: { indexes: [0] },
      explanation: "twelve", marks_awarded: 0, answered: true, is_correct: false, time_ms: 9000,
    },
    {
      question_id: "q3", order_index: 2, question: "Is sqrt(2) rational?",
      options: ["Yes", "No"], question_format: "mcq", marks: 1, topic: "Irrational numbers",
      their_answer: null, correct_answer: { indexes: [1] },
      explanation: "no", marks_awarded: 0, answered: false, is_correct: false, time_ms: null,
    },
  ],
};

const renderResult = () =>
  render(
    <MemoryRouter initialEntries={["/student/test/t1/result"]}>
      <Routes>
        <Route path="/student/test/:id/result" element={<TestResult />} />
      </Routes>
    </MemoryRouter>,
  );

describe("the student's test result screen", () => {
  beforeEach(() => {
    getTest.mockResolvedValue({ id: "t1", title: "Unit Test 1", chapter: "Real Numbers", topic: "HCF and LCM" });
    getMyAttempt.mockResolvedValue(attempt);
    answerSheet.mockResolvedValue(sheet);
    studentReport.mockResolvedValue({
      test_id: "t1", student_id: "stu-1", full_name: "Arjun", mark: 1, max_mark: 3,
      correct_count: 1, total_count: 3, submitted_at: "2026-09-12T11:00:00Z",
      submitted: true, rank: 2, class_size: 3,
      wrong_answers: [
        { question_id: "q2", order_index: 1, question: "LCM of 4 and 6?", topic: "HCF and LCM", marks: 1, question_format: "mcq", options: ["12","24","6","8"], their_answer: { indexes: [1] }, correct_answer: { indexes: [0] }, explanation: "twelve", answered: true },
        { question_id: "q3", order_index: 2, question: "Is sqrt(2) rational?", topic: "Irrational numbers", marks: 1, question_format: "mcq", options: ["Yes","No"], their_answer: null, correct_answer: { indexes: [1] }, explanation: "no", answered: false },
      ],
    });
  });

  it("marks each question right, wrong or left blank — three states, three sentences", async () => {
    renderResult();
    await waitFor(() => expect(screen.getByText(/Question review/)).toBeInTheDocument());

    expect(screen.getByText(/Correct · \+1/)).toBeInTheDocument();
    expect(screen.getByText(/^Wrong · 0$/)).toBeInTheDocument();
    // "Left blank" is not "wrong": the screen must not claim they answered.
    expect(screen.getByText(/Left blank · 0/)).toBeInTheDocument();
    expect(screen.getByText(/You did not answer this one/)).toBeInTheDocument();
  });

  it("renders every question of the paper, with its options", async () => {
    renderResult();
    await waitFor(() => expect(screen.getByText("HCF of 12 and 18?")).toBeInTheDocument());
    expect(screen.getByText("LCM of 4 and 6?")).toBeInTheDocument();
    expect(screen.getByText("Is sqrt(2) rational?")).toBeInTheDocument();
    // The option text, resolved from the position the key holds.
    expect(screen.getAllByText("12").length).toBeGreaterThan(0);
  });

  it("shows the time actually taken, not 0m", async () => {
    renderResult();
    await waitFor(() => expect(screen.getByText(/Question review/)).toBeInTheDocument());
    // 95s rounds to 2m; the defect this replaced always printed "0m".
    expect(screen.getByText("2m")).toBeInTheDocument();
    expect(screen.queryByText("0m")).not.toBeInTheDocument();
  });

  it("carries the rank and the leaderboard", async () => {
    renderResult();
    await waitFor(() => expect(screen.getByText("2 of 3")).toBeInTheDocument());
    expect(screen.getByText("leaderboard")).toBeInTheDocument();
  });

  /**
   * Rule 27. An attempt from before the durability fix has a score and no
   * per-question rows, and the screen must say that rather than rendering the
   * paper with blank answers as though they had left everything unanswered.
   */
  it("says the answers were not recorded when the sheet has none", async () => {
    answerSheet.mockResolvedValue({ ...sheet, questions: [] });
    renderResult();
    await waitFor(() =>
      expect(
        screen.getByText(/Your individual answers for this test were not recorded/),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByText("HCF of 12 and 18?")).not.toBeInTheDocument();
  });

  it("tells the student they have not submitted rather than showing an empty review", async () => {
    getMyAttempt.mockResolvedValue(null);
    renderResult();
    await waitFor(() =>
      expect(screen.getByText(/You haven't submitted this test yet/)).toBeInTheDocument(),
    );
  });
});
