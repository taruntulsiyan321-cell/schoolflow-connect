import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Crown, Loader2, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

type Row = {
  user_id: string;
  full_name: string;
  score: number;
  equipped_badge?: string | null;
};

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ArenaLeaderboard() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc("rpc_leaderboard", {
        _scope: "class",
        _category: "xp",
        _limit: 8,
      });
      if (error) {
        toast({ title: "Could not load leaderboard", description: error.message, variant: "destructive" });
        setRows([]);
      } else {
        setRows((data ?? []) as Row[]);
      }
      setLoading(false);
    })();
  }, []);

  const top3 = rows.slice(0, 3);
  const rest = rows.slice(3, 5);
  const myRank = useMemo(() => {
    if (!user) return null;
    const idx = rows.findIndex((r) => r.user_id === user.id);
    if (idx >= 0) return { rank: idx + 1, row: rows[idx] };
    return null;
  }, [rows, user]);

  if (loading) {
    return (
      <div className="ba-leaderboard-panel p-5 flex items-center justify-center min-h-[280px]">
        <Loader2 className="w-6 h-6 animate-spin text-white/70" />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="ba-leaderboard-panel p-5 text-center space-y-2">
        <Trophy className="w-8 h-8 mx-auto text-[var(--ba-secondary-fixed)] opacity-80" />
        <p className="text-sm text-white/75">No class rankings yet. Win a battle to appear here.</p>
        <Link to="/student/battleground" className="ba-label text-[var(--ba-secondary-fixed)] hover:underline">
          View arena
        </Link>
      </div>
    );
  }

  const podiumOrder = top3.length >= 3 ? [top3[1], top3[0], top3[2]] : top3;

  return (
    <div className="ba-leaderboard-panel p-4 md:p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Trophy className="w-4 h-4 text-[var(--ba-secondary-fixed)]" />
        <h3 className="ba-headline text-sm uppercase tracking-tight text-white">Class leaderboard</h3>
      </div>

      {top3.length > 0 && (
        <div className="flex justify-around items-end pt-2 pb-3 border-b border-white/10">
          {podiumOrder.map((r, i) => {
            const rank = top3.indexOf(r) + 1;
            const isFirst = rank === 1;
            return (
              <div
                key={r.user_id}
                className={cn("flex flex-col items-center", isFirst && "scale-105 -mb-1")}
              >
                {isFirst && <Crown className="w-4 h-4 text-[var(--ba-secondary-fixed)] mb-1" />}
                <div
                  className={cn(
                    "rounded-full border-2 overflow-hidden flex items-center justify-center font-bold text-xs bg-white/10",
                    isFirst
                      ? "w-14 h-14 border-[var(--ba-secondary-fixed)]"
                      : "w-11 h-11 border-white/30",
                  )}
                >
                  {initials(r.full_name)}
                </div>
                <div className={cn("font-semibold text-xs mt-1.5 truncate max-w-[72px]", isFirst && "text-[var(--ba-secondary-fixed)]")}>
                  {r.full_name.split(" ")[0]}
                </div>
                <div className="text-[10px] text-white/60">{Number(r.score).toLocaleString()} XP</div>
                <div
                  className={cn(
                    "mt-1.5 rounded-t flex items-center justify-center font-bold text-[var(--ba-primary-container)]",
                    isFirst ? "h-14 w-9 bg-[var(--ba-secondary-fixed)] text-sm" : rank === 2 ? "h-10 w-7 bg-white/15 text-xs" : "h-8 w-7 bg-white/10 text-xs",
                  )}
                >
                  {rank}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="space-y-1.5">
        {rest.map((r, i) => (
          <div
            key={r.user_id}
            className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10 text-sm"
          >
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-mono text-white/40 text-xs w-5">{String(i + 4).padStart(2, "0")}</span>
              <span className="truncate">{r.full_name.split(" ")[0]}</span>
            </div>
            <span className="font-mono font-semibold text-[var(--ba-secondary-fixed)] text-xs shrink-0">
              {Number(r.score).toLocaleString()}
            </span>
          </div>
        ))}

        {myRank && myRank.rank > 5 && (
          <div className="flex items-center justify-between p-2 rounded-lg bg-[var(--ba-secondary-container)]/20 border border-[var(--ba-secondary-fixed)] mt-2">
            <div className="flex items-center gap-3 min-w-0">
              <span className="font-mono font-bold text-[var(--ba-secondary-fixed)] text-xs">{myRank.rank}</span>
              <span className="truncate text-[var(--ba-secondary-fixed)] font-medium text-sm">You</span>
            </div>
            <span className="font-mono font-bold text-[var(--ba-secondary-fixed)] text-xs">
              {Number(myRank.row.score).toLocaleString()}
            </span>
          </div>
        )}
      </div>

      <Link
        to="/student/battleground"
        className="block text-center ba-label text-[var(--ba-secondary-fixed)] hover:underline pt-1"
      >
        Full rankings
      </Link>
    </div>
  );
}
