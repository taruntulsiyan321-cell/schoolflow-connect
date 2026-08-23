import type { PageKey } from "@/gurukul/nav";
import { useGurukulStudent, useGurukulShellReady } from "@/gurukul/StudentContext";
import { GlassCard, SectionLabel, StatTile, XPBar, ProgressBar, cn } from "@/gurukul/components/shared";
import {
  ArrowRight, Flame, BookOpen, Brain,
  RefreshCw, RotateCcw, BarChart2, Trophy, CheckCircle2,
  TrendingUp, AlertTriangle, Swords, Star, Loader2,
} from "lucide-react";
import { AreaChart, Area, XAxis, ResponsiveContainer, Tooltip } from "recharts";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { useStudentBadges } from "@/hooks/useStudentBadges";
import { getBadge } from "@/lib/badges";
import { dedupeSubjectChartPoints } from "@/lib/qualityGuards";
import { displaySubject } from "@/lib/academicDisplay";

const SUBJECT_COLOR_VARS: Record<string, string> = {
  Mathematics: "var(--primary)",
  Math: "var(--primary)",
  Physics: "var(--color-physics)",
  Chemistry: "var(--color-chemistry)",
  Biology: "var(--success)",
  English: "var(--warning)",
  Hindi: "var(--accent)",
  Science: "var(--color-physics)",
  "Social Science": "var(--warning)",
};
const FALLBACK_COLOR_VARS = ["var(--primary)", "var(--color-physics)", "var(--color-chemistry)", "var(--success)", "var(--warning)"];

