import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * AI Practice is the tenth Practice mode (owner's ruling 2026-10-02). Its
 * setup screen is the request box, for exam accounts; what the box returns
 * starts a session that carries the request's question ids — the session asks
 * those and nothing else.
 */
vi.mock("@/academic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/academic")>();
  const value = { ctx: { schoolId: "s", userId: "u", role: "student", studentId: "st" }, ready: true, settled: true };
  return { ...actual, useAcademicContext: () => value };
});
vi.mock("@/gurukul/components/AIPracticeRequest", () => ({
  AIPracticeRequest: ({ onReady }: { onReady: (r: unknown) => void }) => (
    <button type="button" onClick={() => onReady({
      status: "ready", requestId: "req-1", questionIds: ["q2", "q1"], fromBank: 1, written: 1,
      subject: "Accountancy", chapter: "Accounting for Partnership", topic: "Interest on Capital", message: null,
    })}>request box</button>
  ),
}));

const { ConfigView, Hub } = await import("./Practice");
const { PRACTICE_MODE_LABELS } = await import("@/lib/practiceModeLabel");
const LIST = { status: "ready" as const, items: [] };

describe("AI Practice in Practice", () => {
  it("an exam account's setup screen is the request box, and its result starts the session", () => {
    const onStart = vi.fn();
    render(<MemoryRouter><ConfigView modeKey="ai" examScoped onStart={onStart} onBack={() => {}} subjectList={LIST} onRetrySubjects={() => {}} /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "request box" }));
    expect(onStart).toHaveBeenCalledTimes(1);
    const cfg = onStart.mock.calls[0][0];
    expect(cfg.mode).toBe("ai");
    expect(cfg.ai).toEqual({ requestId: "req-1", questionIds: ["q2", "q1"] });
    expect(cfg.qCount).toBe(2);
    expect(cfg.label).toBe(`Interest on Capital · ${PRACTICE_MODE_LABELS.ai}`);
  });

  it("anyone else is told it is for exam accounts", () => {
    render(<MemoryRouter><ConfigView modeKey="ai" onStart={() => {}} onBack={() => {}} subjectList={LIST} onRetrySubjects={() => {}} /></MemoryRouter>);
    expect(screen.getByText("AI Practice is for exam accounts.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "request box" })).toBeNull();
  });

  it("has a tile of its own on the hub, and the tile opens it", () => {
    const onMode = vi.fn();
    render(
      <MemoryRouter>
        <Hub onMode={onMode} historyList={LIST} savedList={LIST} onRetryHistory={() => {}} streak={0}
          onOpenSession={() => {}} onSaveLatest={() => {}} savingLatest={false}
          historyFilters={{ search: "", subject: "", practiceType: "", date: "" }} onHistoryFilters={() => {}} subjects={[]} />
      </MemoryRouter>,
    );
    const tiles = screen.getAllByText(PRACTICE_MODE_LABELS.ai);
    expect(tiles.length).toBeGreaterThan(0);
    fireEvent.click(tiles[0]);
    expect(onMode).toHaveBeenCalledWith("ai");
  });
});
