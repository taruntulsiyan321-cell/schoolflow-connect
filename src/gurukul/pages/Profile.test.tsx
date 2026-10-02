import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/**
 * The individual student's profile: their name, their exam and their
 * progress. The school student's blocks — homework, test and exam marks,
 * teacher remarks, class rank, roll number, parent contact — are not part of
 * the live app (2026-10-01) and must not render, even for a row that carries
 * school data.
 */
const getSnapshot = vi.fn();

vi.mock("@/academic", () => ({
  ProgressionService: { getSnapshot: (...a: unknown[]) => getSnapshot(...a) },
  useAcademicLive: () => 0,
}));
vi.mock("@/academic/hooks/useAcademicContext", () => {
  const value = { ctx: { schoolId: "space-1", userId: "user-1", role: "student" }, ready: true, studentId: "stu-1" };
  return { useAcademicContext: () => value };
});
vi.mock("@/hooks/useAuth", () => {
  const value = { user: { id: "user-1" }, signOut: vi.fn() };
  return { useAuth: () => value };
});
vi.mock("@/hooks/useStudentBadges", () => {
  const value = { earned: [], loading: false };
  return { useStudentBadges: () => value };
});
vi.mock("@/gurukul/StudentContext", () => ({
  useGurukulAcademicIdentity: () => ({ schoolKind: "individual", examName: "CUET UG", examCode: "CUET" }),
}));
vi.mock("@/components/battleground/EquippedBadge", () => ({ EquippedBadge: () => null }));
const selected = vi.hoisted(() => ({ columns: "" }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  chain.select = (cols: string) => { selected.columns = cols; return chain; };
  chain.eq = () => chain;
  // A row WITH school data, to prove none of it is shown.
  chain.maybeSingle = async () => ({
    data: { full_name: "Asha Rao", roll_number: 7, parent_name: "R. Rao", parent_mobile: "9999999999" },
    error: null,
  });
  return { supabase: { from: () => chain } };
});

import Profile from "./Profile";

describe("the individual student's profile", () => {
  it("shows their name, their exam and their progress", async () => {
    getSnapshot.mockResolvedValue({
      xp: 120, level: 2, xp_into_level: 20, xp_to_next_level: 80, level_progress_pct: 20,
      league: { label: "Bronze" }, study_streak: 3, featured_badges: [],
    });
    render(<Profile />);
    expect(await screen.findByText("Asha Rao")).toBeTruthy();
    expect(screen.getByText("CUET UG")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Level 2 · Bronze · 120 XP · Streak 3d/)).toBeTruthy());
    // It asks the student row for the name alone.
    expect(selected.columns).toBe("full_name");
  });

  it("renders none of the school student's blocks or fields", async () => {
    getSnapshot.mockResolvedValue(null);
    render(<Profile />);
    await screen.findByText("Asha Rao");
    for (const text of [/Homework handed in/, /Last 10 test marks/, /Exam marks/, /Teacher remarks/, /Rankings/, /Class rank/, /Roll 7/, /Parent:/, /helper points/]) {
      expect(screen.queryByText(text), String(text)).toBeNull();
    }
    // CONTROL: the page did render its individual blocks.
    expect(screen.getByText("Recent milestones")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});
