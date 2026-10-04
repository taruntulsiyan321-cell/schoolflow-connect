import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { MarkTag, QuestionMark } from "@/lib/questionMarks";

/**
 * The Mark button under a question, and the dialog behind it: tags in their
 * groups, a note held to its limit, a voice note — and saving nothing removes
 * the mark. A recording uploaded for a save that then fails is removed again.
 */

const lib = vi.hoisted(() => ({
  saveMark: vi.fn(),
  uploadVoiceNote: vi.fn(),
  removeVoiceNotes: vi.fn(),
}));
vi.mock("@/lib/questionMarks", async (orig) => ({
  ...(await orig<typeof import("@/lib/questionMarks")>()),
  saveMark: (...a: unknown[]) => lib.saveMark(...a),
  uploadVoiceNote: (...a: unknown[]) => lib.uploadVoiceNote(...a),
  removeVoiceNotes: (...a: unknown[]) => lib.removeVoiceNotes(...a),
  voiceNoteUrl: () => Promise.resolve("blob:signed"),
}));

const rec = vi.hoisted(() => ({
  value: {
    supported: true, state: "idle" as "idle" | "recording" | "recorded", seconds: 0, blob: null as Blob | null,
    error: null, start: () => Promise.resolve(), stop: () => {}, discard: () => {},
  },
}));
vi.mock("./useVoiceNoteRecorder", async (orig) => ({
  ...(await orig<typeof import("./useVoiceNoteRecorder")>()),
  useVoiceNoteRecorder: () => rec.value,
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@/components/MathText", () => ({ MathText: ({ text }: { text: string }) => <span>{text}</span> }));

import { QuestionMarkBar } from "./QuestionMarkBar";

const TAGS: MarkTag[] = [
  { key: "conceptual_gap", label: "Conceptual gap", group: "Understanding", position: 1, active: true },
  { key: "recall", label: "Recall", group: "Memory", position: 3, active: true },
  { key: "formula_error", label: "Formula error", group: "Memory", position: 4, active: true },
];
const REF = { kind: "bank" as const, id: "q1" };
const QUESTION = { text: "Goodwill is valued at?", subject: "accountancy", chapter: "Partnership" };

const stored = (over: Partial<QuestionMark> = {}): QuestionMark => ({
  ref: REF, questionText: QUESTION.text, subject: QUESTION.subject, chapter: QUESTION.chapter,
  tags: ["recall"], note: "Forgot the super-profit method", voicePath: null, voiceSeconds: null,
  createdAt: "2026-10-02T10:00:00Z", updatedAt: "2026-10-02T10:00:00Z", ...over,
});

function show(mark: QuestionMark | null, onChange = vi.fn()) {
  render(<QuestionMarkBar userId="u1" questionRef={REF} question={QUESTION} mark={mark} tags={TAGS} onChange={onChange} />);
  return onChange;
}

const dialog = () => screen.getByRole("dialog");

beforeEach(() => {
  lib.saveMark.mockReset();
  lib.uploadVoiceNote.mockReset();
  lib.removeVoiceNotes.mockReset().mockResolvedValue(undefined);
  toast.success.mockReset();
  toast.error.mockReset();
  rec.value = { ...rec.value, state: "idle", seconds: 0, blob: null };
  // jsdom has no object URLs; a browser plays the new recording from one.
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:local"), revokeObjectURL: vi.fn() });
});

describe("marking a question", () => {
  it("an unmarked question offers Mark; the dialog offers the tags in their groups", () => {
    show(null);
    expect(screen.queryByLabelText("Your marks")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mark" }));
    expect(within(dialog()).getByText("Mark this question")).toBeInTheDocument();
    expect(within(dialog()).getByText("Understanding")).toBeInTheDocument();
    expect(within(dialog()).getByText("Memory")).toBeInTheDocument();
    // Nothing chosen, nothing to save.
    expect(within(dialog()).getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("the tags chosen and the note are what is saved, and the bar shows the result", async () => {
    const saved = stored({ tags: ["conceptual_gap", "formula_error"], note: "Used the wrong formula" });
    lib.saveMark.mockResolvedValue(saved);
    const onChange = show(null);
    fireEvent.click(screen.getByRole("button", { name: "Mark" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Formula error" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Conceptual gap" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Recall" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Recall" })); // and off again
    expect(within(dialog()).getByRole("button", { name: "Formula error" })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog()).getByRole("button", { name: "Recall" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.change(within(dialog()).getByLabelText("Note"), { target: { value: "Used the wrong formula" } });
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(saved));
    expect(lib.saveMark).toHaveBeenCalledWith("u1", REF, QUESTION, {
      tags: ["formula_error", "conceptual_gap"], note: "Used the wrong formula", voice: null,
    });
    expect(lib.uploadVoiceNote).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("the note stops at its limit, and the counter says so", () => {
    show(null);
    fireEvent.click(screen.getByRole("button", { name: "Mark" }));
    const note = within(dialog()).getByLabelText("Note") as HTMLTextAreaElement;
    expect(within(dialog()).getByText("0/500")).toBeInTheDocument();
    fireEvent.change(note, { target: { value: "a".repeat(650) } });
    expect(note.value).toHaveLength(500);
    expect(within(dialog()).getByText("500/500")).toBeInTheDocument();
  });

  it("a marked question shows its marks, and opens on them", () => {
    show(stored());
    expect(within(screen.getByLabelText("Your marks")).getByText("Recall")).toBeInTheDocument();
    expect(screen.getByText(/Forgot the super-profit method/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Edit mark" }));
    expect(within(dialog()).getByRole("button", { name: "Recall" })).toHaveAttribute("aria-pressed", "true");
    expect((within(dialog()).getByLabelText("Note") as HTMLTextAreaElement).value).toBe("Forgot the super-profit method");
  });

  it("Remove mark saves nothing — which deletes it — and its recording goes too", async () => {
    lib.saveMark.mockResolvedValue(null);
    const onChange = show(stored({ voicePath: "u1/old.webm", voiceSeconds: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Edit mark" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Remove mark" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(null));
    expect(lib.saveMark).toHaveBeenCalledWith("u1", REF, QUESTION, { tags: [], note: "", voice: null });
    expect(lib.removeVoiceNotes).toHaveBeenCalledWith(["u1/old.webm"]);
    expect(toast.success).toHaveBeenCalledWith("Mark removed");
  });

  it("a kept recording is saved again as it was, and not deleted", async () => {
    lib.saveMark.mockResolvedValue(stored({ voicePath: "u1/old.webm", voiceSeconds: 20 }));
    show(stored({ voicePath: "u1/old.webm", voiceSeconds: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Edit mark" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Formula error" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(lib.saveMark).toHaveBeenCalled());
    expect(lib.saveMark.mock.calls[0][3]).toMatchObject({ voice: { path: "u1/old.webm", seconds: 20 } });
    expect(lib.removeVoiceNotes).not.toHaveBeenCalled();
  });

  it("a new recording is uploaded and saved; the one it replaces is removed", async () => {
    rec.value = { ...rec.value, state: "recorded", seconds: 14, blob: new Blob(["s"], { type: "audio/webm" }) };
    lib.uploadVoiceNote.mockResolvedValue("u1/new.webm");
    lib.saveMark.mockResolvedValue(stored({ voicePath: "u1/new.webm", voiceSeconds: 14 }));
    show(stored({ voicePath: "u1/old.webm", voiceSeconds: 20 }));
    fireEvent.click(screen.getByRole("button", { name: "Edit mark" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(lib.removeVoiceNotes).toHaveBeenCalledWith(["u1/old.webm"]));
    expect(lib.saveMark.mock.calls[0][3]).toMatchObject({ voice: { path: "u1/new.webm", seconds: 14 } });
  });

  it("a save that fails says so, keeps the dialog open, and removes the recording it uploaded", async () => {
    rec.value = { ...rec.value, state: "recorded", seconds: 9, blob: new Blob(["s"], { type: "audio/webm" }) };
    lib.uploadVoiceNote.mockResolvedValue("u1/orphan.webm");
    lib.saveMark.mockRejectedValue(new Error("network down"));
    const onChange = show(null);
    fireEvent.click(screen.getByRole("button", { name: "Mark" }));
    fireEvent.click(within(dialog()).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(lib.removeVoiceNotes).toHaveBeenCalledWith(["u1/orphan.webm"]);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
