/**
 * Recovery and Revision say what they know: still loading, could not load, or
 * here it is — and Quick Revision only offers a check that can be given.
 *
 * Measured 2026-09-22:
 *   · both screens started loading=true and only an effect that bailed out
 *     without a student context could end it, so an account the app settled
 *     without one sat on "Loading…" for ever instead of being told why;
 *   · a failed read showed an error with no way to try again;
 *   · Revision's history said "No revision checks taken yet" while loading;
 *   · Quick Revision opened the first due chapter whatever its bank held, and
 *     one with nothing unseen left answered the tap with a toast.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const h = vi.hoisted(() => ({
  academic: { ctx: null as unknown, ready: false, settled: true },
  engine: {
    getRecoveryQueue: vi.fn(),
    countRecoverySessionsSat: vi.fn(),
    getChapterStates: vi.fn(),
    getRevisionHistory: vi.fn(),
    getRevisionSessionPlan: vi.fn(),
    startRecoverySession: vi.fn(),
  },
}));

vi.mock("@/academic", () => ({
  RecoveryEngineService: h.engine,
  useAcademicContext: () => h.academic,
}));
vi.mock("@/gurukul/StudentContext", async () => {
  const { EMPTY_STUDENT } = await import("@/gurukul/emptyStudent");
  const value = { ...EMPTY_STUDENT, streak: 0 };
  return { useGurukulStudent: () => value };
});
vi.mock("sonner", () => ({ toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() } }));

import Recovery from "./Recovery";
import Revision from "./Revision";

const CTX = { schoolId: "s", userId: "u", role: "student", studentId: "st" };
const signedIn = () => { h.academic = { ctx: CTX, ready: true, settled: true }; };
const noStudent = () => { h.academic = { ctx: null, ready: false, settled: true }; };
const page = (el: JSX.Element) => render(<MemoryRouter>{el}</MemoryRouter>);
const NOT_LINKED = "Your account isn't linked to a student record yet";

const past = new Date(Date.now() - 2 * 864e5).toISOString();
const state = (id: string, chapter: string, fresh: number) => ({
  chapter_id: id, chapter, subject: "Mathematics", state: "untouched", revision_stage: 1,
  consecutive_passes: 0, next_revision_at: past, revision_due: true, recovered_at: null,
  last_recovery_readiness: null, open_mistakes: 0, revision_fresh_available: fresh,
});
const queueRow = {
  chapter_id: "c1", chapter: "Circles", subject: "Mathematics", open_mistakes: 3, trigger_count: 1,
  ready: true, mode: "wide", planned_size: 9, relearn_above: 8, state: "has_mistakes",
  in_recovery: false, last_recovery_readiness: null, recovered_at: null, rounds_taken: 0,
};

beforeEach(() => {
  for (const f of Object.values(h.engine)) f.mockReset();
  h.engine.countRecoverySessionsSat.mockResolvedValue(0);
});

describe("Recovery", () => {
  it("tells an account with no student record why, instead of loading for ever", () => {
    noStudent();
    page(<Recovery />);
    expect(screen.getByText(NOT_LINKED)).toBeInTheDocument();
    expect(screen.queryByText("Loading recovery")).toBeNull();
    expect(h.engine.getRecoveryQueue).not.toHaveBeenCalled();
  });

  it("offers Try again after a failed read, and it reads again", async () => {
    signedIn();
    h.engine.getRecoveryQueue.mockRejectedValueOnce(new Error("57014")).mockResolvedValueOnce([queueRow]);
    page(<Recovery />);
    expect(await screen.findByText("Could not load recovery")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Circles")).toBeInTheDocument();
    expect(h.engine.getRecoveryQueue).toHaveBeenCalledTimes(2);
  });

  it("counts the sessions sat from the table, not from the chapters still in the queue", async () => {
    // A passing recovery clears its chapter out of the queue. The tile summed
    // the queue's rounds, so every recovered chapter took its sessions away.
    signedIn();
    h.engine.getRecoveryQueue.mockResolvedValue([queueRow]); // rounds_taken 0
    h.engine.countRecoverySessionsSat.mockResolvedValue(10);
    page(<Recovery />);
    const label = await screen.findByText("Sessions done");
    expect(label.parentElement?.parentElement?.textContent).toContain("10");
  });

  it("never shows an untagged chapter_id (upload §5.1)", async () => {
    // Spec: chapter_id IS NULL is practisable but excluded from recovery.
    signedIn();
    h.engine.getRecoveryQueue.mockResolvedValue([
      { ...queueRow, chapter_id: "", chapter: "Orphan" },
      queueRow,
    ]);
    page(<Recovery />);
    expect(await screen.findByText("Circles")).toBeInTheDocument();
    expect(screen.queryByText("Orphan")).toBeNull();
  });
});

describe("Revision", () => {
  it("tells an account with no student record why, instead of loading for ever", () => {
    noStudent();
    page(<Revision />);
    expect(screen.getByText(NOT_LINKED)).toBeInTheDocument();
    expect(h.engine.getChapterStates).not.toHaveBeenCalled();
  });

  it("does not claim no checks were taken while the history is still loading", async () => {
    signedIn();
    h.engine.getChapterStates.mockResolvedValue([state("a", "Circles", 5)]);
    let finish: (rows: unknown[]) => void = () => {};
    h.engine.getRevisionHistory.mockReturnValue(new Promise((r) => { finish = r; }));
    page(<Revision />);
    await screen.findByText("Circles");
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText(/No revision checks taken yet/)).toBeNull();
    finish([]);
    // The positive control: once the history has been read and is empty, it says so.
    expect(await screen.findByText(/No revision checks taken yet/)).toBeInTheDocument();
  });

  it("Quick Revision opens the first due chapter that can give a check", async () => {
    signedIn();
    h.engine.getChapterStates.mockResolvedValue([state("a", "Circles", 0), state("b", "Polynomials", 5)]);
    h.engine.getRevisionHistory.mockResolvedValue([]);
    h.engine.getRevisionSessionPlan.mockResolvedValue({ fresh: 5, fresh_short: 0, total: 5, question_ids: ["q1"], mistakes: 0 });
    page(<Revision />);
    const quick = await screen.findByRole("button", { name: /Quick Revision/ });
    expect(quick.textContent).toContain("Starts the first of 1 due check");
    fireEvent.click(quick);
    await waitFor(() => expect(h.engine.getRevisionSessionPlan).toHaveBeenCalledWith(CTX, "b"));
  });

  it("Quick Revision is shut, and says why, when no due chapter has anything new left", async () => {
    signedIn();
    h.engine.getChapterStates.mockResolvedValue([state("a", "Circles", 0)]);
    h.engine.getRevisionHistory.mockResolvedValue([]);
    page(<Revision />);
    const quick = await screen.findByRole("button", { name: /Quick Revision/ });
    expect(quick).toBeDisabled();
    expect(quick.textContent).toContain("nothing new left");
  });
});
