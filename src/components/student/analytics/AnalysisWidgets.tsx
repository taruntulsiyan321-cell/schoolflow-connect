import { Link } from "react-router-dom";
import type { LeaderboardEntry } from "@/hooks/useAnalysisPageData";
import { FlowSectionTitle } from "@/components/student/flow/FlowDesign";
import { cn } from "@/lib/utils";
import { Trophy } from "lucide-react";

/** Compact class standing — inspired by leaderboard idea, not a Figma clone. */
export function AnalysisClassStanding({
  rank,
  classSize,
  topPeers,
  currentUserId,
}: {
  rank: number | null;
  classSize: number;
  topPeers: LeaderboardEntry[];
  currentUserId?: string;
}) {
  if (!rank && topPeers.length === 0) return null;

  return (
    <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-4">
        <FlowSectionTitle>Class standing</FlowSectionTitle>
        <Link to="/student/leaderboard" className="text-xs font-medium text-primary hover:underline">
          Full leaderboard
        </Link>
      </div>
      {rank != null && (
        <div className="flex items-center gap-3 mb-4 rounded-xl bg-primary/5 border border-primary/10 px-4 py-3">
          <Trophy className="w-5 h-5 text-accent shrink-0" />
          <div>
            <p className="text-2xl font-semibold text-foreground tabular-nums">#{rank}</p>
            <p className="text-xs text-muted-foreground">
              of {classSize > 0 ? classSize : "—"} in your class · by XP
            </p>
          </div>
        </div>
      )}
      {topPeers.length > 0 && (
        <ul className="space-y-2">
          {topPeers.slice(0, 5).map((e) => {
            const isYou = e.user_id === currentUserId;
            return (
              <li
                key={e.user_id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm",
                  isYou ? "bg-primary/10 border border-primary/20" : "bg-muted/30",
                )}
              >
                <span className="font-medium text-foreground truncate">
                  <span className="text-muted-foreground tabular-nums mr-2">{e.rank}.</span>
                  {e.full_name}
                  {isYou && <span className="ml-1.5 text-[10px] font-semibold text-primary uppercase">You</span>}
                </span>
                <span className="text-xs font-semibold text-primary tabular-nums shrink-0">{e.score} XP</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
