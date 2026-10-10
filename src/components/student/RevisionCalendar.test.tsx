import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { RevisionCalendar } from "./RevisionCalendar";
import type { RevItem } from "@/gurukul/pages/useRevisionQueueV2";

const TODAY = new Date(2026, 9, 10, 15, 30);
const at = (dayOffset: number) => new Date(2026, 9, 10 + dayOffset, 9).toISOString();
const item = (id: string, chapter: string, dueDate: string): RevItem => ({
  id, chapter, subject: "Accountancy", dueIn: "", dueDate,
  passes: 0, stagesToSolid: 3, openMistakes: 0, freshAvailable: 5, state: "untouched",
});

const list = () => screen.getByTestId("revision-day-list");

describe("the revision calendar (C6)", () => {
  it("shows two weeks of days with each day's count, starting on the first day with something due", () => {
    render(<RevisionCalendar today={TODAY} items={[item("a", "Ratio Analysis", at(2)), item("b", "Goodwill", at(2)), item("c", "Cash Flow", at(9))]} />);
    const days = screen.getAllByTestId("revision-day");
    expect(days).toHaveLength(14);
    expect(days[0]).toHaveAccessibleName(/^Today: nothing due$/);
    expect(days[2]).toHaveAccessibleName(/2 checks due$/);
    expect(days[9]).toHaveAccessibleName(/1 check due$/);
    // Nothing overdue and nothing today: it opens on the first day with something.
    expect(days[2]).toHaveAttribute("aria-pressed", "true");
    expect(list()).toHaveTextContent("Ratio Analysis");
    expect(list()).toHaveTextContent("Goodwill");
    expect(list()).not.toHaveTextContent("Cash Flow");
  });

  it("lists a day's chapters when it is picked, and says when nothing is due", () => {
    render(<RevisionCalendar today={TODAY} items={[item("c", "Cash Flow", at(9))]} />);
    const days = screen.getAllByTestId("revision-day");
    fireEvent.click(days[1]);
    expect(list()).toHaveTextContent("Tomorrow");
    expect(list()).toHaveTextContent("Nothing due.");
    fireEvent.click(days[9]);
    expect(list()).toHaveTextContent("Cash Flow");
  });

  it("opens on the overdue checks when there are any, and counts the ones after two weeks", () => {
    render(<RevisionCalendar today={TODAY} items={[item("d", "Partnership", at(-3)), item("a", "Ratio Analysis", at(0)), item("z", "Debentures", at(20))]} />);
    const overdue = screen.getByRole("button", { name: "1 overdue" });
    expect(overdue).toHaveAttribute("aria-pressed", "true");
    expect(within(list()).getByText("Overdue")).toBeInTheDocument();
    expect(list()).toHaveTextContent("Partnership");
    expect(list()).not.toHaveTextContent("Ratio Analysis");
    expect(list()).toHaveTextContent("1 more check due after these 14 days.");
    // CONTROL: today holds its own.
    fireEvent.click(screen.getAllByTestId("revision-day")[0]);
    expect(list()).toHaveTextContent("Ratio Analysis");
  });

  it("shows no overdue button when nothing is overdue", () => {
    render(<RevisionCalendar today={TODAY} items={[item("a", "Ratio Analysis", at(0))]} />);
    expect(screen.queryByRole("button", { name: /overdue/ })).toBeNull();
    expect(screen.getAllByTestId("revision-day")[0]).toHaveAttribute("aria-pressed", "true");
  });
});
