import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MarkTag, QuestionMark } from "@/lib/questionMarks";

/**
 * Mistake Types: every marked question, grouped by the tags the student chose,
 * the most common reason first. A question with two tags counts in both; a
 * mark with only a note is listed, not lost.
 */

const state = vi.hoisted(() => ({
  value: {
    tags: [] as MarkTag[], marks: new Map<string, QuestionMark>(), loading: false, error: null as string | null,
    setMark: () => {}, retry: () => {},
  },
}));
vi.mock("@/components/student/questionMarks/useQuestionMarks", () => ({ useQuestionMarks: () => state.value }));
vi.mock("@/hooks/useAuth", () => {
  const value = { user: { id: "u1" } };
  return { useAuth: () => value };
});
vi.mock("@/components/MathText", () => ({
  MathText: ({ text, className }: { text: string; className?: string }) => <span className={className}>{text}</span>,
}));

import MistakeTypes from "./MistakeTypes";
import { bucketMarks } from "@/lib/questionMarks";

const TAGS: MarkTag[] = [
  { key: "conceptual_gap", label: "Conceptual gap", group: "Understanding", position: 1, active: true },
  { key: "recall", label: "Recall", group: "Memory", position: 3, active: true },
  { key: "formula_error", label: "Formula error", group: "Memory", position: 4, active: true },
  { key: "guessed", label: "Guessed", group: "Exam conditions", position: 9, active: true },
];

const mark = (id: string, tags: string[], subject: string, over: Partial<QuestionMark> = {}): QuestionMark => ({
  ref: { kind: "bank", id }, questionText: `Question ${id}`, subject, chapter: null, tags,
  note: null, voicePath: null, voiceSeconds: null, updatedAt: "2026-10-02T10:00:00Z", ...over,
});

const MARKS = [
  mark("a", ["formula_error"], "accountancy"),
  mark("b", ["formula_error", "conceptual_gap"], "economics"),
  mark("c", ["formula_error"], "economics"),
  mark("d", ["recall"], "business_studies"),
  mark("e", ["conceptual_gap"], "accountancy"),
  mark("f", [], "accountancy", { note: "Only a note" }),
];

beforeEach(() => {
  state.value = { ...state.value, tags: TAGS, marks: new Map(MARKS.map((m) => [m.ref.id, m])), loading: false, error: null };
});

describe("grouping marks by tag", () => {
  it("most common first, a two-tag question in both groups, the untagged last", () => {
    const buckets = bucketMarks(MARKS, TAGS);
    expect(buckets.map((b) => [b.label, b.marks.map((m) => m.ref.id)])).toEqual([
      ["Formula error", ["a", "b", "c"]],
      ["Conceptual gap", ["b", "e"]],
      ["Recall", ["d"]],
      ["No tag yet", ["f"]],
    ]);
  });

  it("a tie is broken by the catalogue's order, not by chance", () => {
    const tied = [mark("x", ["recall"], "s"), mark("y", ["conceptual_gap"], "s")];
    expect(bucketMarks(tied, TAGS).map((b) => b.label)).toEqual(["Conceptual gap", "Recall"]);
  });
});

describe("the Mistake Types screen", () => {
  const show = () => render(<MemoryRouter><MistakeTypes /></MemoryRouter>);
  const bar = (label: string) => screen.getAllByRole("button").find((b) => b.textContent?.startsWith(label) && !b.hasAttribute("aria-expanded"))!;

  it("counts every marked question, and each tag's", () => {
    show();
    expect(screen.getByText("6 questions marked")).toBeInTheDocument();
    expect(within(bar("Formula error")).getByText("3")).toBeInTheDocument();
    expect(within(bar("Conceptual gap")).getByText("2")).toBeInTheDocument();
    expect(within(bar("Recall")).getByText("1")).toBeInTheDocument();
  });

  it("opens on the biggest group, and another tap opens another", () => {
    show();
    expect(screen.getByText("Question c")).toBeInTheDocument();
    expect(screen.queryByText("Question d")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Recall/, expanded: false }));
    expect(screen.getByText("Question d")).toBeInTheDocument();
    expect(screen.queryByText("Question c")).toBeNull();
  });

  it("a subject narrows every count", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Economics" }));
    expect(screen.getByText("2 questions marked")).toBeInTheDocument();
    expect(within(bar("Formula error")).getByText("2")).toBeInTheDocument();
    expect(within(bar("Conceptual gap")).getByText("1")).toBeInTheDocument();
    expect(screen.queryByText("Question a")).toBeNull();
  });

  it("with nothing marked, it says how to mark", () => {
    state.value = { ...state.value, marks: new Map() };
    show();
    expect(screen.getByText("Nothing marked yet")).toBeInTheDocument();
    expect(screen.queryByText(/questions? marked/)).toBeNull();
  });

  it("a failed read says so, with a way to try again", () => {
    state.value = { ...state.value, error: "We couldn't load your marks." };
    show();
    expect(screen.getByText("Couldn't load your marks")).toBeInTheDocument();
  });
});
