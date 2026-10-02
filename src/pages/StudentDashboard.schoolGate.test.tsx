/**
 * A school account is sent to /unauthorized by the student shell — and reads
 * nothing on the way out.
 *
 * The live app is the individual panel (2026-10-01). The redirect is a render
 * return, so the shell's effects still ran on that render: the profile read,
 * the progression snapshot and the academic snapshot. Measured live the same
 * day, the QA school student's academic snapshot hit a statement timeout (500)
 * on its way to /unauthorized. The loader now refuses a school account itself.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
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
vi.mock("@/gurukul/components/Layout", () => ({ default: ({ children }: { children: unknown }) => children }));
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
vi.mock("./student/MockAttempt", stub);
vi.mock("./student/MockResult", stub);

const { default: StudentDashboard } = await import("./StudentDashboard");

function show() {
  let at = "";
  const Where = () => { at = "/unauthorized"; return null; };
  render(
    <MemoryRouter initialEntries={["/student"]}>
      <Routes>
        <Route path="/student/*" element={<StudentDashboard />} />
        <Route path="/unauthorized" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
  return { at: () => at };
}

beforeEach(() => {
  calls.from = [];
  calls.snapshot = 0;
  calls.progression = 0;
});

describe("the student shell and a school account", () => {
  it("sends a school student to /unauthorized and reads nothing for them", async () => {
    academic.current = academic.school;
    const view = show();
    await waitFor(() => expect(view.at()).toBe("/unauthorized"));
    // Let any effect that did fire reach its awaits.
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.from).toEqual([]);
    expect(calls.progression).toBe(0);
    expect(calls.snapshot).toBe(0);
  });

  it("CONTROL: an individual student's shell does read all three", async () => {
    // Without this, the test above would pass on a shell that never loads.
    academic.current = academic.individual;
    const view = show();
    await waitFor(() => expect(calls.snapshot).toBe(1));
    expect(calls.from).toEqual(["students_current"]);
    expect(calls.progression).toBe(1);
    expect(view.at()).toBe("");
  });
});
