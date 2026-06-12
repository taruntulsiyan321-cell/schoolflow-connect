import type { PracticeSessionSummary } from "@/hooks/useAnalysisPageData";
import { cn } from "@/lib/utils";

type Props = {
  sessions: PracticeSessionSummary[];
};

function scoreClass(pct: number) {
  if (pct >= 70) return "as-session__score--good";
  if (pct >= 50) return "as-session__score--mid";
  return "as-session__score--low";
}

export function RecentSessionsList({ sessions }: Props) {
  if (sessions.length === 0) {
    return (
      <p className="text-sm text-[var(--as-muted)]">No recent sessions — start practicing to see activity here.</p>
    );
  }

  return (
    <section>
      <h2 className="as-section-title">Recent sessions</h2>
      <div className="as-card">
        {sessions.slice(0, 8).map((s) => {
          const when = new Date(s.finished_at).toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          });
          return (
            <div key={s.id} className="as-session">
              <div className="min-w-0">
                {s.subject && <span className="as-session__badge">{s.subject}</span>}
                <p className="text-sm font-medium truncate">
                  {s.chapter || "Practice session"}
                </p>
                <p className="as-session__time">
                  {when} · {s.duration_minutes}m
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className={cn("as-session__score", scoreClass(s.accuracy_pct))}>
                  {s.accuracy_pct}%
                </p>
                <p className="text-[0.65rem] text-[var(--as-muted)]">
                  {s.correct_count}/{s.question_count}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