function subjectColorVar(name: string, index: number): string {
  return SUBJECT_COLOR_VARS[name] ?? FALLBACK_COLOR_VARS[index % FALLBACK_COLOR_VARS.length];
}

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
  const colorVar = pct >= 0.85 ? "var(--info)" : pct >= 0.57 ? "var(--warning)" : "var(--color-chemistry)";
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="hsl(var(--border))" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={`hsl(${colorVar})`} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 8px hsl(${colorVar}))`, transition: "stroke-dashoffset 1s ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black tabular-nums" style={{ color: `hsl(${colorVar})` }}>{sessions}</span>
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
  const { earned } = useStudentBadges(user?.id);

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

  const loopSteps = useMemo(() => {
    const practiceDone = mission.practiceSessions > 0;
    const analysisDone = practiceDone;
    const mistakebookDone = mission.mistakesLogged > 0;
    const recoveryDone = mission.recoveryPending === 0 && mistakebookDone;
    const revisionDone = mission.revisionPending === 0 && recoveryDone;
    const activeKey = mission.nextAction.page === "assignments" ? "practice" : mission.nextAction.page;

    const steps = [
      { key: "practice", label: "Practice", icon: <BookOpen className="w-3.5 h-3.5" />, color: "var(--primary)", done: practiceDone },
      { key: "analysis", label: "Analyse", icon: <BarChart2 className="w-3.5 h-3.5" />, color: "var(--color-physics)", done: analysisDone },
      { key: "mistakebook", label: "Weakness", icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "var(--warning)", done: mistakebookDone },
      { key: "recovery", label: "Recover", icon: <RefreshCw className="w-3.5 h-3.5" />, color: "var(--accent)", done: recoveryDone },
      { key: "revision", label: "Revise", icon: <RotateCcw className="w-3.5 h-3.5" />, color: "var(--color-chemistry)", done: revisionDone },
      { key: "aicoach", label: "Coach", icon: <Brain className="w-3.5 h-3.5" />, color: "var(--success)", done: false },
    ];

    return steps.map((step) => ({
      ...step,
      active: step.key === activeKey && !step.done,
    }));
  }, [mission]);

  const weeklyActivity = useMemo(
    () => mapWeeklyActivity(charts?.weekly_activity ?? []),
    [charts?.weekly_activity],
  );

  // One tile per canonical subject (Maths = Mathematics); drop generic placeholders.
  const subjects = useMemo(() => {
    return dedupeSubjectChartPoints(charts?.subjects ?? []).map((agg, i) => {
      const name = displaySubject(agg.name) || agg.name;
      return {
        id: name,
        name,
        color: subjectColorVar(name, i),
        icon: name.charAt(0).toUpperCase(),
        trend: 0,
        attempts: agg.attempts,
        accuracy: Math.round(agg.accuracy),
      };
    });
  }, [charts?.subjects]);

  const recentAch = useMemo(
    () =>
      earned.slice(0, 2).map((b) => {
        const meta = getBadge(b.badge_code);
        return {
          id: b.badge_code,
          title: meta?.label ?? b.badge_code,
          desc: meta?.desc ?? "",
          Icon: meta?.icon,
          tier: b.tier,
        };
      }),
    [earned],
  );

  const goalLine = student.goal ? ` · Goal: ${student.goal}` : "";
  const levelLabel = shellReady ? `Lv.${student.level}` : "—";
  const streakLabel = shellReady ? `${student.streak}-day streak` : "…";

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading home…
      </div>
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
              <StatTile label="Practice accuracy" value={shellReady ? `${student.accuracy}%` : "—"} color="var(--info)"/>
              <StatTile label="Class Rank" value={shellReady && student.rank > 0 ? `#${student.rank}` : "—"} color="var(--warning)"/>
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

      {/* Learning Loop - premium */}
      <GlassCard className="p-5 premium-card animate-premium-enter" style={{animationDelay: "0.12s"}}>
        <SectionLabel>Your Learning Loop</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {loopSteps.map((step, i) => (
            <button key={step.key} onClick={() => setPage(step.key as PageKey)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all duration-200",
                step.active ? "scale-105" : step.done ? "opacity-80" : "opacity-40"
              )}
              style={step.done || step.active
                ? { borderColor: `hsl(${step.color} / 0.4)`, background: `hsl(${step.color} / 0.1)`, color: step.active ? `hsl(${step.color})` : "hsl(var(--muted-foreground))" }
                : { borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>
              <span style={{ color: step.active ? `hsl(${step.color})` : step.done ? `hsl(${step.color})` : "hsl(var(--muted-foreground))" }}>{step.icon}</span>
              {step.label}
              {step.done && !step.active && <CheckCircle2 className="w-3 h-3" style={{ color: `hsl(${step.color})` }} />}
              {step.active && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: `hsl(${step.color})` }} />}
              {i < loopSteps.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground/30 -mr-1"/>}
            </button>
          ))}
        </div>
      </GlassCard>

      {/* Today's Mission - premium stagger */}
      <div className="animate-premium-enter" style={{animationDelay: "0.08s"}}>
        <SectionLabel>{"Today's Mission"}</SectionLabel>
        <div className="grid sm:grid-cols-3 gap-4 animate-premium-stagger">
          {[
            { label: "Practice", done: mission.practiceDone, target: mission.practiceTarget, color: "var(--primary)", icon: <BookOpen className="w-4 h-4"/>, page: "practice" as PageKey },
            { label: "Recovery", done: mission.recoveryDone, target: mission.recoveryTarget, color: "var(--accent)", icon: <RefreshCw className="w-4 h-4"/>, page: "recovery" as PageKey },
            { label: "Revision", done: mission.revisionDone, target: mission.revisionTarget, color: "var(--color-chemistry)", icon: <RotateCcw className="w-4 h-4"/>, page: "revision" as PageKey },
          ].map((m) => (
            <GlassCard key={m.label} className="p-4 cursor-pointer hover:border-border" onClick={() => setPage(m.page)}>
              <div className="flex items-center gap-2 mb-2">
                <span style={{ color: `hsl(${m.color})` }}>{m.icon}</span>
                <span className="text-xs font-semibold text-foreground">{m.label}</span>
              </div>
              <div className="text-2xl font-black tabular-nums mb-1" style={{ color: `hsl(${m.color})` }}>
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
            { label: "Practice", sub: "Start a session", icon: <BookOpen className="w-5 h-5"/>, color: "var(--primary)", page: "practice" as PageKey },
            { label: "AI Coach", sub: "Chat with Nova", icon: <Brain className="w-5 h-5"/>, color: "var(--color-chemistry)", page: "aicoach" as PageKey },
            { label: "Battleground", sub: "Challenge classmates", icon: <Swords className="w-5 h-5"/>, color: "var(--warning)", page: "battleground" as PageKey },
            { label: "Analysis", sub: "View insights", icon: <BarChart2 className="w-5 h-5"/>, color: "var(--color-physics)", page: "analysis" as PageKey },
          ].map((a) => (
            <GlassCard key={a.label} className="p-4 cursor-pointer hover:border-border group" onClick={() => setPage(a.page)}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3 transition-transform group-hover:scale-110" style={{ background: `hsl(${a.color} / 0.1)`, color: `hsl(${a.color})` }}>
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
          <div className="premium-empty py-10">
            <div className="premium-empty-icon"><BarChart2 className="w-6 h-6" /></div>
            <p className="text-sm font-medium text-foreground">No activity yet</p>
            <p className="text-xs text-muted-foreground mt-1">Complete practice to see your weekly trend</p>
          </div>
        )}
      </GlassCard>

      {/* Subjects - premium stagger */}
      <div className="animate-premium-enter" style={{animationDelay: "0.20s"}}>
        <SectionLabel>Subject Performance</SectionLabel>
        {subjects.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 animate-premium-stagger">
            {subjects.map((s, idx) => (
              <GlassCard key={s.id} className="p-4 premium-card group hover:border-primary/30 cursor-pointer" onClick={() => setPage("practice")} style={{ animationDelay: `${idx * 0.04}s` }}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold shrink-0" style={{ background: `hsl(${s.color} / 0.1)`, color: `hsl(${s.color})` }}>{s.icon}</div>
                    <span className="text-sm font-semibold text-foreground">{s.name}</span>
                  </div>
                  {s.trend !== 0 && (
                    <div className="flex items-center gap-1 text-xs" style={{ color: s.trend >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))" }}>
                      <TrendingUp className={cn("w-3 h-3", s.trend < 0 && "rotate-180")} />
                      {s.trend > 0 ? "+" : ""}{s.trend}%
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted-foreground">{s.attempts} attempts</span>
                  <span className="text-sm font-black tabular-nums" style={{ color: `hsl(${s.color})` }}>{s.accuracy}%</span>
                </div>
                <ProgressBar value={s.accuracy} color={s.color} />
              </GlassCard>
            ))}
          </div>
        ) : (
          <div className="premium-empty py-10">
            <div className="premium-empty-icon"><BarChart2 className="w-6 h-6" /></div>
            <p className="text-sm font-medium text-foreground">No subject data yet</p>
            <p className="text-xs text-muted-foreground mt-1">Complete practice to see performance</p>
          </div>
        )}
      </div>

      {/* Bottom row */}
      <div className="grid sm:grid-cols-2 gap-4">
        <GlassCard glow="amber" className="p-5">
          <SectionLabel>Recent Achievements</SectionLabel>
          <div className="space-y-3">
            {recentAch.length > 0 ? recentAch.map((a) => (
              <div key={a.id} className="flex items-center gap-3 p-3 rounded-xl bg-amber-400/5 border border-amber-400/10">
                <div className="w-9 h-9 rounded-lg bg-amber-400/10 flex items-center justify-center shrink-0 text-amber-400">
                  {a.Icon ? <a.Icon className="w-5 h-5" /> : <Star className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-foreground">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.desc}</div>
                </div>
                <div className="flex items-center gap-1 text-amber-400 capitalize"><span className="text-xs font-bold">{a.tier}</span></div>
              </div>
            )) : (
              <p className="text-sm text-muted-foreground text-center py-4">No badges earned yet - keep practicing!</p>
            )}
            <button onClick={() => setPage("achievements")} className="w-full text-center text-xs text-primary hover:text-primary/80 transition-colors">
              View all achievements {"→"}
            </button>
          </div>
        </GlassCard>

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