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
  attendanceBand,
  homeworkBand,
  accuracyBand,
  subjectAverageBand,
  BAND_LABEL,
  BAND_TONE,
  ATTENDANCE_COMFORTABLE,
  HOMEWORK_COMFORTABLE,
} from "./bands";
import { ATTENDANCE_LOW, HOMEWORK_LOW } from "./thresholds";

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
  it("accuracy bands at a single pair of boundaries", () => {
    expect(accuracyBand(39)).toBe("low");
    expect(accuracyBand(40)).toBe("middle");
    expect(accuracyBand(74)).toBe("middle");
    expect(accuracyBand(75)).toBe("high");
  });

  it("subject average is flagged as awaiting a ruling, not settled", async () => {
    const mod = await import("./bands");
    expect(Object.keys(mod)).toContain("SUBJECT_AVERAGE_LOW_AWAITING_RULING");
    expect(subjectAverageBand(39)).toBe("low");
    expect(subjectAverageBand(40)).toBe("middle");
  });
});
