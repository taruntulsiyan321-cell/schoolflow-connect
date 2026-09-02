import { describe, expect, it } from "vitest";
import {
  bandFromScore,
  buildStudentEducationalIntelligence,
  buildSchoolRiskRollups,
  computeDoubtUrgency,
  EIE_ALGORITHM_ID,
  isWeakBand,
  MASTERY_THRESHOLDS,
} from "./index";

describe("EIE mastery thresholds", () => {
  it("maps scores to bands using conceptMasteryEngine-aligned cuts", () => {
    // The CUTS are the contract; the words are not. The previous version of
    // this test asserted bandFromScore(75) === "strong" and
    // isStrongBand("mastered") === true, which pinned the exact vocabulary
    // §10.8 forbids and would have failed on the fix rather than on a bug.
    expect(MASTERY_THRESHOLDS.weakMax).toBe(60);
    expect(MASTERY_THRESHOLDS.developingMax).toBe(75);
    expect(bandFromScore(39)).toBe("critical");
    expect(bandFromScore(40)).toBe("weak");
    expect(bandFromScore(59)).toBe("weak");
    expect(bandFromScore(60)).toBe("developing");
    expect(bandFromScore(74)).toBe("developing");
    // A cut still moves at 75 and again at 90 — asserted by the band CHANGING,
    // not by what it is called.
    expect(bandFromScore(75)).not.toBe(bandFromScore(74));
    expect(bandFromScore(90)).not.toBe(bandFromScore(89));
    expect(isWeakBand("weak")).toBe(true);
  });

  it("names no band after an achievement, and still names every band", () => {
    // Two assertions, because either alone is passable by a defect:
    //   the negative alone passes on an empty string
    //   the positive alone passes on "mastered"
    const scores = [0, 20, 39, 40, 59, 60, 74, 75, 89, 90, 100];
    const bands = [...new Set(scores.map(bandFromScore))];

    expect(bands.length).toBeGreaterThanOrEqual(4);
    for (const band of bands) {
      expect(band).not.toMatch(/strong|master|proficient|excellent/i);
      expect(typeof band).toBe("string");
      expect(band.trim().length).toBeGreaterThan(0);
    }
  });

  it("builds StudentEducationalIntelligence without inventing demo scores", () => {
    const intel = buildStudentEducationalIntelligence({
      studentId: "s1",
      schoolId: "sch1",
      mastery: [
        { subject: "Math", concept: "Fractions", mastery_score: 42, mistake_count: 3 },
        { subject: "Math", concept: "Algebra", mastery_score: 88, mistake_count: 0 },
      ],
      revisionQueue: [
        {
          subject: "Math",
          topic: "Fractions",
          priority: 9,
          reason: "weak_topic",
          completed: false,
        },
      ],
      computedAt: "2026-08-02T00:00:00.000Z",
    });

    expect(intel.algorithm_id).toBe(EIE_ALGORITHM_ID);
    expect(intel.avg_mastery).toBe(65);
    expect(intel.weak_concepts[0]?.concept).toBe("Fractions");
    // §10.8: the product surfaces weaknesses only. Asserted as the ABSENCE of
    // any strength-selection field rather than as a missing property name — a
    // field renamed to top_concepts would satisfy the latter and violate the
    // rule just as completely.
    expect(Object.keys(intel).filter((k) => /strong/i.test(k))).toEqual([]);
    // And the positive: the weak side must still be populated, or an engine
    // returning nothing at all would pass the line above.
    expect(intel.weak_concepts.length).toBeGreaterThan(0);
    expect(intel.revision_priority[0]?.priority).toBe(9);
    expect(intel.completeness).toBeGreaterThan(0);
    // Empty mastery → zeros, not demo 1382 XP / Level 14
    const empty = buildStudentEducationalIntelligence({
      studentId: "s2",
      schoolId: "sch1",
      mastery: [],
      revisionQueue: [],
    });
    expect(empty.avg_mastery).toBe(0);
    expect(empty.total_tracked).toBe(0);
    expect(empty.weak_concepts).toEqual([]);
  });

  it("LLM never supplies mastery — projection is pure from inputs", () => {
    const a = buildStudentEducationalIntelligence({
      studentId: "s1",
      schoolId: "sch1",
      mastery: [{ subject: "Science", concept: "Cells", mastery_score: 55 }],
      revisionQueue: [],
      computedAt: "2026-08-02T00:00:00.000Z",
    });
    const b = buildStudentEducationalIntelligence({
      studentId: "s1",
      schoolId: "sch1",
      mastery: [{ subject: "Science", concept: "Cells", mastery_score: 55 }],
      revisionQueue: [],
      computedAt: "2026-08-02T00:00:00.000Z",
    });
    expect(a).toEqual(b);
    expect(a.weak_concepts[0]?.band).toBe("weak");
  });

  it("builds school risk rollups from academic profiles only", () => {
    const rollup = buildSchoolRiskRollups([
      { class_id: "c1", attendance_pct: 60, homework_completion_pct: 40 },
      { class_id: "c1", attendance_pct: 95, homework_completion_pct: 90 },
    ]);
    expect(rollup.algorithm_id).toBe("eie.school_rollup.v1");
    expect(rollup.class_count).toBe(1);
    expect(rollup.student_count).toBe(2);
    expect(rollup.attendance_risk_band).not.toBe("unknown");
  });

  it("computes doubt urgency deterministically from age + visibility", () => {
    const now = new Date("2026-08-07T12:00:00.000Z");

    const fresh = computeDoubtUrgency({ createdAt: "2026-08-07T11:00:00.000Z", viewCount: 0, now });
    expect(fresh.band).toBe("low");
    expect(fresh.reason_codes).toContain("doubt_recent_low_visibility");

    const stale = computeDoubtUrgency({ createdAt: "2026-08-05T12:00:00.000Z", viewCount: 5, now });
    expect(stale.age_hours).toBe(48);
    expect(stale.band).toBe("high");
    expect(stale.reason_codes).toContain("doubt_stale_24h");

    const popular = computeDoubtUrgency({ createdAt: "2026-08-07T11:00:00.000Z", viewCount: 12, now });
    expect(popular.reason_codes).toContain("doubt_high_visibility");
    expect(popular.score).toBeGreaterThan(fresh.score);

    // Same inputs -> same output. No randomness, no invented data.
    const a = computeDoubtUrgency({ createdAt: "2026-08-06T12:00:00.000Z", viewCount: 3, now });
    const b = computeDoubtUrgency({ createdAt: "2026-08-06T12:00:00.000Z", viewCount: 3, now });
    expect(a).toEqual(b);
  });
});
