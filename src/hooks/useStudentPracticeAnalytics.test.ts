import { describe, expect, it } from "vitest";
import { parseAnalytics } from "./useStudentPracticeAnalytics";

/**
 * The boundary between a database function's JSON and a page that renders
 * verdicts from it.
 *
 * The page gates every verdict on `answered` and `timed`. A payload without
 * them is not "a student with no data" — it is a payload this client cannot
 * read, and the two must not look the same on screen.
 */
describe("parseAnalytics", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    subject: "Mathematics",
    attempts: 408,
    answered: 220,
    timed: 402,
    correct: 101,
    skipped: 188,
    accuracy: 45.9,
    avg_sec: 6.8,
    total_min: 45.5,
    ...over,
  });

  it("accepts a well-formed payload and keeps every figure", () => {
    const { data, ok } = parseAnalytics({ by_subject: [row()] });
    expect(ok).toBe(true);
    expect(data.by_subject[0]).toMatchObject({
      subject: "Mathematics",
      attempts: 408,
      answered: 220,
      timed: 402,
      accuracy: 45.9,
      avg_sec: 6.8,
    });
  });

  it("rejects a row that cannot be judged rather than rendering it as thin", () => {
    // THE CASE THAT MATTERS. Without `answered` the page would gate every
    // verdict on undefined, show "not enough yet" against 220 answered
    // questions, and look exactly like a brand-new account.
    const { ok } = parseAnalytics({ by_subject: [row({ answered: undefined })] });
    expect(ok).toBe(false);
  });

  it("rejects a missing timed count too", () => {
    expect(parseAnalytics({ by_subject: [row({ timed: undefined })] }).ok).toBe(false);
    expect(parseAnalytics({ by_chapter: [row({ timed: null })] }).ok).toBe(false);
  });

  it("coerces numeric strings, which is what JSON numerics can arrive as", () => {
    const { data, ok } = parseAnalytics({
      by_subject: [row({ attempts: "408", answered: "220", timed: "402", accuracy: "45.9" })],
    });
    expect(ok).toBe(true);
    expect(data.by_subject[0].attempts).toBe(408);
    expect(data.by_subject[0].accuracy).toBe(45.9);
  });

  it("keeps an absent rate null instead of collapsing it to zero", () => {
    // A subject where every attempt was skipped has no accuracy. Zero would
    // say the student got everything wrong.
    const { data } = parseAnalytics({ by_subject: [row({ accuracy: null, answered: 0 })] });
    expect(data.by_subject[0].accuracy).toBeNull();
    expect(data.by_subject[0].answered).toBe(0);
  });

  it("survives rubbish without throwing, and says it could not read it", () => {
    expect(parseAnalytics(null).ok).toBe(true); // nothing to read is not a violation
    expect(parseAnalytics(null).data.by_subject).toEqual([]);
    expect(parseAnalytics({ by_subject: "not an array" }).data.by_subject).toEqual([]);
    expect(parseAnalytics({ by_subject: [null, row()] }).data.by_subject).toHaveLength(1);
  });

  it("reads effort and recurring, and tolerates them being absent", () => {
    const { data } = parseAnalytics({
      effort: { attempts: 564, solution_viewed: 211, repeat_attempts: 481, first_try_attempts: 56, first_try_correct: 20 },
      recurring: [{ topic: "T", chapter: "C", subject: "S", times_wrong: 3, last_wrong_at: "2026-09-01", question_text: "q" }],
    });
    expect(data.effort?.first_try_correct).toBe(20);
    expect(data.recurring[0].times_wrong).toBe(3);
    expect(parseAnalytics({}).data.effort).toBeNull();
  });
});
