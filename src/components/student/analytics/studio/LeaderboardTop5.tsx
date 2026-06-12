import type { LeaderboardEntry } from "@/hooks/useAnalysisPageData";
import { cn } from "@/lib/utils";

type Props = {
  entries: LeaderboardEntry[];
  currentUserId: string | undefined;
};

export function LeaderboardTop5({ entries, currentUserId }: Props) {
  if (entries.length === 0) return null;

  return (
    <section>
      <h2 className="as-section-title">Class leaderboard</h2>
      <div className="as-card">
        {entries.map((entry) => {
          const isYou = entry.user_id === currentUserId;
          return (
            <div
              key={entry.user_id}
              className={cn("as-lb-row", isYou && "as-lb-row--you")}
            >
              <span className={cn("as-lb-rank", entry.rank <= 3 && "as-lb-rank--top")}>
                {entry.rank}
              </span>
              <span className="as-lb-name">
                {entry.full_name}
                {isYou && <span className="as-lb-you-tag">You</span>}
              </span>
              <span className="as-lb-score">{entry.score.toLocaleString()} XP</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
