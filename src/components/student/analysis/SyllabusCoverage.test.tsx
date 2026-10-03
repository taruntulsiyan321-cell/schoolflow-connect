import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { MapChapter, MapTopic, SyllabusMap } from "@/academic/metrics/syllabusMap";
import { SyllabusCoverage } from "./SyllabusCoverage";
import { SlippingTopics } from "./SlippingTopics";

const ch = (over: Partial<MapChapter>): MapChapter => ({
  chapterId: "c", chapter: "Chapter", subject: "Accountancy", sequence: 1,
  answered: 0, correct: 0, recentAnswered: 0, recentCorrect: 0, lastAt: null, ...over,
});
const tp = (over: Partial<MapTopic>): MapTopic => ({
  topicId: "t", topic: "Topic", chapterId: "a1",
  answered: 0, correct: 0, recentAnswered: 0, recentCorrect: 0, lastAt: null, ...over,
});
const MAP: SyllabusMap = {
  examFound: true,
  recentDays: 14,
  chapters: [
    ch({ chapterId: "a2", chapter: "Admission of a Partner", sequence: 2 }),
    ch({ chapterId: "a1", chapter: "Ratio Analysis", sequence: 1, answered: 15, correct: 10, recentAnswered: 5, recentCorrect: 2 }),
    ch({ chapterId: "e1", chapter: "Money and Banking", subject: "Economics", answered: 2, correct: 1 }),
  ],
  topics: [
    tp({ topicId: "t1", topic: "Liquidity", answered: 15, correct: 10, recentAnswered: 5, recentCorrect: 2 }),
    tp({ topicId: "t2", topic: "Solvency" }),
  ],
  topicsLocked: false,
};
const show = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("the whole syllabus", () => {
  it("how much of it is met, by subject, in syllabus order — counts only, no accuracy", () => {
    show(<SyllabusCoverage map={MAP} topicLock={null} />);
    expect(screen.getByTestId("syllabus-coverage")).toHaveTextContent("You have practised 2 of 3 chapters in your syllabus.");
    const subjects = screen.getAllByTestId("syllabus-subject");
    expect(subjects.map((s) => s.getAttribute("aria-label"))).toEqual(["Accountancy", "Economics"]);
    expect(subjects[0]).toHaveTextContent("1 of 2 practised");
    const rows = within(subjects[0]).getAllByTestId("syllabus-chapter");
    expect(rows[0]).toHaveTextContent("Ratio Analysis15 answers · 1 of 2 topics met");
    expect(rows[1]).toHaveTextContent("Admission of a PartnerNot practised");
    expect(screen.getByTestId("syllabus-coverage").textContent).not.toMatch(/%/);
    expect(within(rows[1]).getByRole("link", { name: "Practise" }))
      .toHaveAttribute("href", "/student/practice?subject=Accountancy&chapter=Admission+of+a+Partner");
  });

  it("opens a chapter to its topics, each met or not", () => {
    show(<SyllabusCoverage map={MAP} topicLock={null} />);
    const row = screen.getAllByTestId("syllabus-chapter")[0];
    expect(within(row).queryAllByTestId("syllabus-topic")).toHaveLength(0);
    fireEvent.click(within(row).getByRole("button", { expanded: false }));
    expect(within(row).getAllByTestId("syllabus-topic").map((t) => t.textContent)).toEqual(["Liquidity15 answers", "SolvencyNot practised"]);
  });

  it("a plan without topic analysis: the plan's notice where the topics would be", () => {
    show(<SyllabusCoverage map={{ ...MAP, topicsLocked: true }} topicLock={<p>Topic analysis is in a plan</p>} />);
    const row = screen.getAllByTestId("syllabus-chapter")[0];
    expect(row).not.toHaveTextContent("topics met");
    fireEvent.click(within(row).getByRole("button", { expanded: false }));
    expect(row).toHaveTextContent("Topic analysis is in a plan");
  });
});

describe("slipping lately", () => {
  it("names each topic right less often lately, with both figures and the window", () => {
    show(<SlippingTopics map={MAP} topicLock={null} />);
    const rows = screen.getAllByTestId("slipping-topic");
    expect(rows).toHaveLength(1);
    // 8 of 10 before (80%), 2 of 5 in the last 14 days (40%).
    expect(rows[0]).toHaveTextContent("Liquidity");
    expect(rows[0]).toHaveTextContent("80% → 40%");
    expect(rows[0]).toHaveTextContent("down 40 points in 14 days");
  });

  it("nothing slipping: says what it takes to be read", () => {
    show(<SlippingTopics map={{ ...MAP, topics: [tp({ topicId: "t2" })] }} topicLock={null} />);
    expect(screen.getByTestId("slipping-none")).toHaveTextContent("No topic has slipped in the last 14 days. A topic is read once it has 5 answers from before and 5 from that time.");
  });

  it("a plan without topic analysis: the plan's notice", () => {
    show(<SlippingTopics map={{ ...MAP, topicsLocked: true }} topicLock={<p>Topic analysis is in a plan</p>} />);
    expect(screen.getByText("Topic analysis is in a plan")).toBeInTheDocument();
    expect(screen.queryByTestId("slipping-topic")).toBeNull();
  });
});
