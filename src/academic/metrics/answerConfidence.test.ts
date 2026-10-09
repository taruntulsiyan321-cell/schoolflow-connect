import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ANSWERED_UNMARKED, MARKED_AS_GUESS, confidenceOf, wasGuess } from "./answerConfidence";

/**
 * The "I'm guessing" tap is written by the app and read by the database:
 * question_attempts.confidence, which public._marked_as_guess reads to send a
 * right answer marked as a guess to the Mistake Book (20261152000000, C2).
 * Two homes for one number, so this holds them together.
 */
const MIGRATION = readFileSync("supabase/migrations/20261152000000_a_lucky_guess_goes_to_the_mistake_book.sql", "utf8");

describe("the guess tap's value", () => {
  it("is written and read back the same way", () => {
    expect(confidenceOf(true)).toBe(MARKED_AS_GUESS);
    expect(confidenceOf(false)).toBe(ANSWERED_UNMARKED);
    expect(wasGuess(MARKED_AS_GUESS)).toBe(true);
    expect(wasGuess(String(MARKED_AS_GUESS))).toBe(true);
    expect(wasGuess(ANSWERED_UNMARKED)).toBe(false);
    expect(wasGuess(null)).toBeNull();
  });

  it("is the value the database reads as a guess", () => {
    const body = MIGRATION.match(/CREATE FUNCTION public\._marked_as_guess\(_confidence numeric\)[\s\S]*?\$fn\$([\s\S]*?)\$fn\$/);
    expect(body, "_marked_as_guess not found in 20261152000000").not.toBeNull();
    expect(body![1].trim()).toBe(`SELECT COALESCE(_confidence = ${MARKED_AS_GUESS}, false)`);
    // CONTROL: the two values differ, so the database cannot read both as a guess.
    expect(ANSWERED_UNMARKED).not.toBe(MARKED_AS_GUESS);
  });
});
