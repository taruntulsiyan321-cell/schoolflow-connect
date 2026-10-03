import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { readSyllabusMap } from "./syllabusMap";

describe("reading the syllabus map", () => {
  it("reads the server's rows into the map's shape, and leaves out rows with no id", () => {
    const map = readSyllabusMap({
      exam_found: true,
      recent_days: 14,
      chapters: [
        { chapter_id: "c1", chapter: "Ratio Analysis", subject: "Accountancy", sequence: 3, answered: 12, correct: 7, recent_answered: 5, recent_correct: 2, last_at: "2026-10-01T10:00:00Z" },
        { chapter: "no id" },
      ],
      topics: [
        { topic_id: "t1", topic: "Liquidity", chapter_id: "c1", answered: 4, correct: 1, recent_answered: 0, recent_correct: 0, last_at: null },
        { topic_id: "t2", topic: "no chapter" },
      ],
    });
    expect(map).toEqual({
      examFound: true,
      recentDays: 14,
      chapters: [{ chapterId: "c1", chapter: "Ratio Analysis", subject: "Accountancy", sequence: 3, answered: 12, correct: 7, recentAnswered: 5, recentCorrect: 2, lastAt: "2026-10-01T10:00:00Z" }],
      topics: [{ topicId: "t1", topic: "Liquidity", chapterId: "c1", answered: 4, correct: 1, recentAnswered: 0, recentCorrect: 0, lastAt: null }],
      topicsLocked: false,
    });
  });

  it("a plan without topic analysis: topics withheld, and said so", () => {
    expect(readSyllabusMap({ exam_found: true, chapters: [], topics: [], topic_analysis_locked: true })?.topicsLocked).toBe(true);
  });

  it("not a map: null", () => {
    expect(readSyllabusMap(null)).toBeNull();
    expect(readSyllabusMap({ chapters: [] })).toBeNull();
  });
});
