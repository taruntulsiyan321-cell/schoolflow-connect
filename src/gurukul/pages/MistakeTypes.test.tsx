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
  note: null, voicePath: null, voiceSeconds: null, createdAt: "2026-10-02T10:00:00Z", updatedAt: "2026-10-02T10:00:00Z", ...over,
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

describe("mistake types, lately", () => {
  it("names the type marked more often lately, and puts each type's recent count under its name", () => {
    const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
    const marks = [
      mark("x1", ["formula_error"], "accountancy", { createdAt: ago(1) }),
      mark("x2", ["formula_error"], "accountancy", { createdAt: ago(2) }),
      mark("x3", ["formula_error"], "accountancy", { createdAt: ago(20) }),
      mark("x4", ["recall"], "accountancy", { createdAt: ago(16) }),
    ];
    state.value = { ...state.value, marks: new Map(marks.map((m) => [m.ref.id, m])) };
    render(<MemoryRouter><MistakeTypes /></MemoryRouter>);
    expect(screen.getByTestId("mistake-trend")).toHaveTextContent("Lately you mark Formula error more often: 2 in the last 14 days, 1 in the 14 before.");
    expect(screen.getAllByTestId("tag-lately").map((e) => e.textContent)).toEqual(["2 in the last 14 days"]);
  });

  it("nothing marked more often lately: no headline", () => {
    // The same marks, all from before both windows.
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    state.value = { ...state.value, marks: new Map(MARKS.map((m) => [m.ref.id, { ...m, createdAt: old }])) };
    render(<MemoryRouter><MistakeTypes /></MemoryRouter>);
    expect(screen.queryByTestId("tag-lately")).toBeNull();
    expect(screen.queryByTestId("mistake-trend")).toBeNull();
  });
});

describe("a mistake type drives practice (C5)", () => {
  const DRILL_TAGS: MarkTag[] = [
    ...TAGS,
    { key: "calculation_error", label: "Calculation error", group: "Working it out", position: 5, active: true },
  ];
  const drillMarks = [
    mark("k1", ["calculation_error"], "economics"),
    mark("k2", ["calculation_error"], "accountancy"),
    mark("k3", ["calculation_error"], "accountancy"),
    mark("k4", ["recall"], "accountancy"),
  ];
  const openGroup = (label: string) => {
    const header = screen.getAllByRole("button", { expanded: false }).find((b) => b.textContent?.startsWith(label));
    if (header) fireEvent.click(header);
  };

  beforeEach(() => {
    state.value = { ...state.value, tags: DRILL_TAGS, marks: new Map(drillMarks.map((m) => [m.ref.id, m])) };
  });

  it("offers a drill in the subject most of the type's questions are in", () => {
    render(<MemoryRouter><MistakeTypes /></MemoryRouter>);
    // The biggest group, Calculation error, starts open.
    const drill = screen.getByTestId("mistake-drill");
    expect(drill).toHaveTextContent("Drill it: questions worked out to a figure, in");
    expect(within(drill).getByRole("link", { name: "Start a drill" }))
      .toHaveAttribute("href", "/student/practice?subject=accountancy&drill=calculation_error");
  });

  it("drills in the subject chosen above when one is", () => {
    render(<MemoryRouter><MistakeTypes /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: /Economics/ }));
    expect(within(screen.getByTestId("mistake-drill")).getByRole("link", { name: "Start a drill" }))
      .toHaveAttribute("href", "/student/practice?subject=economics&drill=calculation_error");
  });

  it("CONTROL: a type that drives no drill offers none", () => {
    render(<MemoryRouter><MistakeTypes /></MemoryRouter>);
    expect(screen.getByTestId("mistake-drill")).toBeInTheDocument();
    // One group is open at a time: opening Recall closes Calculation error.
    openGroup("Recall");
    expect(screen.getByRole("button", { expanded: true })).toHaveTextContent(/^Recall/);
    expect(screen.queryByTestId("mistake-drill")).toBeNull();
  });
});
