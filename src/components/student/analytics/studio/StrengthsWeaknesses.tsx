import type { ConceptMasteryItem } from "@/hooks/useConceptMastery";
import type { TopicGapInsight } from "@/lib/analyticsInsights";

type Props = {
  strongConcepts: ConceptMasteryItem[];
  topicGaps: TopicGapInsight[];
  weakConcepts: ConceptMasteryItem[];
};

export function StrengthsWeaknesses({ strongConcepts, topicGaps, weakConcepts }: Props) {
  const strengths = strongConcepts.slice(0, 6);
  const weaknesses =
    topicGaps.length > 0
      ? topicGaps.slice(0, 6).map((t) => ({
          label: t.topic,
          pct: null as number | null,
          mistakes: t.mistake_count,
        }))
      : weakConcepts.slice(0, 6).map((c) => ({
          label: c.concept,
          pct: Math.round(c.mastery_score),
          mistakes: c.mistake_count,
        }));

  return (
    <section>
      <h2 className="as-section-title">Strengths vs weaknesses</h2>
      <div className="as-sw-grid">
        <div className="as-card as-sw-col as-sw-col--strong">
          <h3 className="as-sw-col__title">Strengths</h3>
          {strengths.length === 0 ? (
            <p className="text-sm text-[var(--as-muted)]">Practice more to unlock strengths.</p>
          ) : (
            strengths.map((c) => (
              <div key={`${c.subject}-${c.concept}`} className="as-sw-item">
                <span>{c.concept}</span>
                <span className="as-sw-item__pct text-[var(--as-emerald)]">
                  {Math.round(c.mastery_score)}%
                </span>
              </div>
            ))
          )}
        </div>
        <div className="as-card as-sw-col as-sw-col--weak">
          <h3 className="as-sw-col__title">Weaknesses</h3>
          {weaknesses.length === 0 ? (
            <p className="text-sm text-[var(--as-muted)]">No weak spots flagged yet.</p>
          ) : (
            weaknesses.map((w, i) => (
              <div key={`${w.label}-${i}`} className="as-sw-item">
                <span>{w.label}</span>
                <span className="as-sw-item__pct text-[var(--as-rose)]">
                  {w.pct != null ? `${w.pct}%` : `${w.mistakes} mistakes`}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
