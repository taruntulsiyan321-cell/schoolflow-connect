import type { PageKey } from "@/gurukul/nav";
import { useGurukulStudent, useGurukulShellReady } from "@/gurukul/StudentContext";
import { EmptyState, GlassCard, LoadingState, ProgressBar, SectionLabel, StatTile, XPBar } from "@/gurukul/components/shared";
import {
  ArrowRight, Flame, BookOpen, Brain, RefreshCw, RotateCcw,
  BarChart2, Trophy, Swords, Star
} from "lucide-react";
import { AreaChart, Area, XAxis, ResponsiveContainer, Tooltip } from "recharts";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { withAlpha } from "@/lib/colorAlpha";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { pluralise } from "@/lib/plural";

function mapWeeklyActivity(dates: { date: string; total: number }[]) {
  return dates.map((row) => ({
    day: new Date(row.date).toLocaleDateString(undefined, { weekday: "short" }),
    total: row.total,
  }));
}

function localDateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Today's self-practice count from heatmap - not lifetime sessions_completed. */
function practiceSessionsToday(snapshot: ReturnType<typeof useStudentAcademicSnapshot>["data"]) {
  const key = localDateKey();
  const row = (snapshot?.activity_heatmap ?? []).find((r) => String(r.date).slice(0, 10) === key);
  return row?.self_practice ?? 0;
}

function timeOfDayGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

function buildMission(snapshot: ReturnType<typeof useStudentAcademicSnapshot>["data"]) {
  const practiceLifetime = snapshot?.self_practice?.sessions_completed ?? 0;
  const practiceToday = practiceSessionsToday(snapshot);
  const recoveryPending = snapshot?.recovery_pending ?? 0;
  const revisionPending = snapshot?.revision_queue?.length ?? 0;
  const homeworkPending = snapshot?.homework?.pending ?? 0;

  const practiceDone = Math.min(practiceToday, PRACTICE_TARGET);
  const recoveryTarget = recoveryPending > 0 ? Math.max(recoveryPending, 1) : 1;
  const recoveryDone = recoveryPending === 0 ? 1 : Math.max(0, recoveryTarget - recoveryPending);
  const revisionTarget = revisionPending > 0 ? Math.max(revisionPending, 1) : 1;
  const revisionDone = revisionPending === 0 ? 1 : Math.max(0, revisionTarget - revisionPending);

  let nextAction: { label: string; reason: string; page: PageKey };
  if (recoveryPending > 0) {
    nextAction = {
      label: "Complete recovery session",
      reason: `${recoveryPending} mistake${recoveryPending === 1 ? "" : "s"} waiting to recover`,
      page: "recovery",
    };
  } else if (revisionPending > 0) {
    nextAction = {
      label: "Review revision queue",
      reason: `${revisionPending} topic${revisionPending === 1 ? "" : "s"} due for revision`,
      page: "revision",
    };
  } else if (homeworkPending > 0) {
    nextAction = {
      label: "Finish pending homework",
      reason: `${homeworkPending} assignment${homeworkPending === 1 ? "" : "s"} still open`,
      page: "assignments",
    };
  } else {
    nextAction = {
      label: practiceToday > 0 ? "Keep practicing" : "Start a practice session",
      reason: practiceToday > 0 ? "Daily practice done - another session builds mastery" : "Build your daily practice habit",
      page: "practice",
    };
  }

  return {
    practiceDone,
    practiceTarget: PRACTICE_TARGET,
    recoveryDone,
    recoveryTarget,
    revisionDone,
    revisionTarget,
    nextAction,
    recoveryPending,
    revisionPending,
    practiceSessions: practiceLifetime,
    practiceToday,
    mistakesLogged: snapshot?.mistake_count ?? 0,
  };
}

const PRACTICE_TARGET = 1;

