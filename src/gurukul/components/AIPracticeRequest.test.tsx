import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * AI Practice's request box (owner's ruling 2026-10-02): what the student types
 * goes to ai-practice; a session it returns is handed over, a refusal is said
 * in the student's language, and the plan's limit stops the button.
 */
const svc = vi.hoisted(() => ({ request: vi.fn(), recent: vi.fn() }));
vi.mock("@/lib/aiPractice", async (orig) => ({
  ...(await orig<typeof import("@/lib/aiPractice")>()),
  requestAIPractice: (...a: unknown[]) => svc.request(...a),
  listRecentAIPractice: (...a: unknown[]) => svc.recent(...a),
}));
vi.mock("@/hooks/useAuth", () => {
  const value = { user: { id: "u1" } };
  return { useAuth: () => value };
});
const premium = vi.hoisted(() => ({ status: null as unknown }));
vi.mock("@/hooks/usePremiumStatus", () => ({ usePremiumStatus: () => ({ status: premium.status }), premiumChanged: () => {} }));
const toast = vi.hoisted(() => ({ message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { AIPracticeRequest } from "./AIPracticeRequest";
import { AI_PRACTICE_PROMPT_MAX } from "@/lib/aiPractice";

const ready = {
  status: "ready", requestId: "r1", questionIds: ["q1", "q2"], fromBank: 1, written: 1,
  subject: "Accountancy", chapter: "Accounting for Partnership", topic: null, message: null,
};

function show(onReady = vi.fn()) {
  render(<MemoryRouter><AIPracticeRequest accentColor="hsl(0 0% 50%)" onReady={onReady} /></MemoryRouter>);
  return onReady;
}
const box = () => screen.getByLabelText("What do you want to practise?") as HTMLTextAreaElement;
const go = () => screen.getByRole("button", { name: /Make my practice session/ });

beforeEach(() => {
  svc.request.mockReset();
  svc.recent.mockReset().mockResolvedValue([{ id: "a", prompt: "10 hard ratio questions", status: "ready", createdAt: "" }]);
  premium.status = null;
  toast.message.mockReset();
});

describe("asking AI Practice", () => {
  it("the app's prompt limit is the function's", () => {
    const fn = readFileSync(join(process.cwd(), "supabase/functions/_shared/aiPractice.ts"), "utf8");
    expect(fn).toContain(`export const PROMPT_MAX_CHARS = ${AI_PRACTICE_PROMPT_MAX};`);
  });

  it("never invites assertion–reason, which the real paper does not set (A1, ruled 2026-10-09)", () => {
    const { container } = render(<MemoryRouter><AIPracticeRequest accentColor="hsl(0 0% 50%)" onReady={vi.fn()} /></MemoryRouter>);
    expect(container.textContent).toContain("match the following");
    expect(container.textContent).not.toMatch(/assertion/i);
  });

  it("nothing to ask, nothing to send; an example or an earlier request fills the box", async () => {
    show();
    expect(go()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "20 medium questions on goodwill valuation" }));
    expect(box().value).toBe("20 medium questions on goodwill valuation");
    fireEvent.click(await screen.findByRole("button", { name: "10 hard ratio questions" }));
    expect(box().value).toBe("10 hard ratio questions");
    expect(go()).toBeEnabled();
  });

  it("a session that comes back is handed over, with what was asked sent as typed", async () => {
    svc.request.mockResolvedValue({ ok: true, result: ready });
    const onReady = show();
    fireEvent.change(box(), { target: { value: "  goodwill, 2 questions  " } });
    fireEvent.click(go());
    await waitFor(() => expect(onReady).toHaveBeenCalledWith(ready));
    expect(svc.request).toHaveBeenCalledWith("goodwill, 2 questions");
  });

  it("a short session still starts, and says why it is short", async () => {
    svc.request.mockResolvedValue({ ok: true, result: { ...ready, status: "short", message: "2 of the 5 questions passed the answer check." } });
    const onReady = show();
    fireEvent.change(box(), { target: { value: "5 on goodwill" } });
    fireEvent.click(go());
    await waitFor(() => expect(onReady).toHaveBeenCalled());
    expect(toast.message).toHaveBeenCalledWith("2 of the 5 questions passed the answer check.");
  });

  it("a refusal is said to the student, and no session starts", async () => {
    svc.request.mockResolvedValue({ ok: true, result: { ...ready, status: "refused", questionIds: [], message: "Physics isn't one of your subjects." } });
    const onReady = show();
    fireEvent.change(box(), { target: { value: "physics please" } });
    fireEvent.click(go());
    expect(await screen.findByRole("alert")).toHaveTextContent("Physics isn't one of your subjects.");
    expect(onReady).not.toHaveBeenCalled();
  });

  it("a plan that has run out says so and stops the button", async () => {
    svc.request.mockResolvedValue({
      ok: false, error: "You have used today's AI Practice requests.",
      planLimit: { feature: "ai_practice.request", reason: "limit_reached", message: "You have used today's 2 AI Practice requests.", decision: { ok: false, feature: "ai_practice.request" } },
    });
    show();
    fireEvent.change(box(), { target: { value: "goodwill" } });
    fireEvent.click(go());
    expect(await screen.findByText(/today's 2 AI Practice requests/)).toBeInTheDocument();
    expect(go()).toBeDisabled();
  });
});
