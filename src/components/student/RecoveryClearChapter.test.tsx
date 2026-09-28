import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const clear = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({ toast: { error: (...a: unknown[]) => toastError(...a) } }));
vi.mock("@/academic", () => {
  const value = { ctx: { schoolId: "s", userId: "u", studentId: "st", role: "student" } };
  return {
    useAcademicContext: () => value,
    RecoveryEngineService: { clearChapterAfterRecovery: (...a: unknown[]) => clear(...a) },
  };
});
import { RecoveryClearChapter } from "./RecoveryClearChapter";

beforeEach(() => {
  clear.mockReset();
  toastError.mockReset();
});

const open = () => fireEvent.click(screen.getByRole("button", { name: "Mark as recovered anyway" }));

describe("RecoveryClearChapter, not ready — §4.4, a speed bump and not a block", () => {
  it("asks first, and says what clearing does and that revision will catch it", () => {
    render(<RecoveryClearChapter sessionId="rs-1" ready={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    open();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("isn't solid yet");
    expect(dialog).toHaveTextContent("mistakes leave your mistake book");
    expect(dialog).toHaveTextContent("revision check in a week");
    expect(clear).not.toHaveBeenCalled();
  });

  it("Keep practising closes it and clears nothing", () => {
    render(<RecoveryClearChapter sessionId="rs-1" ready={false} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Keep practising" }));
    expect(clear).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Mark as recovered anyway" })).toBeInTheDocument();
  });

  it("Clear anyway sends this session and reports the server's result", async () => {
    clear.mockResolvedValueOnce({ chapter_id: "c", cleared: 8, readiness: 0.14, next_revision_at: "2026-09-30T11:25:09Z" });
    render(<RecoveryClearChapter sessionId="rs-1" ready={false} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Clear anyway" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/Marked recovered — 8 mistakes cleared\. A revision check on .*30.* will bring it back/);
    expect(clear).toHaveBeenCalledWith(expect.objectContaining({ studentId: "st" }), "rs-1");
    expect(screen.queryByRole("button", { name: "Mark as recovered anyway" })).toBeNull();
  });

  it("says so when the chapter was already recovered", async () => {
    clear.mockResolvedValueOnce({ already: true, chapter_id: "c" });
    render(<RecoveryClearChapter sessionId="rs-1" ready={false} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Clear anyway" }));
    expect(await screen.findByRole("status")).toHaveTextContent("already marked recovered");
  });

  it("a refusal from the server is shown and nothing is claimed", async () => {
    clear.mockRejectedValueOnce(new Error("a newer recovery session exists for this chapter"));
    render(<RecoveryClearChapter sessionId="rs-1" ready={false} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Clear anyway" }));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(String(toastError.mock.calls[0][0])).toContain("a newer recovery session exists");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("RecoveryClearChapter, ready — the student clears, the round never does", () => {
  it("offers the clear and does nothing until it is pressed", () => {
    render(<RecoveryClearChapter sessionId="rs-2" ready />);
    expect(screen.getByRole("button", { name: "Clear these mistakes" })).toBeInTheDocument();
    expect(screen.getByText("They stay in your mistake book until you do.")).toBeInTheDocument();
    expect(clear).not.toHaveBeenCalled();
  });

  it("one press clears, with no speed bump, and reports the server's result", async () => {
    clear.mockResolvedValueOnce({ chapter_id: "c", cleared: 2, readiness: 0.92, next_revision_at: "2026-10-05T11:25:09Z" });
    render(<RecoveryClearChapter sessionId="rs-2" ready />);
    fireEvent.click(screen.getByRole("button", { name: "Clear these mistakes" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(await screen.findByRole("status")).toHaveTextContent("Marked recovered — 2 mistakes cleared.");
    expect(clear).toHaveBeenCalledWith(expect.objectContaining({ studentId: "st" }), "rs-2");
  });
});
