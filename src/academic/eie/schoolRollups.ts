/**
 * EIE school / class rollups — attendance risk bands + homework consistency
 * aggregates from student_academic_profiles (deterministic, no LLM).
 */

import {
  computeAttendanceRisk,
  computeHomeworkConsistency,
  type RiskBand,
} from "./riskProducts";

export const EIE_SCHOOL_ROLLUP_ALGORITHM_ID = "eie.school_rollup.v1";

export type ProfileRollupRow = {
  student_id?: string | null;
  class_id?: string | null;
  attendance_pct?: number | null;
  homework_completion_pct?: number | null;
};

export type BandHistogram = Record<RiskBand, number>;

export type ClassRiskRollup = {
  class_id: string;
  student_count: number;
  avg_attendance_pct: number | null;
  avg_homework_completion_pct: number | null;
  attendance_risk_band: RiskBand;
  homework_consistency_band: RiskBand;
  attendance_band_counts: BandHistogram;
  homework_band_counts: BandHistogram;
};

export type SchoolRiskRollup = {
  algorithm_id: typeof EIE_SCHOOL_ROLLUP_ALGORITHM_ID;
  student_count: number;
  class_count: number;
  avg_attendance_pct: number | null;
  avg_homework_completion_pct: number | null;
  attendance_risk_band: RiskBand;
  homework_consistency_band: RiskBand;
  attendance_band_counts: BandHistogram;
  homework_band_counts: BandHistogram;
  /** Top elevated/high attendance-risk classes (by student count in elevated+high). */
  at_risk_class_ids: string[];
  class_rollups: ClassRiskRollup[];
  data_version: string;
};

function emptyBands(): BandHistogram {
  return { low: 0, moderate: 0, elevated: 0, high: 0, unknown: 0 };
}

function avgOrNull(nums: number[]): number | null {
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return Math.round((sum / nums.length) * 10) / 10;
}

/** Dominant non-unknown band by count; tie → higher severity for attendance risk. */
function dominantAttendanceBand(counts: BandHistogram): RiskBand {
  const order: RiskBand[] = ["high", "elevated", "moderate", "low", "unknown"];
  let best: RiskBand = "unknown";
  let bestN = -1;
  for (const b of order) {
    if (counts[b] > bestN) {
      bestN = counts[b];
      best = b;
    }
  }
  if (bestN <= 0) return "unknown";
  return best;
}

/** For homework consistency, prefer healthier dominant when tied. */
function dominantHomeworkBand(counts: BandHistogram): RiskBand {
  const order: RiskBand[] = ["high", "elevated", "moderate", "low", "unknown"];
  let best: RiskBand = "unknown";
  let bestN = -1;
  for (const b of order) {
    if (counts[b] > bestN) {
      bestN = counts[b];
      best = b;
    }
  }
  if (bestN <= 0) return "unknown";
  return best;
}

function rollupRows(rows: ProfileRollupRow[]): {
  student_count: number;
  avg_attendance_pct: number | null;
  avg_homework_completion_pct: number | null;
  attendance_risk_band: RiskBand;
  homework_consistency_band: RiskBand;
  attendance_band_counts: BandHistogram;
  homework_band_counts: BandHistogram;
} {
  const attBands = emptyBands();
  const hwBands = emptyBands();
  const attPcts: number[] = [];
  const hwPcts: number[] = [];

  for (const r of rows) {
    const att = computeAttendanceRisk(r.attendance_pct);
    const hw = computeHomeworkConsistency(r.homework_completion_pct);
    attBands[att.band] += 1;
    hwBands[hw.band] += 1;
    if (att.attendance_pct != null) attPcts.push(att.attendance_pct);
    if (hw.homework_completion_pct != null) hwPcts.push(hw.homework_completion_pct);
  }

  return {
    student_count: rows.length,
    avg_attendance_pct: avgOrNull(attPcts),
    avg_homework_completion_pct: avgOrNull(hwPcts),
    attendance_risk_band: dominantAttendanceBand(attBands),
    homework_consistency_band: dominantHomeworkBand(hwBands),
    attendance_band_counts: attBands,
    homework_band_counts: hwBands,
  };
}

/**
 * Aggregate class + school attendance risk / homework consistency from AE profiles.
 * Honest empty when no rows.
 */
export function buildSchoolRiskRollups(profiles: ProfileRollupRow[]): SchoolRiskRollup {
  const byClass = new Map<string, ProfileRollupRow[]>();
  const unassigned: ProfileRollupRow[] = [];

  for (const p of profiles) {
    const cid = p.class_id?.trim();
    if (!cid) {
      unassigned.push(p);
      continue;
    }
    const list = byClass.get(cid) ?? [];
    list.push(p);
    byClass.set(cid, list);
  }

  const class_rollups: ClassRiskRollup[] = [];
  for (const [class_id, rows] of byClass) {
    const r = rollupRows(rows);
    class_rollups.push({ class_id, ...r });
  }
  class_rollups.sort((a, b) => a.class_id.localeCompare(b.class_id));

  const school = rollupRows(profiles);
  const at_risk_class_ids = class_rollups
    .map((c) => ({
      id: c.class_id,
      risk:
        c.attendance_band_counts.elevated +
        c.attendance_band_counts.high +
        c.homework_band_counts.elevated +
        c.homework_band_counts.high,
    }))
    .filter((x) => x.risk > 0)
    .sort((a, b) => b.risk - a.risk)
    .slice(0, 8)
    .map((x) => x.id);

  return {
    algorithm_id: EIE_SCHOOL_ROLLUP_ALGORITHM_ID,
    student_count: school.student_count,
    class_count: byClass.size,
    avg_attendance_pct: school.avg_attendance_pct,
    avg_homework_completion_pct: school.avg_homework_completion_pct,
    attendance_risk_band: school.attendance_risk_band,
    homework_consistency_band: school.homework_consistency_band,
    attendance_band_counts: school.attendance_band_counts,
    homework_band_counts: school.homework_band_counts,
    at_risk_class_ids,
    class_rollups,
    data_version: `school_rollup:${school.student_count}:${school.attendance_risk_band}:${school.homework_consistency_band}`,
  };
}
