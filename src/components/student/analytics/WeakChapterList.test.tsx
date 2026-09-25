/**
 * §6.3's chapter list and §6.5's inside-a-chapter view, as the student reads
 * them: every signal shown separately, a row opening onto its topics, its pace
 * and what was skipped.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WeakChapterList } from "./WeakChapterList";
import type { WeakChapterRow } from "@/lib/weakChapters";

const HOUR = 3600_000;

const row = (over: Partial<WeakChapterRow> = {}): WeakChapterRow => ({
  chapterId: "11111111-1111-4111-8111-111111111111",
  chapter: "Principles of Management",
  subject: "Business Studies",
  openMistakes: 3,
  repeatedMistakes: 2,
  accuracyPct: 25,
  attempted: 8,
  trend: "not_enough_data",
  trendDeltaPoints: null,
  sessions: 2,
  oldestOpenAt: new Date(Date.now() - 20 * HOUR).toISOString(),
  revisionState: "in_recovery",
  revisionDue: false,
  nextRevisionAt: null,
  skipped: 4,
  mistakeTopics: [{ topic: "Fayol's Principles", count: 2 }],
  skippedTopics: [{ topic: "Taylor's Scientific Management", count: 4 }],
  avgSecPerQuestion: 42,
  ownAvgSecPerQuestion: 30,
  pin: "repeated_mistakes",
  ...over,
});

const show = (rows: WeakChapterRow[]) =>
  render(
    <MemoryRouter>
      <WeakChapterList list={{ status: "ready", items: rows }} onRetry={() => {}} />
    </MemoryRouter>,
  );

describe("the chapter list", () => {
  it("shows each signal on its own — open, repeated, accuracy with its denominator, trend", () => {
    show([row()]);
    const r = screen.getByTestId("weak-chapter-row");
    expect(within(r).getAllByText("3").length).toBeGreaterThan(0);
    expect(within(r).getAllByText("25%").length).toBeGreaterThan(0);
    expect(within(r).getAllByText("Accuracy of 8").length).toBeGreaterThan(0);
    expect(within(r).getAllByText("Not enough sessions yet").length).toBeGreaterThan(0);
  });

  it("opens onto the chapter's topics, what was skipped most, its pace and the retry", () => {
    show([row()]);
    fireEvent.click(screen.getByTestId("weak-chapter-row"));
    expect(screen.getByText("Mistakes by topic (approximate)")).toBeInTheDocument();
    expect(screen.getByText("Skipped most (approximate)")).toBeInTheDocument();
    expect(screen.getByText(/About 42s a question here/)).toHaveTextContent("your own average is 30s, so this chapter takes you 12s longer");
    const retry = screen.getByRole("link", { name: /Try the ones you skipped/ });
    expect(retry.getAttribute("href")).toBe(`/student/practice?mode=skipped&chapter_id=${row().chapterId}`);
  });

  it("a mistake made earlier today is 'today', not '0 days ago'", () => {
    show([row()]);
    fireEvent.click(screen.getByTestId("weak-chapter-row"));
    expect(screen.getByText(/Oldest open mistake:/)).toHaveTextContent("Oldest open mistake: today");
  });

  it("CONTROL: an older one counts its days", () => {
    show([row({ oldestOpenAt: new Date(Date.now() - 74 * HOUR).toISOString() })]);
    fireEvent.click(screen.getByTestId("weak-chapter-row"));
    expect(screen.getByText(/Oldest open mistake:/)).toHaveTextContent("Oldest open mistake: 3 days ago");
  });

  it("says nothing is open, rather than drawing an empty list", () => {
    show([]);
    expect(screen.getByText(/Nothing is open/)).toBeInTheDocument();
  });
});
