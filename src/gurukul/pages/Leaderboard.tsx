import { useEffect, useMemo, useRef, useState } from "react";
import { Trophy, Zap } from "lucide-react";
import { ProgressionService, useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState, GlassCard, PageHeader, PageSkeleton, ProgressBar, SectionLabel, Skeleton, SkeletonCard, SkeletonList, cn } from "@/gurukul/components/shared";
import { toErrorMessage, toPersonName } from "@/lib/presentation";
import { StudentErrorState } from "@/components/student/StudentPanelStates";

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
  /** Bumped by the error state's Try again, so the load effect re-runs. */
  const [reloadNonce, setReloadNonce] = useState(0);

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
  }, [ready, ctx, period, user?.id, liveVersion, reloadNonce]);

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

  // The title needs no network, so it no longer waits for one.
  const header = (
    <PageHeader
      eyebrow="Class"
      title="Rankings"
      subtitle="Where you stand in your class on XP earned."
    />
  );

  if (loading) {
    return (
      <div className="space-y-5">
        {header}
        <PageSkeleton label="Loading rankings">
          <div className="flex gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 rounded-xl" />
            ))}
          </div>
          <SkeletonCard className="p-5 space-y-4">
            <Skeleton className="h-3 w-32" />
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-5 w-5 shrink-0" />
                <Skeleton className="w-9 h-9 rounded-full shrink-0" />
                <Skeleton className="h-4 flex-1 max-w-[180px]" />
                <Skeleton className="h-2 flex-1" />
                <Skeleton className="h-4 w-12 shrink-0" />
              </div>
            ))}
          </SkeletonCard>
        </PageSkeleton>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-5">
        {header}
        <StudentErrorState
          title="Could not load the rankings"
          message={error}
          onRetry={() => {
            // Clear first: useInitialLoadGate suppresses the spinner on a
            // same-subject refetch, so without this the student presses Try
            // again and the unchanged error screen just sits there.
            setError(null);
            setReloadNonce((n) => n + 1);
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}
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
        <SectionLabel>Class XP</SectionLabel>
        {ranked.length === 0 && (
          <EmptyState
            variant="section"
            icon={<Trophy className="w-5 h-5" />}
            title="No class rankings yet"
            sub="Earn XP from practice, homework and battles to appear here."
          />
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
                  <ProgressBar value={Math.round((p.value / maxXp) * 100)} color="hsl(var(--primary))" height="h-1" />
                  <span className="text-[11px] text-muted-foreground shrink-0 capitalize">
                    Lv.{p.level} · {p.league}
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
