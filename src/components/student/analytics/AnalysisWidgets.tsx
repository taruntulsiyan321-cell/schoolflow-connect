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
  variant = "default",
}: {
  rank: number | null;
  classSize: number;
  topPeers: LeaderboardEntry[];
  currentUserId?: string;
  variant?: "default" | "wisdom";
}) {
  if (!rank && topPeers.length === 0) return null;
  const isWisdom = variant === "wisdom";

  return (
    <section className={cn(isWisdom ? "wa-card" : "rounded-2xl border border-border/60 bg-card p-5 shadow-sm")}>
      <div className="flex items-center justify-between gap-3 mb-4">
        {isWisdom ? (
          <h3 className="wa-headline text-lg">Class standing</h3>
        ) : (
          <FlowSectionTitle>Class standing</FlowSectionTitle>
        )}
        <Link
          to="/student/leaderboard"
          className={cn(
            "text-xs font-medium hover:underline",
            isWisdom ? "text-[var(--wa-primary)]" : "text-primary",
          )}
        >
          Full leaderboard
        </Link>
      </div>
      {rank != null && (
        <div
          className={cn(
            "flex items-center gap-3 mb-4 px-4 py-3",
            isWisdom
              ? "rounded-xl bg-[var(--wa-surface-low)] border border-[var(--wa-outline-variant)]"
              : "rounded-xl bg-primary/5 border border-primary/10",
          )}
        >
          <Trophy className={cn("w-5 h-5 shrink-0", isWisdom ? "text-[var(--wa-secondary-fixed-dim)]" : "text-accent")} />
          <div>
            <p className={cn("text-2xl font-semibold tabular-nums", isWisdom ? "text-[var(--wa-primary)]" : "text-foreground")}>
              #{rank}
            </p>
            <p className={cn("text-xs", isWisdom ? "text-[var(--wa-on-surface-variant)]" : "text-muted-foreground")}>
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
                  "wa-standing-row",
                  isYou && "is-you",
                  !isWisdom && cn(
                    "flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm",
                    isYou ? "bg-primary/10 border border-primary/20" : "bg-muted/30",
                  ),
                )}
              >
                <span className={cn("font-medium truncate", isWisdom ? "text-[var(--wa-on-surface)]" : "text-foreground")}>
                  <span className={cn("tabular-nums mr-2", isWisdom ? "text-[var(--wa-on-surface-variant)]" : "text-muted-foreground")}>
                    {e.rank}.
                  </span>
                  {e.full_name}
                  {isYou && (
                    <span className={cn("ml-1.5 text-[10px] font-semibold uppercase", isWisdom ? "text-[var(--wa-primary)]" : "text-primary")}>
                      You
                    </span>
                  )}
                </span>
                <span className={cn("text-xs font-semibold tabular-nums shrink-0", isWisdom ? "text-[var(--wa-primary)]" : "text-primary")}>
                  {e.score} XP
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
