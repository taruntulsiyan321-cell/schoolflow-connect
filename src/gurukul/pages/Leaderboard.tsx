import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Trophy, Zap } from "lucide-react";
import { ProgressionService, useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { useAuth } from "@/hooks/useAuth";
import { GlassCard, SectionLabel, ProgressBar, cn } from "@/gurukul/components/shared";
import { toErrorMessage, toPersonName } from "@/lib/presentation";

type LbRow = {
  userId: string;
  name: string;
  value: number;
  level: number;
  league: string;
  you: boolean;
};

/**
 * Class XP rankings from ProgressionService (rpc_progression_leaderboard).
 * Lifetime YOU value must match Dashboard/Profile snapshot.xp (student_xp.xp).
 */
export default function Leaderboard() {
  const { user } = useAuth();
  const { ctx, ready } = useAcademicContext();
  const liveVersion = useAcademicLive(["xp", "profile"]);
  const loadedRef = useRef(false);
  const [rows, setRows] = useState<LbRow[]>([]);
  const [period, setPeriod] = useState<"lifetime" | "weekly" | "monthly">("lifetime");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      if (!loadedRef.current) setLoading(true);
      setError(null);
      try {
        const lb = await ProgressionService.leaderboard(ctx, {
          scope: "class",
          period,
          metric: "xp",
          limit: 100,
        });
        if (cancelled) return;
        setRows(
          lb.rows.map((r) => ({
            userId: r.user_id,
            name: toPersonName(r.name, { kind: "student" }),
            value: Number(r.value) || 0,
            level: Number(r.level) || 1,
            league: r.league || "bronze",
            you: r.user_id === user?.id,
          })),
        );
        loadedRef.current = true;
      } catch (e) {
        if (!cancelled) {
          setRows([]);
          setError(toErrorMessage(e, "Failed to load rankings"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, period, user?.id, liveVersion]);

  useEffect(() => {
    let cancelled = false;
    const onXp = () => {
      if (!ready || !ctx) return;
      void ProgressionService.leaderboard(ctx, {
        scope: "class",
        period,
        metric: "xp",
        limit: 100,
      })
        .then((lb) => {
          if (cancelled) return;
          setRows(
            lb.rows.map((r) => ({
              userId: r.user_id,
              name: toPersonName(r.name, { kind: "student" }),
              value: Number(r.value) || 0,
              level: Number(r.level) || 1,
              league: r.league || "bronze",
              you: r.user_id === user?.id,
            })),
          );
        })
        .catch(() => undefined);
    };
    window.addEventListener("student-xp-updated", onXp);
    return () => {
      cancelled = true;
      window.removeEventListener("student-xp-updated", onXp);
    };
  }, [ready, ctx, period, user?.id]);

  const ranked = useMemo(() => rows.map((r, i) => ({ ...r, rank: i + 1 })), [rows]);
  const maxXp = useMemo(() => Math.max(1, ...ranked.map((r) => r.value)), [ranked]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading rankingsâ€¦
      </div>
    );
  }

  if (error) {
    return <div className="text-center text-sm text-destructive py-16">{error}</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        {(
          [
            { key: "lifetime" as const, label: "All time" },
            { key: "weekly" as const, label: "This week" },
            { key: "monthly" as const, label: "This month" },
          ]
        ).map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriod(p.key)}
            className={cn(
              "px-3 py-1.5 rounded-xl text-[11px] font-semibold border transition-colors",
              period === p.key
                ? "border-amber-400/40 bg-amber-400/10 text-amber-300"
                : "border-border/70 text-muted-foreground hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <GlassCard className="p-5">
        <SectionLabel>Class XP Â· Progression Engine</SectionLabel>
        {ranked.length === 0 && (
          <div className="text-xs text-muted-foreground py-8 text-center">
            No class XP rankings yet. Earn XP from practice, homework, and battles to appear here.
          </div>
        )}
        <div className="space-y-2">
          {ranked.map((p) => (
            <div
              key={p.userId}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl border transition-colors",
                p.you ? "border-blue-500/30 bg-blue-500/8" : "border-border/70 hover:border-border",
              )}
            >
              <div className="w-7 h-7 flex items-center justify-center shrink-0">
                {p.rank <= 3 ? (
                  <Trophy
                    className={cn(
                      "w-4 h-4",
                      p.rank === 1 ? "text-amber-400" : p.rank === 2 ? "text-slate-400" : "text-orange-400",
                    )}
                  />
                ) : (
                  <span className="text-xs font-black text-muted-foreground">#{p.rank}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={cn("text-sm font-semibold", p.you ? "text-blue-300" : "text-foreground")}>
                    {p.name}
                  </span>
                  {p.you && (
                    <span className="text-[9px] text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded-full font-semibold">
                      YOU
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <ProgressBar value={Math.round((p.value / maxXp) * 100)} color="#6882e8" height="h-1" />
                  <span className="text-[11px] text-muted-foreground shrink-0 capitalize">
                    Lv.{p.level} Â· {p.league}
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0 text-[11px] text-muted-foreground">
                <div className="flex items-center gap-1 justify-end text-foreground font-bold">
                  <Zap className="w-3 h-3 text-amber-400" />
                  {p.value} XP
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
