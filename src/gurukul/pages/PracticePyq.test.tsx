import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * Previous Year Questions offers the years the bank holds, and says so when it
 * holds none.
 *
 * Measured 2026-09-22 on live: 0 of 21,876 bank questions carry an exam year
 * (KNOWN_ISSUES 57). The screen offered the last six calendar years anyway,
 * and every one of them — and "All years" — started a session that loaded
 * nothing. The years now come from listPyqYears, which reads them off the pool
 * the session draws from.
 */
const listPyqYears = vi.fn();

vi.mock("@/academic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/academic")>();
  const value = {
    ctx: { schoolId: "school-1", userId: "user-1", role: "student", studentId: "stu-1" },
    ready: true,
    settled: true,
  };
  return {
    ...actual,
    useAcademicContext: () => value,
    PracticeService: {
      ...actual.PracticeService,
      listPyqYears: (...a: unknown[]) => listPyqYears(...a),
    },
  };
});

const { ConfigView } = await import("@/gurukul/pages/Practice");

const SUBJECTS = {
  status: "ready" as const,
  items: [
    { id: "mathematics", name: "Mathematics", color: "#000" },
    { id: "science", name: "Science", color: "#000" },
  ],
};
const NONE = /No past-year papers have been added to the question bank/;

const renderPyq = (onStart: (cfg: unknown) => void = () => {}) =>
  render(<ConfigView modeKey="pyq" onStart={onStart} onBack={() => {}} subjectList={SUBJECTS} onRetrySubjects={() => {}} />);

const start = () => screen.getByRole("button", { name: /Start Practice/ });

describe("Previous Year Questions offers only what the bank holds", () => {
  beforeEach(() => {
    listPyqYears.mockReset();
  });

  it("says there are no past papers, offers no year, and cannot be started — the live bank today", async () => {
    listPyqYears.mockResolvedValue([]);
    renderPyq();
    expect(await screen.findByText(NONE)).toBeInTheDocument();
    expect(start()).toBeDisabled();
    // The six calendar years it used to offer, whatever the bank held.
    const lastYear = new Date().getFullYear() - 1;
    expect(screen.queryByRole("button", { name: new RegExp(`^${lastYear}`) })).toBeNull();
    expect(screen.queryByRole("button", { name: /All years/ })).toBeNull();
  });

  it("POSITIVE CONTROL: offers each year the bank holds, with its count, and starts on the one picked", async () => {
    listPyqYears.mockResolvedValue([{ year: 2024, count: 12 }, { year: 2022, count: 3 }]);
    const onStart = vi.fn();
    renderPyq(onStart);
    expect(await screen.findByRole("button", { name: "All years · 15" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2022 · 3" })).toBeInTheDocument();
    expect(screen.queryByText(NONE)).toBeNull();
    expect(start()).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "2024 · 12" }));
    fireEvent.click(start());
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.calls[0][0]).toMatchObject({ mode: "pyq", pyqYear: 2024 });
  });

  it("re-reads the years for the subject picked, and drops a year picked for another subject", async () => {
    listPyqYears
      .mockResolvedValueOnce([{ year: 2024, count: 12 }])   // all subjects
      .mockResolvedValueOnce([{ year: 2023, count: 4 }]);   // Science
    const onStart = vi.fn();
    renderPyq(onStart);
    fireEvent.click(await screen.findByRole("button", { name: "2024 · 12" }));

    fireEvent.click(screen.getByRole("button", { name: "Science" }));
    expect(await screen.findByRole("button", { name: "2023 · 4" })).toBeInTheDocument();
    expect(listPyqYears.mock.calls.at(-1)?.[1]).toEqual({ subject: "Science" });
    expect(screen.queryByRole("button", { name: "2024 · 12" })).toBeNull();

    fireEvent.click(start());
    expect(onStart.mock.calls[0][0]).toMatchObject({ subject: "Science", pyqYear: null });
  });

  it("does not claim there are no past papers while the years load, or when the read fails", async () => {
    let resolve!: (v: unknown) => void;
    listPyqYears
      .mockReturnValueOnce(new Promise((r) => { resolve = r; }))
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce([{ year: 2021, count: 2 }]);
    renderPyq();
    expect(await screen.findByRole("status")).toHaveTextContent("Loading…");
    expect(screen.queryByText(NONE)).toBeNull();
    expect(start()).toBeDisabled();

    resolve([]);
    expect(await screen.findByText(NONE)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Science" }));
    expect(await screen.findByText(/Could not load this list/)).toBeInTheDocument();
    expect(screen.queryByText(NONE)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "2021 · 2" })).toBeInTheDocument());
  });
});
