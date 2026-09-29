/**
 * §8 on the screen: an upload's buttons are what it holds.
 *
 * A question paper with no hard question used to offer "Practise hard only",
 * and "Practise by chapter" practised the whole file. Now each chapter is its
 * own button, and a mode with nothing behind it is not drawn.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({ contentOf: vi.fn(), listMine: vi.fn() }));

vi.mock("@/academic", () => {
  const value = { ctx: { schoolId: "s", userId: "u", studentId: "st", role: "student" }, ready: true };
  return { useAcademicContext: () => value };
});
vi.mock("@/academic/services/studentUploadService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/academic/services/studentUploadService")>();
  return {
    ...actual,
    StudentUploadService: { ...actual.StudentUploadService, listMine: h.listMine, contentOf: h.contentOf },
  };
});
vi.mock("sonner", () => ({ toast: { message: vi.fn(), error: vi.fn() } }));

import { CustomPracticeUpload } from "./CustomPracticeUpload";

const row = (id: string, filename: string) => ({
  id, owner_id: "u", school_id: "s", storage_path: "p", original_filename: filename, byte_size: 1,
  mime_type: "application/pdf", page_count: 1, verdict: "questions", confidence: 0.9,
  refusal_reason: null, status: "ready", created_at: "", updated_at: "",
});

beforeEach(() => {
  h.listMine.mockResolvedValue([row("a", "accounts.pdf"), row("b", "written.pdf")]);
  h.contentOf.mockResolvedValue(new Map([
    ["a", { practisable: 6, hard: 0, fromNotes: 0, notes: 0,
            chapters: [{ id: "c1", name: "Ratio Analysis", count: 4 }, { id: "c2", name: "Cash Flow", count: 2 }] }],
    // written.pdf: only written-answer questions — nothing practisable.
  ]));
});

describe("Custom Practice — the modes an upload offers", () => {
  it("draws no hard mode for a file with no hard question, and one button per chapter", async () => {
    const onSelectMode = vi.fn();
    render(<CustomPracticeUpload accentColor="#888" onSelectMode={onSelectMode} />);
    expect(await screen.findByRole("button", { name: "Practise all" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Practise hard only" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Practise from notes" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cash Flow · 2" }));
    expect(onSelectMode).toHaveBeenCalledWith(expect.objectContaining({ id: "a" }), "practise_by_chapter", "c2");
  });

  it("says so when a ready file holds nothing that can be practised", async () => {
    render(<CustomPracticeUpload accentColor="#888" onSelectMode={vi.fn()} />);
    expect(await screen.findByText(/Nothing in this file can be practised here/)).toBeInTheDocument();
  });
});
