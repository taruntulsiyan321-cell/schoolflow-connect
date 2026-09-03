/**
 * CHUNK 10 batch 4 — the band module.
 *
 * Two things are asserted here that no other test can assert, because they are
 * properties of the ladder rather than of any one screen:
 *
 *   1. null is `unknown`, never `low`. `null < 60` is TRUE in JavaScript and
 *      strictNullChecks is off, so the compiler will not catch a ladder that
 *      renders an unmeasured figure as its worst rung. Four defects have had
 *      that shape.
 *   2. No rung names a strength. §10.8 — "Strong areas are never shown anywhere
 *      in the app" — is held at the one place a label is produced.
 */
import { describe, it, expect } from "vitest";
import {
  bandOf,
  rungOf,
  attendanceBand,
  homeworkBand,
  accuracyBand,
  subjectAverageBand,
  riskBand,
  urgencyBand,
  BAND_LABEL,
  BAND_TONE,
  ACCURACY_LABEL,
  ACCURACY_CONCEPTUAL,
  ACCURACY_PROCEDURAL,
  ATTENDANCE_COMFORTABLE,
  HOMEWORK_COMFORTABLE,
} from "./bands";
import { ATTENDANCE_LOW, HOMEWORK_LOW, SUBJECT_AVERAGE_LOW } from "./thresholds";
import {
  RECOVERY_CONCEPTUAL_THRESHOLD,
  RECOVERY_PROCEDURAL_THRESHOLD,
} from "../recovery/constants";

describe("null is unknown, never the worst rung", () => {
  it("bands null as unknown", () => {
    expect(bandOf(null, 60, 80)).toBe("unknown");
    expect(bandOf(undefined, 60, 80)).toBe("unknown");
  });

  it("would have been 'low' under a bare comparison — the defect this prevents", () => {
    // The shape every ad-hoc ladder in the app had.
    // eslint-disable-next-line eqeqeq
    expect((null as unknown as number) < 60).toBe(true);
    expect(bandOf(null, 60, 80)).not.toBe("low");
  });

  it("bands NaN as unknown rather than low", () => {
    expect(bandOf(Number.NaN, 60, 80)).toBe("unknown");
  });

  it("still bands a real zero as low — a measured 0 IS the worst rung", () => {
    expect(bandOf(0, 60, 80)).toBe("low");
  });
});

describe("band boundaries that are thresholds import them", () => {
  it("attendance changes band exactly at the threshold", () => {
    expect(attendanceBand(ATTENDANCE_LOW - 0.1)).toBe("low");
    expect(attendanceBand(ATTENDANCE_LOW)).toBe("middle");
    expect(attendanceBand(ATTENDANCE_COMFORTABLE)).toBe("high");
  });

  it("homework changes band exactly at the threshold", () => {
    expect(homeworkBand(HOMEWORK_LOW - 0.1)).toBe("low");
    expect(homeworkBand(HOMEWORK_LOW)).toBe("middle");
    expect(homeworkBand(HOMEWORK_COMFORTABLE)).toBe("high");
  });

  it("moving the threshold moves the band with it", () => {
    // Asserted against the imported constant, not a literal: a test written as
    // `toBe(80)` would pass on two hardcoded 80s that had drifted apart.
    expect(attendanceBand(ATTENDANCE_LOW)).not.toBe("low");
    expect(attendanceBand(ATTENDANCE_LOW - 1)).toBe("low");
  });
});

describe("no rung names a strength (§10.8)", () => {
  const FORBIDDEN = /strong|master|proficient|excellent|strength/i;

  it("no band label tells a student what they are good at", () => {
    for (const [band, label] of Object.entries(BAND_LABEL)) {
      expect(FORBIDDEN.test(label), `${band} is labelled "${label}"`).toBe(false);
    }
  });

  it("the top rung is 'On track', which describes the figure and not the child", () => {
    expect(BAND_LABEL.high).toBe("On track");
  });

  it("every band has a label and a tone, so no screen invents its own", () => {
    for (const b of ["unknown", "low", "middle", "high"] as const) {
      expect(BAND_LABEL[b]).toBeTruthy();
      expect(BAND_TONE[b]).toBeTruthy();
    }
    expect(BAND_TONE.unknown).toBe("muted");
  });
});

describe("one ladder per metric, not one per screen", () => {
  it("accuracy bands at one four-boundary ladder", () => {
    expect(accuracyBand(39)).toBe("low");
    expect(accuracyBand(40)).toBe("weak");
    expect(accuracyBand(59)).toBe("weak");
    expect(accuracyBand(60)).toBe("building");
    expect(accuracyBand(69)).toBe("building");
    expect(accuracyBand(70)).toBe("near");
    expect(accuracyBand(79)).toBe("near");
    expect(accuracyBand(80)).toBe("high");
  });

  it("subject average is ruled, and its low boundary is the watchlist threshold", async () => {
    const mod = await import("./bands");
    // The AWAITING_RULING name must be gone: a settled number still carrying it
    // would send the next reader looking for a ruling that already happened.
    expect(Object.keys(mod)).not.toContain("SUBJECT_AVERAGE_LOW_AWAITING_RULING");
    expect(subjectAverageBand(SUBJECT_AVERAGE_LOW - 0.1)).toBe("low");
    expect(subjectAverageBand(SUBJECT_AVERAGE_LOW)).toBe("weak");
    expect(subjectAverageBand(89)).toBe("near");
    expect(subjectAverageBand(90)).toBe("high");
  });
});

