import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The teacher's test builder, held to the two rules that were wrong before.
 *
 * 1. THE CORRECT ANSWER IS PICKED, NOT TYPED. It used to be a free-text
 *    "Correct option text" field: a typo, a trailing space or a later edit to
 *    the option produced an answer key naming no option — `{indexes: []}` —
 *    and then every student's answer marked wrong with nothing on screen to
 *    explain it. What travels now is the index of the option the teacher
 *    tapped, and a question with none marked cannot be added at all.
 *
 * 2. THE TEST IS PUBLISHED LAST. It used to be created with
 *    `status: 'published'` and have its questions written afterwards, so
 *    between two awaits the test was published with NO QUESTIONS — a student
 *    refreshing then was offered a paper `rpc_test_start` refused, and if the
 *    question write failed at all the test stayed published and empty for good.
 *    `createWithQuestions` does draft -> questions -> publish, and this asserts
 *    the screen calls THAT rather than reassembling the old order.
 */
const createWithQuestions = vi.fn();
const listForClassDetailed = vi.fn();

vi.mock("@/academic", () => ({
  AttendanceService: {},
  AcademicProfileService: { listForClass: vi.fn().mockResolvedValue([]) },
  AnalyticsService: {},
  HomeworkService: { publishDueScheduled: vi.fn().mockResolvedValue(0) },
  MarksService: {},
  RemarksService: {},
  ProgressionService: {},
  TestService: {
    listForClassDetailed: (...a: unknown[]) => listForClassDetailed(...a),
    createWithQuestions: (...a: unknown[]) => createWithQuestions(...a),
    searchQuestionBank: vi.fn().mockResolvedValue([]),
    listBankChapters: vi.fn().mockResolvedValue([]),
    classReport: vi.fn(),
    studentReport: vi.fn(),
  },
  TEST_KIND_LABELS: { class_test: "Class test", unit_test: "Unit test" },
  useAcademicLive: () => 0,
}));

vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = {
    ctx: { schoolId: "school-1", userId: "teacher-1", role: "teacher" },
    ready: true,
  };
  return { useAcademicContext: () => value };
});

import { LiveTestsTab } from "./LiveClassPanels";

const openBuilderWithAQuestion = async () => {
  render(<LiveTestsTab classId="class-1" subject="Mathematics" />);
  await waitFor(() => expect(listForClassDetailed).toHaveBeenCalled());

  fireEvent.click(await screen.findByRole("button", { name: /Create Test/ }));
  fireEvent.change(screen.getByPlaceholderText("Title *"), {
    target: { value: "Unit Test 1" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Next: Choose source/ }));
  fireEvent.click(await screen.findByRole("button", { name: /Write the questions yourself/ }));

  fireEvent.change(await screen.findByPlaceholderText("Question text *"), {
    target: { value: "What is the HCF of 12 and 18?" },
  });
  ["2", "4", "6", "12"].forEach((v, i) => {
    fireEvent.change(screen.getByPlaceholderText(`Option ${String.fromCharCode(65 + i)}`), {
      target: { value: v },
    });
  });
};

describe("the teacher's test builder", () => {
  beforeEach(() => {
    createWithQuestions.mockReset().mockResolvedValue({ id: "t1" });
    listForClassDetailed.mockReset().mockResolvedValue([]);
  });

  it("refuses a question with no correct option marked", async () => {
    await openBuilderWithAQuestion();
    fireEvent.click(screen.getByRole("button", { name: /Add question/ }));

    expect(
      await screen.findByText(/Mark which option is the correct answer/),
    ).toBeInTheDocument();
    // Nothing was added: the review step is still out of reach.
    expect(screen.getByText(/No questions added yet/)).toBeInTheDocument();
  });

  it("carries the PICKED option as the key, and publishes last", async () => {
    await openBuilderWithAQuestion();

    // Tap option C — the index, not the text, is what must travel.
    fireEvent.click(screen.getByRole("button", { name: /Mark option C correct/ }));
    fireEvent.click(screen.getByRole("button", { name: /Add question/ }));

    // The key is shown back, as the option it names, before anything is saved.
    expect(await screen.findByText(/Correct: C\. 6/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Next: Review/ }));
    fireEvent.click(await screen.findByRole("button", { name: /^Publish$/ }));

    await waitFor(() => expect(createWithQuestions).toHaveBeenCalledTimes(1));
    const [, input, questions, publish] = createWithQuestions.mock.calls[0];

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      question: "What is the HCF of 12 and 18?",
      options: ["2", "4", "6", "12"],
      correctIndex: 2,
      marks: 1,
    });
    // Draft -> questions -> publish is the service's job; the screen asks for
    // the mode and nothing else. A screen that set status: "published" on the
    // create call is the defect this asserts against.
    expect(publish).toEqual({ mode: "now" });
    expect(input).toMatchObject({ classId: "class-1", subject: "Mathematics" });
    expect(input).not.toHaveProperty("status");
  });

  it("refuses a fractional mark, because every mark column downstream is an integer", async () => {
    await openBuilderWithAQuestion();
    fireEvent.click(screen.getByRole("button", { name: /Mark option A correct/ }));
    fireEvent.change(screen.getByPlaceholderText("Marks"), { target: { value: "0.5" } });
    fireEvent.click(screen.getByRole("button", { name: /Add question/ }));

    expect(await screen.findByText(/whole number of at least 1/)).toBeInTheDocument();
  });

  it("shows how many of the class have handed in, on a published test", async () => {
    listForClassDetailed.mockResolvedValue([
      {
        id: "t9", title: "Unit Test 9", status: "published", test_kind: "unit_test",
        max_mark: 3, total_marks: 3, duration_sec: 1800, instructions: null,
        created_at: "2026-09-12T10:00:00Z", published_at: "2026-09-12T10:00:00Z",
        scheduled_publish_at: null, chapter: null, topic: null, subject: "Mathematics",
        question_count: 3, submitted_count: 7, roll_count: 32,
        my_status: null, my_mark: null, my_submitted_at: null,
      },
    ]);
    render(<LiveTestsTab classId="class-1" subject="Mathematics" />);
    expect(await screen.findByText(/7 of 32 handed in/)).toBeInTheDocument();
    expect(screen.getByText(/3 Q/)).toBeInTheDocument();
  });
});
