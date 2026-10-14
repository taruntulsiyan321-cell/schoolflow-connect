/**
 * A student sitting a mock paper gets no app chrome (StudentDashboard,
 * isSittingAMock), and Nova on every screen (D2, NovaPopup) lives in that chrome.
 * So the paper has no Nova: it cannot answer the paper's questions.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const calls = vi.hoisted(() => ({ from: [] as string[], snapshot: 0, progression: 0 }));
// Stable objects, as the real context provides: a fresh ctx per render would
// re-create the loader every render and loop it.
const academic = vi.hoisted(() => {
  const ctx = { schoolId: "s1", userId: "u1", role: "student" };
  const identity = (schoolKind: "school" | "individual") =>
    ({ schoolKind, examId: null, examCode: null, examName: "CUET" });
  const value = (schoolKind: "school" | "individual") => ({
    ready: true, ctx, studentId: "st1", schoolId: "s1", classId: null, identity: identity(schoolKind),
  });
  return { current: value("school"), school: value("school"), individual: value("individual") };
});

const stable = vi.hoisted(() => ({ auth: { user: { id: "u1" } }, capture: {} }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => stable.auth }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      calls.from.push(table);
      const q = { select: () => q, eq: () => q, maybeSingle: () => Promise.resolve({ data: null, error: null }) };
      return q;
    },
  },
}));
vi.mock("@/hooks/useStudentAcademicSnapshot", () => ({
  readStudentAcademicSnapshot: () => { calls.snapshot += 1; return Promise.resolve(null); },
}));
vi.mock("@/academic", () => ({
  useAcademicLive: () => 0,
  useAcademicContext: () => academic.current,
  ProgressionService: {
    getSnapshot: () => { calls.progression += 1; return Promise.resolve(null); },
  },
}));
vi.mock("@/hooks/useScreenCaptureMistakes", () => ({ useScreenCaptureMistakes: () => stable.capture }));
vi.mock("sonner", () => ({ toast: { error: () => {} } }));

// The screens are not under test: stub every one the shell routes to.
const stub = vi.hoisted(() => () => ({ default: () => null }));
// The shell marks itself: Nova (D2) lives in it, so where the shell is not, Nova is not.
vi.mock("@/gurukul/components/Layout", () => ({ default: ({ children }: { children: unknown }) => <div data-testid="shell">{children as never}</div> }));
vi.mock("@/gurukul/StudentContext", () => ({ GurukulStudentProvider: ({ children }: { children: unknown }) => children }));
vi.mock("@/gurukul/components/ScreenCaptureMistakesCard", () => ({ ScreenCaptureMistakesCard: () => null }));
vi.mock("@/gurukul/pages/Dashboard", stub);
vi.mock("@/gurukul/pages/Practice", stub);
vi.mock("@/gurukul/pages/AICoach", stub);
vi.mock("@/gurukul/pages/Analysis", stub);
vi.mock("@/gurukul/pages/Recovery", stub);
vi.mock("@/gurukul/pages/Revision", stub);
vi.mock("@/gurukul/pages/MistakeBook", stub);
vi.mock("@/gurukul/pages/Achievements", stub);
vi.mock("@/gurukul/pages/Premium", stub);
vi.mock("@/gurukul/pages/MockTests", stub);
vi.mock("@/gurukul/pages/Profile", stub);
vi.mock("@/gurukul/pages/Notifications", stub);
vi.mock("./student/PracticeSessionResult", stub);
vi.mock("./student/MockAttempt", () => ({ default: () => <p>the paper</p> }));
vi.mock("./student/MockResult", stub);

const { default: StudentDashboard } = await import("./StudentDashboard");

const show = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/student/*" element={<StudentDashboard />} />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  academic.current = academic.individual;
});

describe("a mock paper is sat without the app shell, so without Nova (D2)", () => {
  it("the paper renders on its own: no shell, so no Nova to answer its questions", async () => {
    show("/student/mock/attempt-1");
    expect(await screen.findByText("the paper")).toBeInTheDocument();
    expect(screen.queryByTestId("shell")).toBeNull();
  });

  it("CONTROL: every other screen renders inside the shell, where Nova is", () => {
    show("/student/practice");
    expect(screen.getByTestId("shell")).toBeInTheDocument();
  });
});
