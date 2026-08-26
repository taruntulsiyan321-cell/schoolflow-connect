import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * Regression test for a crash that reached production.
 *
 * The "Recent attendance" card was refactored from a flat day grid into
 * month-grouped sections, but the refactor was left half-applied: the JSX
 * still rendered `calendarDays` (deleted) and the grouping memo referenced
 * `RECENT_MONTHS` (never defined). `tsc` caught both, but nothing in CI ran
 * `tsc -p tsconfig.app.json`, and esbuild happily bundles unknown identifiers
 * as runtime globals -- so `npm run build` passed and the page threw
 * "calendarDays is not defined" the moment a student opened it.
 *
 * Rendering the real component is the point: only an actual render executes
 * the JSX body where the undefined identifier lived. A test that merely
 * imported the module would have stayed green through the entire outage.
 */

// Fixtures live inside the factories: vi.mock is hoisted above every top-level
// binding, so closing over a module-scope const throws at import time.
vi.mock("@/academic", () => ({
  AcademicProfileService: {
    get: vi.fn().mockResolvedValue({
      attendancePct: 75,
      attendancePresent: 3,
      attendanceTotal: 4,
    }),
  },
  AttendanceService: {
    listForStudent: vi.fn().mockResolvedValue([
      { id: "a1", date: "2026-08-06", status: "present" },
      { id: "a2", date: "2026-08-07", status: "absent" },
      { id: "a3", date: "2026-07-15", status: "late" },
      // Deliberately far in the past: proves grouping is by real month, not by
      // day-of-month. Pre-refactor this rendered as a bare "2" beside August's
      // "6 7" with nothing on screen distinguishing them.
      { id: "a4", date: "2020-01-02", status: "present" },
    ]),
  },
  useAcademicLive: () => 0,
}));

vi.mock("@/academic/hooks/useAcademicContext", () => ({
  useAcademicContext: () => ({
    ctx: { schoolId: "school-1", userId: "user-1", role: "student", studentId: "stu-1" },
    ready: true,
    studentId: "stu-1",
  }),
}));

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));

import Attendance from "./Attendance";

describe("Attendance page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders without throwing on undefined identifiers", async () => {
    const { container } = render(<Attendance />);
    // The overall-attendance tile is outside the month grid, so it proves the
    // component got past the card that used to throw. Matched against
    // textContent because `{pct}%` renders as two adjacent text nodes.
    await waitFor(() => expect(container.textContent).toContain("75%"));
    expect(container.textContent).toContain("3 present-equivalent");
  });

  it("groups recent attendance under explicit month headings", async () => {
    render(<Attendance />);
    await waitFor(() => expect(screen.getByText("August 2026")).toBeTruthy());
    expect(screen.getByText("July 2026")).toBeTruthy();
  });

  it("caps the card at RECENT_MONTHS newest months", async () => {
    render(<Attendance />);
    await waitFor(() => expect(screen.getByText("August 2026")).toBeTruthy());
    // 3 distinct months exist within the cap, so January 2020 is the 3rd and
    // still shown; the cap is what stops this card rendering every record ever.
    expect(screen.getByText("January 2020")).toBeTruthy();
  });

  it("shows an honest empty state when there are no records", async () => {
    const academic = await import("@/academic");
    vi.mocked(academic.AttendanceService.listForStudent).mockResolvedValueOnce([]);
    render(<Attendance />);
    await waitFor(() =>
      expect(screen.getByText("No attendance recorded yet.")).toBeTruthy(),
    );
  });
});
