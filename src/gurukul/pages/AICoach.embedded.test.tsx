/**
 * Nova embedded in the pop-up (D2) is the AI Coach page laid out for a panel:
 * the screen underneath keeps its address and its heading, and a question
 * handed to the AI Coach page is left for that page. Each case has the page as
 * its control.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("@/academic/ai/gatewayClient", async (orig) => ({
  ...(await orig<typeof import("@/academic/ai/gatewayClient")>()),
  askAiCoach: vi.fn(() => new Promise(() => {})),
}));
vi.mock("@/hooks/usePremiumStatus", () => ({ premiumChanged: vi.fn(), usePremiumStatus: () => ({ status: null }) }));
vi.mock("@/gurukul/StudentContext", () => ({
  useGurukulStudent: () => ({ name: "Riya Verma" }),
  useGurukulAcademicIdentity: () => ({ schoolKind: "individual", examName: "CUET", examCode: "cuet" }),
}));
vi.mock("@/academic/hooks/useAcademicContext", () => ({
  useAcademicContext: () => ({ studentId: "s1", schoolId: "sch1", ctx: null, ready: true }),
}));
vi.mock("@/auth", () => ({ useAuth: () => ({ user: { id: "u1" }, role: "student" }) }));
vi.mock("@/gurukul/nova/NovaRevisionMode", () => ({
  NovaModeSwitch: ({ onChange }: { onChange: (m: "chat" | "revision") => void }) => (
    <button type="button" onClick={() => onChange("revision")}>Revision</button>
  ),
  NovaRevisionMode: () => <p>revision mode</p>,
}));
vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => false } }));

Element.prototype.scrollIntoView = vi.fn();

const { default: AICoach } = await import("./AICoach");
const { setNovaQuestionContext, consumeNovaQuestionContext } = await import("@/gurukul/novaQuestionContext");

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}

const show = (embedded: boolean) =>
  render(
    <MemoryRouter initialEntries={["/student/practice?subject=Accountancy"]}>
      <AICoach embedded={embedded} />
      <Where />
    </MemoryRouter>,
  );

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("Nova in the pop-up", () => {
  it("switches to Revision without touching the address of the screen underneath", () => {
    show(true);
    fireEvent.click(screen.getByRole("button", { name: "Revision" }));
    expect(screen.getByText("revision mode")).toBeInTheDocument();
    expect(screen.getByTestId("where")).toHaveTextContent("/student/practice?subject=Accountancy");
  });

  it("CONTROL: on the AI Coach page the mode is in the address", () => {
    show(false);
    fireEvent.click(screen.getByRole("button", { name: "Revision" }));
    expect(screen.getByTestId("where")).toHaveTextContent("?mode=revision");
  });

  it("adds no second heading to the screen underneath; the page has its own", () => {
    const { unmount } = show(true);
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
    unmount();
    show(false);
    expect(screen.getByRole("heading", { level: 1, name: "AI Coach" })).toBeInTheDocument();
  });

  it("opens the conversation list inside the panel, from a button it always shows", () => {
    show(true);
    fireEvent.click(screen.getByRole("button", { name: "Your conversations" }));
    expect(screen.getByRole("button", { name: "Your conversations" }).closest(".relative")).not.toBeNull();
    expect(document.querySelector(".absolute.inset-0.z-20")).not.toBeNull();
    expect(document.querySelector(".fixed.inset-0.z-40")).toBeNull();
  });

  it("leaves a question handed to the AI Coach page for that page", () => {
    setNovaQuestionContext({ question: "Why is goodwill written off?" });
    show(true);
    expect(consumeNovaQuestionContext()).toMatchObject({ question: "Why is goodwill written off?" });
  });

  it("CONTROL: the page takes the handed question and opens a conversation on it", () => {
    setNovaQuestionContext({ question: "Why is goodwill written off?" });
    show(false);
    expect(consumeNovaQuestionContext()).toBeNull();
    expect(screen.getAllByText(/Why is goodwill written off\?/).length).toBeGreaterThan(0);
  });
});
