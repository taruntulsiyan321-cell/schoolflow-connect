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

  it("reads accuracy by kind of question under the same contract (C1)", () => {
    const form = { form: "assertion_reason", attempts: 10, answered: 3, timed: 3, correct: 1, skipped: 7, accuracy: 33.3, avg_sec: 2.5 };
    const { data, ok } = parseAnalytics({ by_form: [form] });
    expect(ok).toBe(true);
    expect(data.by_form).toEqual([form]);
    // A form row without its denominators is refused like any other group's.
    expect(parseAnalytics({ by_form: [{ ...form, answered: undefined }] }).ok).toBe(false);
    // A payload from before 20261151000000 has none: no rows, not an error.
    const old = parseAnalytics({ by_subject: [row()] });
    expect(old.ok).toBe(true);
    expect(old.data.by_form).toEqual([]);
  });

  it("reads the guesses, and tells none from unreadable (C3)", () => {
    expect(parseAnalytics({ guesses: { answered: 12, correct: "3" } }).data.guesses).toEqual({ answered: 12, correct: 3 });
    // A student with no guesses has a record of zero...
    expect(parseAnalytics({ guesses: { answered: 0, correct: 0 } }).data.guesses).toEqual({ answered: 0, correct: 0 });
    // ...which is not the same as no record at all.
    expect(parseAnalytics({}).data.guesses).toBeNull();
    expect(parseAnalytics({ guesses: { answered: 12 } }).data.guesses).toBeNull();
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
      effort: { attempts: 564, questions_seen_again: 48, first_try_attempts: 56, first_try_correct: 20 },
      recurring: [{ topic: "T", chapter: "C", subject: "S", times_wrong: 3, last_wrong_at: "2026-09-01", question_text: "q" }],
    });
    expect(data.effort).toEqual({ attempts: 564, questions_seen_again: 48, first_try_attempts: 56, first_try_correct: 20 });
    expect(data.recurring[0].times_wrong).toBe(3);
    expect(parseAnalytics({}).data.effort).toBeNull();
  });

  it("carries the plan's topic lock (20261112000000), and only a real true", () => {
    expect(parseAnalytics({ by_topic: [], topic_analysis_locked: true }).data.topic_analysis_locked).toBe(true);
    // CONTROL: absent, or anything that is not the boolean, is not a lock.
    expect(parseAnalytics({ by_topic: [] }).data.topic_analysis_locked).toBe(false);
    expect(parseAnalytics({ topic_analysis_locked: "true" }).data.topic_analysis_locked).toBe(false);
  });

  it("will not read the position-based effort of an older payload as zero repeats", () => {
    // Before 20261115000000 effort carried repeat_attempts / solution_viewed,
    // counted off each question's position in its session. Its absent
    // questions_seen_again must not render as "0 seen again".
    const { data } = parseAnalytics({
      effort: { attempts: 564, solution_viewed: 211, repeat_attempts: 481, first_try_attempts: 56, first_try_correct: 20 },
    });
    expect(data.effort).toBeNull();
  });
});
