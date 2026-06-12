import { Sparkles } from "lucide-react";

type Props = {
  lines: string[];
  loading?: boolean;
};

export function CoachCard({ lines, loading }: Props) {
  return (
    <div className="as-card as-coach">
      <div className="as-coach__header">
        <Sparkles className="w-4 h-4 text-[var(--as-cyan)]" />
        <span className="as-coach__title">Your coach</span>
        {loading && (
          <span className="text-[0.65rem] text-[var(--as-muted)] ml-auto">Updating insights…</span>
        )}
      </div>
      {lines.length === 0 ? (
        <p className="text-sm text-[var(--as-muted)]">
          Complete a practice session — your study coach will highlight patterns from your mistakes.
        </p>
      ) : (
        <ol className="as-coach__list">
          {lines.slice(0, 6).map((line, i) => (
            <li key={i} className="as-coach__item">
              <span className="as-coach__num">{i + 1}</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
