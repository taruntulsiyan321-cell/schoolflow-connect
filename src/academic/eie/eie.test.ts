import { describe, expect, it } from "vitest";
import { bandFromScore, MASTERY_THRESHOLDS } from "./masteryBands";
import {
  bandFromScore as edgeBandFromScore,
  buildEieProjection,
  findNamedConcept,
} from "../../../supabase/functions/_shared/eieProjection.ts";
import { buildSchoolRiskRollups } from "../../../supabase/functions/_shared/schoolRollups.ts";

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

  it("the edge projection bands every score exactly as the app does", () => {
    // Two homes for one scale: the app's (this folder) and the one ai-gateway
    // runs. The edge copy kept "strong"/"mastered" for a month after the app's
    // was ruled out; this is the check that would have caught it.
    for (let score = -5; score <= 105; score += 0.5) {
      expect(edgeBandFromScore(score), String(score)).toBe(bandFromScore(score));
    }
  });
});

describe("EIE projection (the one ai-gateway runs)", () => {
  const MASTERY = [
    { subject: "Math", concept: "Fractions", mastery_score: 42, mistake_count: 3 },
    { subject: "Math", concept: "Algebra", mastery_score: 88, mistake_count: 0 },
    { subject: "Math", concept: "Integration by parts", mastery_score: 95 },
  ];

  it("builds the projection without inventing demo scores", () => {
    const intel = buildEieProjection({
      studentId: "s1",
      schoolId: "sch1",
      mastery: MASTERY,
      revisionQueue: [
        {
          subject: "Math",
          topic: "Fractions",
          priority: 9,
          reason: "weak_topic",
          completed: false,
        },
      ],
    });

    expect(intel.algorithm_id).toBe("eie.mastery.v1");
    expect(intel.avg_mastery).toBe(75);
    expect(intel.total_tracked).toBe(3);
    expect(intel.weak_concepts.map((c) => c.concept)).toEqual(["Fractions"]);
    expect(intel.revision_priority[0]?.priority).toBe(9);
    expect(intel.completeness).toBeGreaterThan(0);
    // Empty mastery → zeros, not demo 1382 XP / Level 14
    const empty = buildEieProjection({
      studentId: "s2",
      schoolId: "sch1",
      mastery: [],
      revisionQueue: [],
    });
    expect(empty.avg_mastery).toBe(0);
    expect(empty.total_tracked).toBe(0);
    expect(empty.weak_concepts).toEqual([]);
  });

  it("selects weaknesses only — no strength field or strength word anywhere in it (§10.8)", () => {
    const intel = buildEieProjection({
      studentId: "s1",
      schoolId: "sch1",
      mastery: MASTERY,
      revisionQueue: [],
    });
    // Serialised, so a strength list under any key name is caught, and the two
    // high concepts are in the input so a selection of them has something to find.
    const serialised = JSON.stringify(intel);
    expect(serialised).not.toMatch(/strong|mastered|proficient|excellent/i);
    expect(serialised).not.toContain("Integration by parts");
    // And the positive, so an engine returning nothing would not pass.
    expect(serialised).toContain("Fractions");
  });

  it("LLM never supplies mastery — projection is pure from inputs", () => {
    const run = () => {
      const { computed_at: _stamp, ...rest } = buildEieProjection({
        studentId: "s1",
        schoolId: "sch1",
        mastery: [{ subject: "Science", concept: "Cells", mastery_score: 55 }],
        revisionQueue: [],
      });
      return rest;
    };
    expect(run()).toEqual(run());
    expect(run().weak_concepts[0]?.band).toBe("weak");
  });
});

describe("findNamedConcept", () => {
  const ROWS = [
    { subject: "Math", concept: "Integration", mastery_score: 70 },
    { subject: "Math", concept: "Integration by parts", mastery_score: 92 },
    { subject: "Math", concept: "Limits", mastery_score: 30 },
  ];

  it("finds the concept the student names, whatever its band", () => {
    expect(findNamedConcept(ROWS, "explain limits to me")?.concept).toBe("Limits");
    const high = findNamedConcept(ROWS, "Help me with integration by parts");
    expect(high?.concept).toBe("Integration by parts");
    expect(high?.band).toBe(bandFromScore(92));
  });

  it("prefers the most specific name, and finds nothing in a request naming nothing", () => {
    expect(findNamedConcept(ROWS, "integration by parts please")?.concept).toBe(
      "Integration by parts",
    );
    expect(findNamedConcept(ROWS, "integration")?.concept).toBe("Integration");
    expect(findNamedConcept(ROWS, "Explain this concept to me")).toBeNull();
    expect(findNamedConcept(ROWS, "")).toBeNull();
  });
});

describe("EIE school rollups", () => {
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
});