describe("the accuracy ladder does not restate the recovery bars (§4.2b)", () => {
  it("the top two boundaries ARE the readiness thresholds, converted to percent", () => {
    // Asserted against the imported constants. Written as toBe(70) this would
    // pass on two 70s that had already drifted apart, which is the whole reason
    // the boundary imports rather than restates.
    expect(ACCURACY_CONCEPTUAL).toBe(RECOVERY_CONCEPTUAL_THRESHOLD * 100);
    expect(ACCURACY_PROCEDURAL).toBe(RECOVERY_PROCEDURAL_THRESHOLD * 100);
  });

  it("moving a readiness bar moves the band with it", () => {
    expect(accuracyBand(ACCURACY_CONCEPTUAL)).toBe("near");
    expect(accuracyBand(ACCURACY_CONCEPTUAL - 0.1)).toBe("building");
    expect(accuracyBand(ACCURACY_PROCEDURAL)).toBe("high");
    expect(accuracyBand(ACCURACY_PROCEDURAL - 0.1)).toBe("near");
  });

  it("no accuracy rung claims a readiness only two numbers can establish", () => {
    // Readiness is procedural AND conceptual, never blended. A rung called
    // "conceptual" on a single blended figure would say what one number cannot.
    for (const label of Object.values(ACCURACY_LABEL)) {
      expect(/conceptual|procedural|ready/i.test(label)).toBe(false);
    }
  });

  it("no accuracy rung names a strength either (§10.8)", () => {
    for (const [rung, label] of Object.entries(ACCURACY_LABEL)) {
      expect(
        /strong|master|proficient|excellent|strength/i.test(label),
        `${rung} is labelled "${label}"`,
      ).toBe(false);
    }
    expect(ACCURACY_LABEL.high).toBe("On track");
  });
});

describe("score split into two ladders with two names (ruling 4)", () => {
  it("riskBand reads a percentage, where high is good", () => {
    expect(riskBand(49)).toBe("low");
    expect(riskBand(50)).toBe("middle");
    expect(riskBand(74)).toBe("middle");
    expect(riskBand(75)).toBe("high");
  });

  it("urgencyBand reads a COUNT, where high is bad — the inversion", () => {
    expect(urgencyBand(0)).toBe("low");
    expect(urgencyBand(1)).toBe("low");
    expect(urgencyBand(2)).toBe("medium");
    expect(urgencyBand(3)).toBe("medium");
    expect(urgencyBand(4)).toBe("high");
    expect(urgencyBand(40)).toBe("high");
  });

  it("urgency of an unmeasured queue item is unknown, not low", () => {
    // The dangerous direction: `null` reading as "low" would silently drop an
    // item off the top of a queue rather than to the bottom of one.
    expect(urgencyBand(null)).toBe("unknown");
    expect(urgencyBand(undefined)).toBe("unknown");
  });

  it("the two ladders are not interchangeable — 75 means opposite things", () => {
    expect(riskBand(75)).toBe("high");
    expect(urgencyBand(75)).toBe("high");
    // Same rung name, opposite meaning: 75% accuracy is on track, 75 open
    // mistakes is an emergency. The names differ so a caller must choose.
    expect(riskBand).not.toBe(urgencyBand);
  });
});

describe("mastery_score has no ladder here, and must not acquire one (ruling 1)", () => {
  it("exports nothing named for mastery", async () => {
    const mod = await import("./bands");
    for (const key of Object.keys(mod)) {
      expect(/mastery|mastered/i.test(key), `bands exports "${key}"`).toBe(false);
    }
  });
});

describe("the null contract holds for every ladder, not just the three-rung one", () => {
  it("rungOf returns -1 for null, which is not a rung index", () => {
    expect(rungOf(null, [40, 60, 70, 80])).toBe(-1);
    expect(rungOf(undefined, [40, 60, 70, 80])).toBe(-1);
    expect(rungOf(Number.NaN, [40, 60, 70, 80])).toBe(-1);
  });

  it("every ladder in the module bands null as unknown", () => {
    expect(accuracyBand(null)).toBe("unknown");
    expect(subjectAverageBand(null)).toBe("unknown");
    expect(riskBand(null)).toBe("unknown");
    expect(urgencyBand(null)).toBe("unknown");
    expect(attendanceBand(null)).toBe("unknown");
    expect(homeworkBand(null)).toBe("unknown");
  });

  it("a measured zero is still the worst rung on every ladder", () => {
    expect(accuracyBand(0)).toBe("low");
    expect(subjectAverageBand(0)).toBe("low");
    expect(riskBand(0)).toBe("low");
    // urgency inverts: zero open mistakes is the BEST state, not the worst.
    expect(urgencyBand(0)).toBe("low");
  });
});
