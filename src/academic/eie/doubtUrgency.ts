/**
 * EIE doubt-triage product - deterministic urgency from age + visibility.
 * No LLM: a stale, widely-viewed unanswered doubt is objectively more
 * urgent than a fresh one nobody has looked at yet.
 *
 * THIS IS NOT A RiskBand, though it used to be typed as one. The header here
 * argued the reuse was a virtue - "rather than inventing a parallel scale" -
 * but the scale was already parallel: this ladder breaks at 75/50/25 while
 * attendance risk breaks at 75/55/35 and consistency runs INVERTED at 85/70/50.
 * Three ladders, one type, four shared words meaning three different things.
 *
 * A risk band describes A STUDENT'S STANDING. An urgency band describes AN
 * ITEM'S CLAIM ON SOMEONE'S ATTENTION. That is the same split already made
 * between riskBand and urgencyBand in metrics/bands.ts, applied here.
 *
 * The two unions share their members, so TypeScript's structural typing will
 * still permit a cross-assignment. What the split buys is in the NAMES and the
 * NUMBERS: nobody can now "align" the three ladders without noticing they were
 * never measuring the same thing.
 */
export type DoubtUrgencyBand = "low" | "moderate" | "elevated" | "high" | "unknown";

/** An ITEM'S claim on attention. Not comparable to RISK_SCORE_* - different subject. */
export const DOUBT_URGENCY_HIGH = 75;
export const DOUBT_URGENCY_ELEVATED = 50;
export const DOUBT_URGENCY_MODERATE = 25;

export type DoubtUrgencyProduct = {
  product: "doubt_urgency";
  age_hours: number;
  view_count: number;
  score: number;
  band: DoubtUrgencyBand;
  reason_codes: string[];
};

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Age contributes up to 60 points (saturates at 48h unanswered); visibility
 * (how many students have looked at the same stuck point) contributes up to
 * 40 (saturates at 10 views). Weighted toward age because a doubt nobody has
 * seen yet is still a real student waiting, just not yet a visible pattern.
 */
export function computeDoubtUrgency(input: {
  createdAt: string;
  viewCount: number | null | undefined;
  now?: Date;
}): DoubtUrgencyProduct {
  const now = input.now ?? new Date();
  const created = new Date(input.createdAt);
  const ageHoursRaw = Number.isFinite(created.getTime())
    ? (now.getTime() - created.getTime()) / 3_600_000
    : 0;
  const ageHours = Math.max(0, ageHoursRaw);
  const views = Math.max(0, Number(input.viewCount ?? 0));

  const ageScore = Math.min(60, (ageHours / 48) * 60);
  const viewScore = Math.min(40, (views / 10) * 40);
  const score = clampScore(ageScore + viewScore);

  const reason_codes: string[] = [];
  if (ageHours >= 24) reason_codes.push("doubt_stale_24h");
  else if (ageHours >= 6) reason_codes.push("doubt_aging_6h");
  if (views >= 5) reason_codes.push("doubt_high_visibility");
  if (reason_codes.length === 0) reason_codes.push("doubt_recent_low_visibility");

  let band: DoubtUrgencyBand;
  if (score >= DOUBT_URGENCY_HIGH) band = "high";
  else if (score >= DOUBT_URGENCY_ELEVATED) band = "elevated";
  else if (score >= DOUBT_URGENCY_MODERATE) band = "moderate";
  else band = "low";

  return {
    product: "doubt_urgency",
    age_hours: Math.round(ageHours * 10) / 10,
    view_count: views,
    score,
    band,
    reason_codes,
  };
}
