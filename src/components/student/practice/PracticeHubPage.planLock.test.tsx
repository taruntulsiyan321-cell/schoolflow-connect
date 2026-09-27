/**
 * The Practice hub's weak topics, for a plan without topic-wise analysis
 * (20261112000000). The snapshot sends weak_topics empty and flagged; the hub
 * then must not rebuild the same list from concept mastery.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const state = vi.hoisted(() => ({ locked: true }));

vi.mock("@/academic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/academic")>();
  const value = { ctx: null, ready: false };
  return { ...actual, useAcademicContext: () => value };
});
vi.mock("@/hooks/useStudentAcademicSnapshot", () => ({
  useStudentAcademicSnapshot: () => ({
    data: { weak_topics: [], activity_heatmap: [], ...(state.locked ? { topic_analysis_locked: true } : {}) },
    loading: false,
  }),
}));
vi.mock("@/hooks/useConceptMastery", () => ({
  useConceptMastery: () => ({
    items: [{ subject: "Accountancy", chapter: "Ratio Analysis", concept: "Liquidity ratios", mastery_score: 20, total_attempts: 12, correct_attempts: 2, recovery_attempts: 0, mistake_count: 5 }],
    loading: false,
  }),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

const { default: PracticeHubPage } = await import("./PracticeHubPage");
const show = () => render(<MemoryRouter><PracticeHubPage /></MemoryRouter>);

beforeEach(() => { state.locked = true; });

describe("Practice hub — topic-wise analysis outside the plan", () => {
  it("says the plan does not cover it, and names no weak topic", () => {
    show();
    expect(screen.getByRole("status").textContent).toContain("Topic-wise analysis is not in your plan.");
    expect(screen.queryByText(/Liquidity ratios/)).toBeNull();
  });

  it("CONTROL: with it in the plan, the concept fallback names the weak topic", () => {
    state.locked = false;
    show();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getAllByText(/Liquidity ratios/).length).toBeGreaterThan(0);
  });
});
