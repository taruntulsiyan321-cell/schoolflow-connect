import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * The leaderboard has to show the class, mark the student, and keep moving.
 *
 * It is the one surface on the result screen that says something about other
 * children, so the things worth asserting are: it renders the names and marks
 * it is given IN THE ORDER THE DATABASE RANKED THEM (the ordering is the
 * ruling — equal marks, first finisher on top — and a client that re-sorts
 * would silently undo it), it marks the caller, it says how many of the class
 * have handed in, and a refusal reads as a sentence rather than an empty card
 * that looks like "nobody has sat it".
 *
 * `ctx` must be referentially stable: it is in the effect's dependency array,
 * and a fresh literal per render re-fires the read on every commit.
 */
const leaderboard = vi.fn();

vi.mock("@/academic", () => ({
  TestService: { leaderboard: (...args: unknown[]) => leaderboard(...args) },
}));
vi.mock("@/academic/live", () => ({ useAcademicLive: () => 0 }));

import { TestLeaderboard } from "./TestLeaderboard";

const ctx = { schoolId: "school-1", userId: "user-1", role: "student", studentId: "stu-1" } as never;

const board = {
  test_id: "t1",
  title: "Unit Test 1",
  max_mark: 3,
  subject: "Mathematics",
  submitted_count: 3,
  roll_count: 10,
  entries: [
    { student_id: "b", full_name: "Bhavna Rao", roll_number: 2, mark: 3, correct_count: 3, total_count: 3, submitted_at: "2026-09-12T10:02:00Z", rank: 1, is_me: false },
    { student_id: "a", full_name: "Arjun Mehta", roll_number: 1, mark: 2, correct_count: 2, total_count: 3, submitted_at: "2026-09-12T10:01:00Z", rank: 2, is_me: true },
    { student_id: "c", full_name: "Chirag Patel", roll_number: 3, mark: 1, correct_count: 1, total_count: 3, submitted_at: "2026-09-12T10:03:00Z", rank: 3, is_me: false },
  ],
};

describe("TestLeaderboard", () => {
  beforeEach(() => {
    leaderboard.mockReset();
  });

  it("renders the class in the order the database ranked it, and marks the caller", async () => {
    leaderboard.mockResolvedValue(board);
    render(<TestLeaderboard ctx={ctx} testId="t1" />);

    await waitFor(() => expect(screen.getByText("Bhavna Rao")).toBeInTheDocument());

    // The ORDER is the ruling. Read the rendered rows rather than the data.
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(rows[0]).toContain("Bhavna Rao");
    expect(rows[1]).toContain("Arjun Mehta");
    expect(rows[2]).toContain("Chirag Patel");

    // Rank, mark and denominator all on the row.
    expect(rows[0]).toContain("1");
    expect(rows[0]).toContain("3");
    // The caller is named as themselves, and only they are.
    expect(rows[1]).toContain("you");
    expect(rows.filter((r) => r.includes("· you"))).toHaveLength(1);

    // "3 of 10 handed in" — the count alone would hide who is missing.
    expect(screen.getByText(/3 of 10 handed in/)).toBeInTheDocument();
  });

  it("says nobody has handed in rather than rendering an empty list", async () => {
    leaderboard.mockResolvedValue({ ...board, submitted_count: 0, entries: [] });
    render(<TestLeaderboard ctx={ctx} testId="t1" />);
    await waitFor(() =>
      expect(screen.getByText(/Nobody has handed this test in yet/)).toBeInTheDocument(),
    );
  });

  /**
   * A student who has not submitted is REFUSED this board by
   * `can_read_test_leaderboard`. That refusal must read as a sentence: an empty
   * card here would say "nobody has sat it", which is a different fact and
   * usually a false one.
   */
  it("renders a refusal as a sentence, not as an empty board", async () => {
    leaderboard.mockRejectedValue(new Error("Not your class's test leaderboard"));
    render(<TestLeaderboard ctx={ctx} testId="t1" />);
    await waitFor(() =>
      expect(screen.getByText(/Not your class's test leaderboard/)).toBeInTheDocument(),
    );
    expect(screen.queryByText(/Nobody has handed this test in yet/)).not.toBeInTheDocument();
  });

  it("shows a mark that was never recorded as an em dash, never as 0", async () => {
    leaderboard.mockResolvedValue({
      ...board,
      entries: [{ ...board.entries[0], mark: null }],
    });
    render(<TestLeaderboard ctx={ctx} testId="t1" />);
    await waitFor(() => expect(screen.getByText("Bhavna Rao")).toBeInTheDocument());
    const row = screen.getAllByRole("listitem")[0].textContent ?? "";
    expect(row).toContain("—");
    expect(row).not.toMatch(/\b0\b/);
  });
});
