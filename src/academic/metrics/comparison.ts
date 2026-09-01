/**
 * CHUNK 10 — sibling-section comparison.
 *
 * §10: "Comparison: sibling section values for every figure above" and
 * "Cross-section figures are percentages."
 *
 * THE RULE THIS ENFORCES, and the reason it is one function rather than a
 * pattern repeated per screen: a section that has not been measured is not a
 * section that scored zero. A comparison table is where that distinction gets
 * lost fastest, because a blank cell and a 0% cell sit in the same column and a
 * reader ranks them together. So `compare()` returns the measured sections
 * ranked, and the unmeasured ones listed separately with their reason — never
 * interleaved, never defaulted to 0.
 *
 * PrincipalClassComparison.tsx rendered three invented sections with invented
 * class teachers and figures. This is what it should have been asking.
 */

import { type Metric, ok, noData, isOk } from "./types";

export interface SectionMetric {
  sectionId: string;
  sectionName: string;
  metric: Metric<number>;
}

export interface Comparison {
  /** Measured sections, best first. */
  ranked: { sectionId: string; sectionName: string; value: number; rank: number }[];
  /** Sections with no answer, and why. Never given a value. */
  unmeasured: { sectionId: string; sectionName: string; state: string; basis: string }[];
  /** Spread across the measured sections — the point of comparing at all. */
  best: number | null;
  worst: number | null;
  spread: number | null;
}

/**
 * Rank sibling sections on one metric.
 *
 * `higherIsBetter` is explicit because both directions occur: attendance and
 * completion rank high-first, "days since last activity" and "marks pending"
 * rank low-first, and a default would silently invert half the tables.
 */
export function compare(
  sections: SectionMetric[],
  higherIsBetter = true,
): Metric<Comparison> {
  if (sections.length === 0) return noData<Comparison>("no sibling sections");

  const measured: { sectionId: string; sectionName: string; value: number }[] = [];
  const unmeasured: Comparison["unmeasured"] = [];
  for (const s of sections) {
    if (isOk(s.metric)) {
      measured.push({ sectionId: s.sectionId, sectionName: s.sectionName, value: s.metric.value });
    } else {
      unmeasured.push({
        sectionId: s.sectionId,
        sectionName: s.sectionName,
        state: s.metric.state,
        basis: s.metric.basis,
      });
    }
  }

  if (measured.length === 0) {
    return noData<Comparison>(
      `${sections.length} sibling section(s), none measured — nothing to compare`,
    );
  }

  measured.sort((a, b) => (higherIsBetter ? b.value - a.value : a.value - b.value));

  // Competition ranking: ties share a rank.
  const ranked: Comparison["ranked"] = [];
  let lastValue: number | null = null;
  let lastRank = 0;
  measured.forEach((m, i) => {
    const rank = lastValue !== null && m.value === lastValue ? lastRank : i + 1;
    lastValue = m.value;
    lastRank = rank;
    ranked.push({ ...m, rank });
  });

  const values = measured.map((m) => m.value);
  const hi = Math.max(...values);
  const lo = Math.min(...values);

  return ok(
    {
      ranked,
      unmeasured,
      best: higherIsBetter ? hi : lo,
      worst: higherIsBetter ? lo : hi,
      spread: Math.round((hi - lo) * 10) / 10,
    },
    `${measured.length} of ${sections.length} sibling section(s) measured` +
      (unmeasured.length ? `; ${unmeasured.length} unmeasured and excluded from the ranking` : ""),
  );
}

/**
 * One section against its siblings: where it sits, and by how much.
 *
 * `no_data` when THIS section is unmeasured, even if the siblings are — the
 * question is about this one, and answering with the sibling average would be
 * answering a different question.
 */
export function standing(
  sections: SectionMetric[],
  sectionId: string,
  higherIsBetter = true,
): Metric<{ rank: number; of: number; value: number; spreadToBest: number }> {
  const c = compare(sections, higherIsBetter);
  if (!isOk(c)) return noData(c.basis);

  const me = c.value.ranked.find((r) => r.sectionId === sectionId);
  if (!me) {
    const un = c.value.unmeasured.find((u) => u.sectionId === sectionId);
    return noData(
      un
        ? `this section is ${un.state}: ${un.basis}`
        : `section ${sectionId} is not among the siblings supplied`,
    );
  }
  const best = c.value.best as number;
  return ok(
    {
      rank: me.rank,
      of: c.value.ranked.length,
      value: me.value,
      spreadToBest: Math.round(Math.abs(best - me.value) * 10) / 10,
    },
    `rank ${me.rank} of ${c.value.ranked.length} measured sibling section(s)`,
  );
}
