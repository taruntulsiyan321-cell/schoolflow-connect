export type BattleAiInsights = {
  headline: string;
  insights: string[];
  focus_areas: string[];
  praise: string;
  recommendation: string;
  source?: "ai" | "gemini" | "rule";
};

export function buildRuleBattleInsights(report: Record<string, unknown>): BattleAiInsights {
  const s = (report.summary ?? {}) as Record<string, number>;
  const b = (report.battle ?? {}) as Record<string, string>;
  const topics = (report.topics ?? { strong: [], weak: [] }) as {
    strong: { label?: string; accuracy?: number }[];
    weak: { label?: string; accuracy?: number }[];
  };
  const speed = (report.speed ?? {}) as Record<string, number | null>;
  const cmp = (report.comparison ?? {}) as Record<string, number | null>;

  const acc = s.accuracy_pct ?? 0;
  const rank = s.rank ?? 0;
  const total = s.total_participants ?? 1;
  const weak = topics.weak ?? [];
  const strong = topics.strong ?? [];

  const insights: string[] = [];
  if (acc >= 80) insights.push(`Strong accuracy at ${acc}% — you're retaining concepts well.`);
  else if (acc >= 50) insights.push(`Accuracy is ${acc}% — targeted revision can push you above 80%.`);
  else insights.push(`Accuracy is ${acc}% — focus on fundamentals in ${b.subject ?? "this subject"} before speed.`);

  if (s.skipped_count > 0) insights.push(`You skipped ${s.skipped_count} question(s) — practice timed drills to reduce blanks.`);

  if (speed.under_pressure_accuracy != null && speed.comfort_zone_accuracy != null) {
    if (speed.under_pressure_accuracy < speed.comfort_zone_accuracy - 15) {
      insights.push("Accuracy drops under time pressure — rehearse with a shorter per-question timer.");
    }
  }

  if (cmp.vs_avg_accuracy != null) {
    insights.push(
      cmp.vs_avg_accuracy >= 0
        ? `You scored ${cmp.vs_avg_accuracy} points above the class average on accuracy.`
        : `You're ${Math.abs(cmp.vs_avg_accuracy)} points below class average — peer practice battles will help.`,
    );
  }

  const focus_areas = weak.slice(0, 4).map((w) => w.label ?? "Weak topic");
  if (!focus_areas.length && b.chapter) focus_areas.push(b.chapter);

  const praise =
    rank === 1 && total > 1
      ? "Top scorer in this battle — excellent competitive focus."
      : strong.length
        ? `Solid grasp in: ${strong.map((x) => x.label).slice(0, 2).join(", ")}.`
        : "Completing the battle builds consistency — keep showing up daily.";

  const recommendation =
    weak.length > 0
      ? `Revise "${weak[0].label}" from NCERT, then run a solo battle on the same chapter.`
      : `Attempt another ${b.subject ?? ""} battle tomorrow to maintain your streak.`;

  return {
    headline:
      acc >= 75
        ? `Strong ${b.subject ?? "battle"} performance — rank #${rank} of ${total}`
        : `Room to grow in ${b.subject ?? "this battle"} — here's your revision plan`,
    insights,
    focus_areas,
    praise,
    recommendation,
    source: "rule",
  };
}
