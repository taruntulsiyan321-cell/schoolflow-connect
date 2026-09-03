import { describe, expect, it } from "vitest";

import { belowPass } from "@/academic/metrics/thresholds";
import { scoreTone } from "./StudentExamsResultsPage";

/**
 * The live database cannot exercise these branches: all 18 exams that carry
 * marks have passing_marks NULL, so every rendered result takes the neutral
 * path. Without this the other three arms are unreachable in any environment
 * we can point a browser at.
 */
const tone = (scored: number, pass: number | null, max: number) =>
  scoreTone((scored / max) * 100, belowPass(scored, pass, max));

describe("exam result tone", () => {
  it("is neutral where the exam has no pass mark — no flag fires", () => {
    // 5 of 18 live exams, and 100% of exams that actually carry marks.
    expect(tone(18, null, 40).bar).toBe("bg-muted-foreground/40");
    expect(tone(2, null, 40).bar).toBe("bg-muted-foreground/40");
    expect(tone(39, null, 40).bar).toBe("bg-muted-foreground/40");
  });

  it("is neutral where no mark was recorded", () => {
    expect(scoreTone(0, belowPass(null, 33, 100)).bar).toBe("bg-muted-foreground/40");
  });

  it("is red only when the score is below THIS exam's pass mark", () => {
    expect(tone(7, 8, 20).bar).toBe("bg-red-500");
    expect(tone(32, 33, 100).bar).toBe("bg-red-500");
  });

  it("does not fail a student the old literal 40 would have failed", () => {
    // 30% — under the old `pct < 40` this was red. The pass mark is 8 of 40,
    // so the student passed. passing_marks in this database runs 8 to 33.
    const t = tone(12, 8, 40);
    expect(t.bar).not.toBe("bg-red-500");
    expect(t.bar).toBe("bg-amber-500");
  });

  it("does not pass a student the old literal 40 would have passed", () => {
    // 60% — comfortably over 40, but the pass mark is 33 of 50.
    expect(tone(30, 33, 50).bar).toBe("bg-red-500");
  });

  it("keeps the un-ruled 75 band, but only above the pass mark", () => {
    expect(tone(80, 33, 100).bar).toBe("bg-emerald-500");
    expect(tone(50, 33, 100).bar).toBe("bg-amber-500");
  });

  it("never returns a colour class Tailwind cannot see literally", () => {
    for (const t of [tone(18, null, 40), tone(7, 8, 20), tone(80, 33, 100), tone(50, 33, 100)]) {
      expect(t.bar).toMatch(/^bg-[a-z-]+(-\d{3})?(\/\d+)?$/);
      expect(t.bar).not.toContain("${");
      expect(t.bar).not.toContain("[&>div]");
    }
  });
});
