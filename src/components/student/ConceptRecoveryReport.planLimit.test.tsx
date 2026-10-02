/**
 * "Get insights" (ai-concept-report) is from the first paid plan. Its failure
 * — a plan refusal or anything else — is the AI step's, and must not replace
 * the report the student already has with the card's own failure line.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
const report = {
  source_type: "practice_session", source_id: "s1", accuracy_pct: 40, correct_count: 2, total_count: 5, time_minutes: 3,
  weak_concepts: [{ subject: "Accountancy", chapter: "Ratio Analysis", concept: "Liquidity ratios", accuracy: 20 }],
};
vi.mock("@/lib/edgeFunction", () => ({ invokeEdgeFunction: (...a: unknown[]) => invoke(...a) }));
let loadError: { message: string; code?: string } | null = null;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) =>
      Promise.resolve(fn === "rpc_get_concept_recovery_report" ? { data: loadError ? null : report, error: loadError } : { data: null, error: null }),
  },
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

const { ConceptRecoveryReport } = await import("./ConceptRecoveryReport");
const { planLimitFrom } = await import("@/lib/premium");

async function getInsights() {
  render(<MemoryRouter><ConceptRecoveryReport sourceType="practice_session" sourceId="s1" /></MemoryRouter>);
  const button = await screen.findByRole("button", { name: "Get insights" });
  await act(async () => { fireEvent.click(button); });
}

beforeEach(() => {
  invoke.mockReset();
  loadError = null;
});

describe("ConceptRecoveryReport — the AI step's refusal", () => {
  it("a plan refusal shows the notice and keeps the report", async () => {
    const planLimit = planLimitFrom({ error_code: "plan_limit", premium: { ok: false, feature: "insights.report", reason: "not_in_plan" } });
    invoke.mockResolvedValue({ data: null, error: planLimit!.message, planLimit });
    await getInsights();
    expect(screen.getByRole("status").textContent).toContain("AI insights coach is not in your plan.");
    expect(screen.queryByText(/no concept analysis|couldn't load the concept analysis/i)).toBeNull();
    expect(screen.getAllByText(/Liquidity ratios/).length).toBeGreaterThan(0);
  });

  it("any other failure is a line on the card, not the end of the card", async () => {
    invoke.mockResolvedValue({ data: null, error: "Model timed out", planLimit: null });
    await getInsights();
    expect(screen.getByRole("alert").textContent).toContain("Model timed out");
    expect(screen.queryByText(/no concept analysis|couldn't load the concept analysis/i)).toBeNull();
    expect(screen.getAllByText(/Liquidity ratios/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("CONTROL: insights that arrive replace the rule-based ones", async () => {
    invoke.mockResolvedValue({ data: { headline: "Work on liquidity first", bullets: [], next_steps: [] }, error: null, planLimit: null });
    await getInsights();
    expect(screen.getByText("Work on liquidity first")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("ConceptRecoveryReport — a report that will not load", () => {
  it("says so in a student's words, never the database's", async () => {
    loadError = { message: 'relation "concept_recovery_report_cache" does not exist', code: "42P01" };
    render(<MemoryRouter><ConceptRecoveryReport sourceType="practice_session" sourceId="s1" /></MemoryRouter>);
    const card = await screen.findByText(/./, { selector: ".wa-card" });
    expect(card.textContent?.trim().length).toBeGreaterThan(10);
    expect(card.textContent).not.toMatch(/relation|concept_recovery_report_cache|42P01/);
    // CONTROL: the same card with the report shows its concepts.
    loadError = null;
    render(<MemoryRouter><ConceptRecoveryReport sourceType="practice_session" sourceId="s1" /></MemoryRouter>);
    expect((await screen.findAllByText(/Liquidity ratios/)).length).toBeGreaterThan(0);
  });
});
