/**
 * When a plan refuses a Nova turn, the chat shows the plan notice — not a
 * reply bubble, and not the "AI unavailable" billing message.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const askAiCoach = vi.hoisted(() => vi.fn());
const premiumChanged = vi.hoisted(() => vi.fn());

vi.mock("@/academic/ai/gatewayClient", async (orig) => ({
  ...(await orig<typeof import("@/academic/ai/gatewayClient")>()),
  askAiCoach,
}));
vi.mock("@/hooks/usePremiumStatus", () => ({ premiumChanged, usePremiumStatus: () => ({ status: null }) }));
vi.mock("@/gurukul/StudentContext", () => ({
  useGurukulStudent: () => ({ name: "Riya Verma" }),
  useGurukulAcademicIdentity: () => ({ schoolKind: "individual", examName: "CUET", examCode: "cuet" }),
}));
vi.mock("@/academic/hooks/useAcademicContext", () => ({
  useAcademicContext: () => ({ studentId: "s1", schoolId: "sch1", ctx: null, ready: true }),
}));
vi.mock("@/auth", () => ({ useAuth: () => ({ user: { id: "u1" }, role: "student" }) }));
vi.mock("@/gurukul/nova/NovaRevisionMode", () => ({
  NovaModeSwitch: () => null,
  NovaRevisionMode: () => null,
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

// jsdom has no layout, so no scrollIntoView; the chat calls it after every message.
Element.prototype.scrollIntoView = vi.fn();

const { default: AICoach } = await import("./AICoach");

const REFUSAL = {
  text: "You've used today's 5 Nova messages. Upgrade your plan for more.",
  response: {
    request_id: "r1",
    feature_id: "student.nova.chat",
    decision: "plan_limit",
    route_class: "premium",
    used_model: false,
    cache_hit: false,
    data: null,
    error_code: "plan_limit",
    message: "You've used today's 5 Nova messages. Upgrade your plan for more.",
    premium: { ok: false, applies: true, enforced: true, tier: "free", feature: "nova.message", period: "day", limit: 5, used: 5, remaining: 0, reason: "limit_reached" },
  },
};

beforeEach(() => {
  localStorage.clear();
  askAiCoach.mockReset();
  premiumChanged.mockReset();
});

describe("a Nova turn the plan refuses", () => {
  it("shows the plan notice with its reset time and a way to plans, and re-reads the plan", async () => {
    askAiCoach.mockResolvedValueOnce(REFUSAL);
    render(<MemoryRouter><AICoach /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/Ask about a concept/), { target: { value: "What is goodwill?" } });
    fireEvent.click(screen.getByLabelText("Send message"));

    await waitFor(() => expect(screen.getByText("You've used today's 5 Nova messages.")).toBeTruthy());
    expect(screen.getByText(/It resets at midnight/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "See plans" })).toBeTruthy();
    expect(premiumChanged).toHaveBeenCalled();
    // CONTROL: the refusal is not dressed up as the AI being unavailable.
    expect(screen.queryByText(/temporarily unavailable/i)).toBeNull();
  });

  it("CONTROL: an ordinary reply is still a reply", async () => {
    askAiCoach.mockResolvedValueOnce({
      text: "Goodwill is the value of a firm's reputation.",
      response: { request_id: "r2", feature_id: "student.nova.chat", decision: "answered_model", route_class: "personalised_intelligence", used_model: true, cache_hit: false, data: { reply: "x" } },
    });
    render(<MemoryRouter><AICoach /></MemoryRouter>);
    fireEvent.change(screen.getByPlaceholderText(/Ask about a concept/), { target: { value: "What is goodwill?" } });
    fireEvent.click(screen.getByLabelText("Send message"));
    // The reply shows in the bubble and in the conversation list preview.
    await waitFor(() => expect(screen.getAllByText(/Goodwill is the value/).length).toBeGreaterThan(0));
    expect(premiumChanged).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "See plans" })).toBeNull();
  });
});
