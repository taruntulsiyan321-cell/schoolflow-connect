import { describe, expect, it } from "vitest";
import {
  bandFromScore,
  buildStudentEducationalIntelligence,
  buildSchoolRiskRollups,
  computeDoubtUrgency,
  EIE_ALGORITHM_ID,
  isStrongBand,
  isWeakBand,
  MASTERY_THRESHOLDS,
} from "./index";

describe("EIE mastery thresholds", () => {
  it("maps scores to bands using conceptMasteryEngine-aligned cuts", () => {
    expect(MASTERY_THRESHOLDS.weakMax).toBe(60);
    expect(MASTERY_THRESHOLDS.developingMax).toBe(75);
    expect(bandFromScore(39)).toBe("critical");
    expect(bandFromScore(40)).toBe("weak");
    expect(bandFromScore(59)).toBe("weak");
    expect(bandFromScore(60)).toBe("developing");
    expect(bandFromScore(74)).toBe("developing");
    expect(bandFromScore(75)).toBe("strong");
    expect(bandFromScore(90)).toBe("mastered");
    expect(isWeakBand("weak")).toBe(true);
    expect(isStrongBand("mastered")).toBe(true);
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
    expect(intel.strong_concepts[0]?.concept).toBe("Algebra");
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
