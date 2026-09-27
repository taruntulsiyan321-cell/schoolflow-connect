import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * A plan's daily practice allowance, as the session sees it: sized before it
 * starts, and stopped with the plan notice when the server refuses an answer.
 * The server is what refuses (rpc_record_question_attempt); this is the screen
 * not handing out questions that cannot be answered.
 */

const recordAttempt = vi.fn();
const start = vi.fn();
const status = vi.hoisted(() => ({ value: null as unknown }));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ session: { access_token: "t" } }) }));
vi.mock("@/academic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/academic")>();
  const value = { ctx: { schoolId: "school-1", userId: "user-1", role: "student", studentId: "stu-1" }, ready: true, settled: true };
  return {
    ...actual,
    useAcademicContext: () => value,
    PracticeService: {
      ...actual.PracticeService,
      listBankQuestions: async () => [
        { id: "q1", question: "First?", options: ["A1", "B1", "C1", "D1"], subject: "Accountancy", chapter: "Ratio Analysis", difficulty: "easy", chapter_id: "c1" },
        { id: "q2", question: "Second?", options: ["A2", "B2", "C2", "D2"], subject: "Accountancy", chapter: "Ratio Analysis", difficulty: "easy", chapter_id: "c1" },
      ],
      start: (...a: unknown[]) => start(...a),
      recordAttempt: (...a: unknown[]) => recordAttempt(...a),
    },
  };
});
vi.mock("@/lib/premium", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/premium")>()),
  fetchPremiumStatus: () => Promise.resolve(status.value),
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

const { Session } = await import("@/gurukul/pages/Practice");
const { PlanLimitError, planLimitFrom } = await import("@/lib/premium");

const CONFIG = { mode: "subject", label: "Subject Practice", subject: "Accountancy", difficulty: "mixed", qCount: 2, timeLimitSec: null } as const;

function withPractice(d: Record<string, unknown>) {
  return {
    individual: true, enforced: true, sales_enabled: false, terms_version: "", tier: "free", tier_rank: 0, tier_until: null,
    entitlements: [], tiers: [], products: [],
    features: [{ feature: "practice.question", period: "day", limit: 20, applies: true, enforced: true, ...d }],
  };
}

const show = () =>
  render(
    <MemoryRouter>
      <Session config={CONFIG as never} onFinish={() => {}} onBack={() => {}} subjects={[]} />
    </MemoryRouter>,
  );

beforeEach(() => {
  recordAttempt.mockReset();
  start.mockReset();
  start.mockResolvedValue("sid-1");
});

describe("Practice — the day's allowance", () => {
  it("with nothing left today, shows the plan notice and starts no session", async () => {
    status.value = withPractice({ ok: false, used: 20, remaining: 0, reason: "limit_reached" });
    show();
    await screen.findByText("You've used today's 20 practice questions.");
    expect(screen.getByText(/It resets at midnight/)).toBeTruthy();
    expect(screen.queryByText("First?")).toBeNull();
    expect(start).not.toHaveBeenCalled();
  });

  it("with one left, sits one question and says why", async () => {
    status.value = withPractice({ ok: true, used: 19, remaining: 1 });
    show();
    await screen.findByText("First?");
    expect(screen.getByText(/Q1 of 1/)).toBeTruthy();
    expect(screen.getByText("1 practice question left today on your plan.")).toBeTruthy();
    expect(start.mock.calls[0][1]).toMatchObject({ _count: 1 });
  });

  it("when the server refuses an answer mid-session, shows the notice and a way to finish", async () => {
    status.value = withPractice({ ok: true, used: 5, remaining: 15 });
    const refusal = planLimitFrom({ message: "plan_limit:practice.question", details: JSON.stringify({ ok: false, feature: "practice.question", period: "day", limit: 20, used: 20, remaining: 0, reason: "limit_reached", applies: true, enforced: true }) })!;
    recordAttempt.mockRejectedValueOnce(new PlanLimitError(refusal));
    show();
    fireEvent.click(await screen.findByRole("button", { name: /^A\s*A1/ }));
    await act(async () => {});
    expect(screen.getByText("You've used today's 20 practice questions.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish with the questions you answered" })).toBeTruthy();
    // CONTROL: not the generic "will be sent again" failure.
    expect(screen.queryByText(/will be sent again/)).toBeNull();
  });

  it("CONTROL: while plans are not enforced, nothing is held back", async () => {
    status.value = withPractice({ ok: true, enforced: false, used: 30, remaining: 0, would_deny: "limit_reached" });
    show();
    await screen.findByText("First?");
    expect(screen.getByText(/Q1 of 2/)).toBeTruthy();
    expect(screen.queryByText(/left today/)).toBeNull();
  });
});
