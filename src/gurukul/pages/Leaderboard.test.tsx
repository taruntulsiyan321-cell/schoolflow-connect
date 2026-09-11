import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * "Try again" has to actually try again.
 *
 * Three screens in the gurukul half of the student panel rendered a load
 * failure as one red line — no title, no hint, and no way forward. A student
 * who hit a transient error had to navigate away and back, because all three
 * load inside a useEffect keyed on liveVersion with no standalone loader to
 * call.
 *
 * They now render StudentErrorState, the same component the other half of the
 * panel has used all along, wired to a reload nonce. The trap this test exists
 * for: a retry button that re-renders but never re-fetches looks identical to
 * a working one in a screenshot, and identical to a working one to `tsc`.
 *
 * So this asserts the SERVICE ran again — not that a button exists, and not
 * that the error text went away.
 *
 * NOTE on the mock shape: `ctx` is in the load effect's dependency array, so
 * the context mock must return a REFERENTIALLY STABLE object. Returning a
 * fresh literal per render re-fires the effect on every commit — the first
 * draft of this test did exactly that and the service was called three times
 * before the assertion ran.
 */

const leaderboard = vi.fn();

vi.mock("@/academic", () => ({
  ProgressionService: {
    leaderboard: (...args: unknown[]) => leaderboard(...args),
  },
  useAcademicLive: () => 0,
}));

vi.mock("@/academic/hooks/useAcademicContext", () => {
  // Defined inside the factory: vi.mock is hoisted above every top-level
  // binding, so closing over a module-scope const throws at import time.
  const value = {
    ctx: { schoolId: "school-1", userId: "user-1", role: "student", studentId: "stu-1" },
    ready: true,
    studentId: "stu-1",
  };
  return { useAcademicContext: () => value };
});

vi.mock("@/hooks/useAuth", () => {
  const value = { user: { id: "user-1" } };
  return { useAuth: () => value };
});

import Leaderboard from "./Leaderboard";

const ERROR_TITLE = "Could not load the rankings";

describe("Leaderboard — the error state's retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    leaderboard.mockReset();
  });

  it("re-runs the load when Try again is pressed, and recovers", async () => {
    leaderboard
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({
        rows: [{ user_id: "user-1", name: "You", value: 120, level: 3, league: "bronze" }],
      });

    render(<Leaderboard />);

    // The failure surfaces as the shared error state, not a bare red line.
    await waitFor(() => expect(screen.getByText(ERROR_TITLE)).toBeTruthy());
    const before = leaderboard.mock.calls.length;

    // fireEvent rather than user-event: the latter is not a dependency of this
    // repo (the same call MembershipSwitcher.test.tsx made).
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    // The assertion that matters: the service ran AGAIN. A button that only
    // cleared the error would satisfy every other assertion in this test.
    await waitFor(() => expect(leaderboard.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByText(ERROR_TITLE)).toBeNull());
  });

  it("stays on the error state when the retry also fails (positive control)", async () => {
    // Without this, a retry that simply unmounted the error state would pass
    // the test above for entirely the wrong reason.
    leaderboard.mockRejectedValue(new Error("still down"));

    render(<Leaderboard />);
    await waitFor(() => expect(screen.getByText(ERROR_TITLE)).toBeTruthy());
    const before = leaderboard.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(leaderboard.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.getByText(ERROR_TITLE)).toBeTruthy());
  });
});
