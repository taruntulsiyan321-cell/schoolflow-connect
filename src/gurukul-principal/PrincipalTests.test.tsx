import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The principal's test screens, which are the only part of that portal wired to
 * the database — the rest is the fixture design its own header declares.
 *
 * What is worth asserting: the class -> test -> marks path actually walks, the
 * marks are the real ones, a student who did not sit it is shown as absent
 * rather than as a zero (§7), and the screen says out loud that marks are all
 * the principal gets, so the missing per-question detail reads as a rule rather
 * than a gap.
 */
const listForClassDetailed = vi.fn();
const classMarks = vi.fn();

vi.mock("@/academic", () => ({
  TestService: {
    listForClassDetailed: (...a: unknown[]) => listForClassDetailed(...a),
    classMarks: (...a: unknown[]) => classMarks(...a),
  },
  TEST_KIND_LABELS: { class_test: "Class test", unit_test: "Unit test" },
  useAcademicLive: () => 0,
}));

vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = { ctx: { schoolId: "school-1", userId: "p-1", role: "principal" }, ready: true };
  return { useAcademicContext: () => value };
});

// A chainable stub shaped like the two reads this screen makes.
vi.mock("@/integrations/supabase/client", () => {
  const rows: Record<string, unknown[]> = {
    classes: [{ id: "class-1", name: "10", section: "A", is_active: true }],
    students: [
      { id: "s1", class_id: "class-1" },
      { id: "s2", class_id: "class-1" },
    ],
  };
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {};
    const self = () => chain;
    for (const m of ["select", "eq", "is", "in", "order"]) chain[m] = self;
    // Awaiting the builder resolves it, the way postgrest-js does.
    chain.then = (resolve: (v: unknown) => void) =>
      resolve({ data: rows[table] ?? [], error: null });
    return chain;
  };
  return { supabase: { from: (t: string) => builder(t) } };
});

import PrincipalTests from "./PrincipalTests";

describe("the principal's test screens", () => {
  beforeEach(() => {
    listForClassDetailed.mockReset().mockResolvedValue([
      {
        id: "t1", title: "Unit Test 1", status: "published", test_kind: "unit_test",
        max_mark: 3, total_marks: 3, duration_sec: 1800, instructions: null,
        created_at: "2026-09-12T10:00:00Z", published_at: "2026-09-12T10:00:00Z",
        scheduled_publish_at: null, chapter: null, topic: null, subject: "Mathematics",
        question_count: 3, submitted_count: 1, roll_count: 2,
        my_status: null, my_mark: null, my_submitted_at: null,
      },
    ]);
    classMarks.mockReset().mockResolvedValue({
      test_id: "t1", title: "Unit Test 1", max_mark: 3, subject: "Mathematics",
      class_id: "class-1", submitted_count: 1, class_average: 2,
      students: [
        { student_id: "s1", full_name: "Arjun Mehta", roll_number: 1, mark: 2, correct_count: 2, total_count: 3, submitted_at: "2026-09-12T11:00:00Z", submitted: true },
        { student_id: "s2", full_name: "Bhavna Rao", roll_number: 2, mark: null, correct_count: null, total_count: null, submitted_at: null, submitted: false },
      ],
    });
  });

  it("walks class -> test -> marks, and shows the real marks", async () => {
    render(<PrincipalTests />);

    fireEvent.click(await screen.findByRole("button", { name: /10 A/ }));
    await waitFor(() => expect(listForClassDetailed).toHaveBeenCalledWith(expect.anything(), "class-1"));

    // "1 / 2" — handed in of the roll, not a bare count.
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Unit Test 1/ }));

    await waitFor(() => expect(classMarks).toHaveBeenCalledWith(expect.anything(), "t1"));
    // Assert on the ROW, not on a bare "2": the class average, a roll number
    // and a mark are all "2" on this fixture, and a matcher that cannot tell
    // them apart would pass against the wrong one.
    const row = (await screen.findByText("Arjun Mehta")).closest("div")?.parentElement;
    expect(row?.textContent ?? "").toMatch(/Arjun Mehta.*2 \/ 3/);
  });

  it("shows a student who did not sit it as absent, never as a zero", async () => {
    render(<PrincipalTests />);
    fireEvent.click(await screen.findByRole("button", { name: /10 A/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Unit Test 1/ }));

    expect(await screen.findByText("Not submitted")).toBeInTheDocument();
    // Bhavna is listed, unranked, with no mark invented for her.
    expect(screen.getByText("Bhavna Rao")).toBeInTheDocument();
  });

  it("says marks are all the principal gets, rather than leaving a gap", async () => {
    render(<PrincipalTests />);
    fireEvent.click(await screen.findByRole("button", { name: /10 A/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Unit Test 1/ }));

    expect(
      await screen.findByText(/Which questions a student got wrong is theirs and their teacher's/),
    ).toBeInTheDocument();
  });
});
