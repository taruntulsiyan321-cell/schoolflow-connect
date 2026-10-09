import { describe, expect, it } from "vitest";
import { breakEvenRate, breakEvenWords, guessVerdict } from "./guessing";
import { MIN_OBSERVATIONS_FOR_VERDICT } from "./thresholds";

const CUET = { questions: 50, minutes: 60, marks_correct: 5, marks_wrong: -1 };

describe("does guessing pay (C3)", () => {
  it("breaks even at one in six on CUET's +5/−1, and moves with the marking", () => {
    expect(breakEvenRate(CUET)).toBeCloseTo(1 / 6);
    expect(breakEvenWords(breakEvenRate(CUET))).toBe("1 in 6");
    // Not the ruled marking: +4/−2 breaks even at one in three.
    expect(breakEvenWords(breakEvenRate({ marks_correct: 4, marks_wrong: -2 }))).toBe("1 in 3");
    // +3/−1 at one in four; +5/−2 is not a whole one-in-N.
    expect(breakEvenWords(breakEvenRate({ marks_correct: 3, marks_wrong: -1 }))).toBe("1 in 4");
    expect(breakEvenWords(breakEvenRate({ marks_correct: 5, marks_wrong: -2 }))).toBe("29%");
    // With no penalty every guess pays.
    expect(breakEvenWords(breakEvenRate({ marks_correct: 5, marks_wrong: 0 }))).toBe("any share");
  });

  it("pays above the break-even, not at it, and says what the guesses came to", () => {
    // 2 of 10 = 20% > 16.7%: +10 − 8 = +2 marks.
    expect(guessVerdict({ answered: 10, correct: 2 }, CUET)).toMatchObject({ pays: true, net: 2, rate: 0.2 });
    // 1 of 10 = 10%: +5 − 9 = −4.
    expect(guessVerdict({ answered: 10, correct: 1 }, CUET)).toMatchObject({ pays: false, net: -4 });
    // Exactly 1 in 6 gains nothing on average: 1 of 6 is +5 − 5 = 0. Not "pays".
    expect(guessVerdict({ answered: 6, correct: 1 }, CUET)).toMatchObject({ pays: false, net: 0 });
  });

  it("gives no verdict below the floor, and nothing at all with no guesses", () => {
    const few = MIN_OBSERVATIONS_FOR_VERDICT - 1;
    expect(guessVerdict({ answered: few, correct: few }, CUET)?.pays).toBeNull();
    // CONTROL: at the floor a verdict is given.
    expect(guessVerdict({ answered: MIN_OBSERVATIONS_FOR_VERDICT, correct: MIN_OBSERVATIONS_FOR_VERDICT }, CUET)?.pays).toBe(true);
    expect(guessVerdict({ answered: 0, correct: 0 }, CUET)).toBeNull();
  });
});
