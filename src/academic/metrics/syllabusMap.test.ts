import { describe, expect, it } from "vitest";
import { coverage, type MapChapter, type MapTopic, slippingTopics, subjectsOnMap, type SyllabusMap } from "./syllabusMap";
import { TREND_DELTA_POINTS } from "../recovery/constants";

const ch = (over: Partial<MapChapter>): MapChapter => ({
  chapterId: "c", chapter: "Chapter", subject: "Accountancy", sequence: 1,
  answered: 0, correct: 0, recentAnswered: 0, recentCorrect: 0, lastAt: null, ...over,
});
const tp = (over: Partial<MapTopic>): MapTopic => ({
  topicId: "t", topic: "Topic", chapterId: "c1",
  answered: 0, correct: 0, recentAnswered: 0, recentCorrect: 0, lastAt: null, ...over,
});
const map = (chapters: MapChapter[], topics: MapTopic[] = []): SyllabusMap => ({ examFound: true, recentDays: 14, chapters, topics, topicsLocked: false });

describe("the syllabus as a map", () => {
  it("by subject, in syllabus order, with how many chapters each has been practised in", () => {
    const m = map([
      ch({ chapterId: "a2", chapter: "Admission", sequence: 2, answered: 3 }),
      ch({ chapterId: "a1", chapter: "Partnership", sequence: 1 }),
      ch({ chapterId: "e1", chapter: "Money", subject: "Economics", sequence: 1, answered: 7 }),
    ]);
    expect(subjectsOnMap(m).map((s) => [s.subject, s.chapters.map((c) => c.chapterId), s.practised])).toEqual([
      ["Accountancy", ["a1", "a2"], 1],
      ["Economics", ["e1"], 1],
    ]);
    expect(coverage(m)).toEqual({ chapters: 3, practised: 2, judged: 1 });
  });
});

describe("slipping topics", () => {
  const chapters = [ch({ chapterId: "c1", chapter: "Ratio Analysis" })];

  it("right less often lately than before, by at least the trend line, with enough answers on both sides", () => {
    expect(TREND_DELTA_POINTS).toBe(10);
    const m = map(chapters, [
      // 8 of 10 before (80%), 2 of 5 lately (40%): fell 40.
      tp({ topicId: "fell", topic: "Liquidity", answered: 15, correct: 10, recentAnswered: 5, recentCorrect: 2 }),
      // 8 of 10 before, 7 of 10 lately: fell 10 — exactly the line.
      tp({ topicId: "line", topic: "Solvency", answered: 20, correct: 15, recentAnswered: 10, recentCorrect: 7 }),
      // 8 of 10 before (80%), 8 of 11 lately (73%): fell 7 — under the line.
      tp({ topicId: "under", topic: "Activity", answered: 21, correct: 16, recentAnswered: 11, recentCorrect: 8 }),
      // only 4 lately: too few to judge the recent side.
      tp({ topicId: "few", topic: "Profitability", answered: 14, correct: 8, recentAnswered: 4, recentCorrect: 0 }),
      // rose: not slipping.
      tp({ topicId: "rose", topic: "Turnover", answered: 10, correct: 7, recentAnswered: 5, recentCorrect: 5 }),
    ]);
    const s = slippingTopics(m);
    expect(s.map((x) => [x.topicId, x.earlier.accuracy, x.recent.accuracy, x.drop])).toEqual([
      ["fell", 80, 40, 40],
      ["line", 80, 70, 10],
    ]);
    expect(s[0]).toMatchObject({ chapter: "Ratio Analysis", subject: "Accountancy", earlier: { answered: 10, correct: 8 }, recent: { answered: 5, correct: 2 } });
  });
});
