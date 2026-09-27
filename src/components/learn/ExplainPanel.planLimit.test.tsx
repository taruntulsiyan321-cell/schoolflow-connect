/**
 * Explain my mistake is from the first paid plan. When ai-explain refuses,
 * the student still gets the saved correct answer, and the plan notice says
 * why there is no live explanation — not "Live explanation is unavailable".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const invoke = vi.fn();
vi.mock("@/lib/edgeFunction", () => ({ invokeEdgeFunction: (...a: unknown[]) => invoke(...a) }));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

const { ExplainPanel } = await import("./ExplainPanel");
const { planLimitFrom } = await import("@/lib/premium");

const show = () =>
  render(
    <MemoryRouter>
      <ExplainPanel question="2 + 2?" options={["3", "4"]} correctIndex={1} selectedIndex={0} wasCorrect={false} />
    </MemoryRouter>,
  );

beforeEach(() => invoke.mockReset());

describe("ExplainPanel — a plan without Explain my mistake", () => {
  it("shows the notice and the saved answer, and does not call it unavailable", async () => {
    const planLimit = planLimitFrom({ error_code: "plan_limit", premium: { ok: false, feature: "mistake.explain", reason: "not_in_plan" } });
    invoke.mockResolvedValue({ data: null, error: planLimit!.message, planLimit });
    show();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Explain my mistake" })); });
    expect(screen.getByRole("status").textContent).toContain("Explain my mistake is not in your plan.");
    expect(screen.queryByText(/Live explanation is unavailable/)).toBeNull();
    // The saved explanation, built from the question itself, still shows.
    expect(screen.getByText(/^Correct answer: .*4\.$/)).toBeTruthy();
  });

  it("CONTROL: any other failure still says the live explanation is unavailable", async () => {
    invoke.mockResolvedValue({ data: null, error: "Service unavailable", planLimit: null });
    show();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Explain my mistake" })); });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/Live explanation is unavailable/)).toBeTruthy();
  });
});
