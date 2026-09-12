import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * The student's Tests screen has to say which state each test is in.
 *
 * Before `rpc_test_list_for_class` it could not. Measured on the old screen:
 * the subject line was ALWAYS blank (it read `t.subject` off `tests`, which has
 * no such column — §10.22), a test the student had already submitted still
 * offered "Attempt" and sent them back into a paper where every answer save is
 * refused, and an uploaded written paper offered "Attempt" too and then
 * `rpc_test_start` refused it with "test has no questions".
 *
 * So these four are the states, and each one is a different sentence:
 *
 *   published + questions + not started   -> Attempt
 *   in progress                           -> Resume
 *   submitted                             -> Report, and the mark
 *   published + NO questions              -> no control, "sat in class"
 */
const listForClassDetailed = vi.fn();

vi.mock("@/academic", () => ({
  AnalyticsService: { forStudent: vi.fn().mockResolvedValue(null) },
  HomeworkService: { publishDueScheduled: vi.fn().mockResolvedValue(0) },
  MarksService: {
    listForStudent: vi.fn().mockResolvedValue([]),
    listExamsForClass: vi.fn().mockResolvedValue([]),
  },
  TestService: { listForClassDetailed: (...a: unknown[]) => listForClassDetailed(...a) },
  TEST_KIND_LABELS: { class_test: "Class test", unit_test: "Unit test" },
  useAcademicLive: () => 0,
}));

vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = {
    ctx: { schoolId: "school-1", userId: "user-1", role: "student", studentId: "stu-1" },
    ready: true,
    studentId: "stu-1",
    classId: "class-1",
  };
  return { useAcademicContext: () => value };
});

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import Tests from "./Tests";

const base = {
  status: "published",
  test_kind: "unit_test",
  max_mark: 3,
  total_marks: 3,
  duration_sec: 1800,
  instructions: null,
  created_at: "2026-09-12T10:00:00Z",
  published_at: "2026-09-12T10:00:00Z",
  scheduled_publish_at: null,
  chapter: "Real Numbers",
  topic: "HCF and LCM",
  subject: "Mathematics",
  submitted_count: null,
  roll_count: null,
  my_mark: null,
  my_submitted_at: null,
};

const renderTests = () =>
  render(
    <MemoryRouter>
      <Tests />
    </MemoryRouter>,
  );

describe("the student's Tests screen", () => {
  beforeEach(() => listForClassDetailed.mockReset());

  it("offers Attempt on a published test with questions, and names its subject", async () => {
    listForClassDetailed.mockResolvedValue([
      { ...base, id: "t1", title: "Unit Test 1", question_count: 3, my_status: "not_started" },
    ]);
    renderTests();

    const link = await screen.findByRole("link", { name: /Attempt/ });
    expect(link).toHaveAttribute("href", "/student/test/t1/attempt");
    // The subject line that was blank on every card before the anchor join.
    expect(screen.getByText(/Mathematics/)).toBeInTheDocument();
    expect(screen.getByText(/3 questions/)).toBeInTheDocument();
  });

  it("says Resume when the paper is already open", async () => {
    listForClassDetailed.mockResolvedValue([
      { ...base, id: "t2", title: "Unit Test 2", question_count: 3, my_status: "in_progress" },
    ]);
    renderTests();
    const link = await screen.findByRole("link", { name: /Resume/ });
    expect(link).toHaveAttribute("href", "/student/test/t2/attempt");
  });

  it("routes a submitted test to its report and shows the mark, not another Attempt", async () => {
    listForClassDetailed.mockResolvedValue([
      {
        ...base,
        id: "t3",
        title: "Unit Test 3",
        question_count: 3,
        my_status: "submitted",
        my_mark: 2,
        my_submitted_at: "2026-09-12T11:00:00Z",
      },
    ]);
    renderTests();

    const link = await screen.findByRole("link", { name: /Report/ });
    expect(link).toHaveAttribute("href", "/student/test/t3/result");
    expect(screen.getByText(/Scored 2 \/ 3/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Attempt/ })).not.toBeInTheDocument();
  });

  /**
   * A submitted test whose mark was never recorded is not a zero (§7). It says
   * so rather than printing 0.
   */
  it("says a submitted test has no mark rather than showing 0", async () => {
    listForClassDetailed.mockResolvedValue([
      { ...base, id: "t4", title: "Unit Test 4", question_count: 3, my_status: "submitted", my_mark: null },
    ]);
    renderTests();
    expect(await screen.findByText(/Submitted — mark not recorded/)).toBeInTheDocument();
  });

  it("offers no attempt on a written paper, and says why", async () => {
    listForClassDetailed.mockResolvedValue([
      { ...base, id: "t5", title: "Half-yearly paper", question_count: 0, my_status: "not_started", duration_sec: null },
    ]);
    renderTests();

    expect(await screen.findByText(/Sat in class — your teacher enters the marks/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Attempt/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Written paper/)).toBeInTheDocument();
  });

  it("says the teachers have published nothing rather than showing an empty card", async () => {
    listForClassDetailed.mockResolvedValue([]);
    renderTests();
    expect(
      await screen.findByText(/Your teachers have not published a test yet/),
    ).toBeInTheDocument();
  });
});