function WeeklyRing({ sessions }: { sessions: number }) {
  const goal = 7;
  const pct = Math.min(sessions / goal, 1);
  const size = 120;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - pct * c;
  // Complete colours, all three rungs. This ternary was the whole G4 bug in one
  // line: two triplet tokens and one `--color-*` (already `hsl(...)`), then
  // `hsl()` wrapped around every branch. The ring drew correctly at and above
  // target and vanished below it — the one case the student needs to see.
  const colorVar = pct >= 0.85 ? "hsl(var(--info))" : pct >= 0.57 ? "hsl(var(--warning))" : "var(--color-chemistry)";
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={colorVar} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 8px ${colorVar})`, transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black tabular-nums" style={{ color: colorVar }}>{sessions}</span>
        <span className="text-[10px] text-muted-foreground">/ {goal}</span>
      </div>
    </div>
  );
}

export default function Dashboard({ setPage }: { setPage: (p: PageKey) => void }) {
  const student = useGurukulStudent();
  const shellReady = useGurukulShellReady();
  const { user } = useAuth();
  const { data: snapshot, loading: snapLoading, error: snapError, reload: reloadSnap } = useStudentAcademicSnapshot();
  const { data: charts, loading: chartsLoading, error: chartsError, reload: reloadCharts } = useStudentPerformanceCharts();

  const loading = snapLoading || chartsLoading;
  const loadError = snapError || chartsError;
  const hasLiveData = Boolean(snapshot || charts);
  const initialLoading = loading && !hasLiveData;
  const toastedError = useRef<string | null>(null);

  useEffect(() => {
    if (!loadError) {
      toastedError.current = null;
      return;
    }
    if (toastedError.current === loadError) return;
    toastedError.current = loadError;
    toast.error(loadError);
  }, [loadError]);

  const mission = useMemo(() => buildMission(snapshot), [snapshot]);

  const weeklyActivity = useMemo(
    () => mapWeeklyActivity(charts?.weekly_activity ?? []),
    [charts?.weekly_activity],
  );

  const goalLine = student.goal ? ` · Goal: ${student.goal}` : "";
  const levelLabel = shellReady ? `Lv.${student.level}` : "—";
  const streakLabel = shellReady ? `${student.streak}-day streak` : "…";

  if (initialLoading) {
    return (
      <LoadingState label="Loading home…" />
    );
  }

  if (loadError && !hasLiveData) {
    return (
      <div className="rounded-2xl border border-destructive/25 bg-destructive/8 p-6 text-center space-y-3">
        <p className="text-sm font-semibold text-foreground">Could not load home data</p>
        <p className="text-xs text-muted-foreground">{loadError}</p>
        <button
          type="button"
          onClick={() => { void reloadSnap(); void reloadCharts(); }}
          className="text-xs font-bold text-primary hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 premium-page">
      {loadError && (
        <div className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-2 text-xs text-warning">
          Some live stats failed to refresh: {loadError}
        </div>
      )}
      {/* Hero - premium light with subtle orbs */}
      <GlassCard glow="blue" className="p-6 sm:p-8 premium-card relative overflow-hidden">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{timeOfDayGreeting()}</span>
              <div className="flex items-center gap-1 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5">
                <Flame className="w-3 h-3 text-amber-400"/><span className="text-[10px] font-bold text-amber-400">{streakLabel}</span>
              </div>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-foreground leading-tight" style={{fontFamily:"var(--font-display)"}}>
              {student.firstName}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">{student.class || (shellReady ? "—" : "…")}{goalLine}</p>
            <div className="grid grid-cols-3 gap-3 mt-4">
              <StatTile label="Practice accuracy" value={shellReady ? `${student.accuracy}%` : "—"} color="hsl(var(--info))"/>
              <StatTile label="Class Rank" value={shellReady && student.rank > 0 ? `#${student.rank}` : "—"} color="hsl(var(--warning))"/>
              <StatTile label="Level" value={levelLabel} color="var(--color-chemistry)"/>
            </div>
            <div className="mt-3">
              <XPBar
                xp={shellReady ? student.xp : 0}
                level={shellReady ? student.level : 1}
                xpIntoLevel={shellReady ? student.xpIntoLevel : 0}
                xpToNext={shellReady ? student.xpToNext : 100}
                progressPct={shellReady ? student.levelProgressPct : 0}
              />
            </div>
          </div>
          <div className="flex flex-col items-center shrink-0">
            <WeeklyRing sessions={shellReady ? student.sessionsThisWeek : 0}/>
            <span className="text-[11px] text-muted-foreground uppercase tracking-widest mt-2">Sessions / Week</span>
          </div>
        </div>
      </GlassCard>

      {/* What to do next - premium hover */}
      <GlassCard glow="cyan" className="p-5 premium-card cursor-pointer" onClick={() => setPage(mission.nextAction.page)}>
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-info/10 border border-info/20 flex items-center justify-center shrink-0">
            <RefreshCw className="w-5 h-5 text-info"/>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.15em] text-info mb-0.5">What should you do next?</div>
            <div className="text-base font-bold text-foreground">{mission.nextAction.label}</div>
            <div className="text-sm text-muted-foreground mt-0.5">{mission.nextAction.reason}</div>
          </div>
          <ArrowRight className="w-5 h-5 text-info shrink-0 mt-0.5"/>
        </div>
      </GlassCard>

      {/* A "Your Learning Loop" card stood here. Removed 2026-09-11 on the
          product owner's ruling: the loop is MARKETING and reference material —
          it explains why and how the product operates — and is not a student
          surface. A student is shown what to do next, not a diagram of the
          method. Today's Mission below is that. */}

      {/* Today's Mission - premium stagger */}
      <div className="animate-premium-enter" style={{animationDelay: "0.08s"}}>
        <SectionLabel>{"Today's Mission"}</SectionLabel>
        <div className="grid sm:grid-cols-3 gap-4 animate-premium-stagger">
          {[
            { label: "Practice", done: mission.practiceDone, target: mission.practiceTarget, color: "hsl(var(--primary))", icon: <BookOpen className="w-4 h-4"/>, page: "practice" as PageKey },
            { label: "Recovery", done: mission.recoveryDone, target: mission.recoveryTarget, color: "hsl(var(--accent))", icon: <RefreshCw className="w-4 h-4"/>, page: "recovery" as PageKey },
            { label: "Revision", done: mission.revisionDone, target: mission.revisionTarget, color: "var(--color-chemistry)", icon: <RotateCcw className="w-4 h-4"/>, page: "revision" as PageKey },
          ].map((m) => (
            <GlassCard key={m.label} className="p-4 cursor-pointer hover:border-border" onClick={() => setPage(m.page)}>
              <div className="flex items-center gap-2 mb-2">
                <span style={{ color: m.color }}>{m.icon}</span>
                <span className="text-xs font-semibold text-foreground">{m.label}</span>
              </div>
              <div className="text-2xl font-black tabular-nums mb-1" style={{ color: m.color }}>
                {m.done}<span className="text-sm text-muted-foreground font-normal">/{m.target}</span>
              </div>
              <ProgressBar value={m.done} max={m.target} color={m.color}/>
            </GlassCard>
          ))}
        </div>
      </div>

      {/* Quick Actions - premium stagger */}
      <div className="animate-premium-enter" style={{animationDelay: "0.16s"}}>
        <SectionLabel>Quick Actions</SectionLabel>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 animate-premium-stagger">
          {[
            { label: "Practice", sub: "Start a session", icon: <BookOpen className="w-5 h-5"/>, color: "hsl(var(--primary))", page: "practice" as PageKey },
            { label: "AI Coach", sub: "Chat with Nova", icon: <Brain className="w-5 h-5"/>, color: "var(--color-chemistry)", page: "aicoach" as PageKey },
            { label: "Battleground", sub: "Challenge classmates", icon: <Swords className="w-5 h-5"/>, color: "hsl(var(--warning))", page: "battleground" as PageKey },
            { label: "Analysis", sub: "View insights", icon: <BarChart2 className="w-5 h-5"/>, color: "var(--color-physics)", page: "analysis" as PageKey },
          ].map((a) => (
            <GlassCard key={a.label} className="p-4 cursor-pointer hover:border-border group" onClick={() => setPage(a.page)}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3 transition-transform group-hover:scale-110" style={{ background: withAlpha(a.color, 0.1), color: a.color }}>
                {a.icon}
              </div>
              <div className="text-sm font-semibold text-foreground">{a.label}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{a.sub}</div>
            </GlassCard>
          ))}
        </div>
      </div>

      {/* Weekly Activity */}
      <GlassCard className="p-5">
        <SectionLabel>Weekly Activity</SectionLabel>
        {weeklyActivity.length > 0 ? (
          <div className="h-36 animate-premium-enter">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyActivity}>
                <defs>
                  <linearGradient id="dash-actGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,0.07)" }} labelStyle={{ color: "hsl(var(--muted-foreground))" }} />
                <Area type="monotone" dataKey="total" name="Questions" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#dash-actGrad)"
                  isAnimationActive={true} animationDuration={800} dot={{ r: 3, fill: "hsl(var(--primary))", strokeWidth: 0 }} activeDot={{ r: 5, fill: "hsl(var(--primary))" }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState
            variant="section"
            icon={<BarChart2 className="w-5 h-5" />}
            title="No activity yet"
            sub="Complete practice to see your weekly trend."
          />
        )}
      </GlassCard>

      {/* Bottom row — Recent Achievements came off (achievements live on the
          profile only), so the leaderboard stands alone rather than in a
          two-column grid with a hole in it. */}
      <div className="grid gap-4">
        <GlassCard glow="purple" className="p-5">
          <SectionLabel>Class Leaderboard</SectionLabel>
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, hsl(var(--warning) / 0.2), hsl(var(--warning) / 0.05))", border: "1px solid hsl(var(--warning) / 0.3)" }}>
              <Trophy className="w-7 h-7 text-amber-400"/>
            </div>
            <div className="text-4xl font-black text-foreground" style={{fontFamily:"var(--font-display)"}}>
              {shellReady && student.rank > 0 ? `#${student.rank}` : "—"}
            </div>
            <div className="text-muted-foreground text-sm">
              {shellReady && student.totalStudents > 0
                ? `of ${student.totalStudents} students`
                : shellReady
                  ? "Not ranked yet"
                  : "Loading rank…"}
            </div>
            {shellReady && student.rank > 0 && (
              <div className="flex items-center gap-1.5 text-emerald-400 text-sm font-semibold">
                <Star className="w-4 h-4"/>Class rank
              </div>
            )}
            <button onClick={() => setPage("leaderboard")} className="w-full text-center text-xs text-primary hover:text-primary/80 transition-colors mt-2">
              See full leaderboard {"→"}
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}