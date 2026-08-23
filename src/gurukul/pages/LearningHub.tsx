import type { PageKey } from "@/gurukul/nav";
import { useGurukulStudent } from "@/gurukul/StudentContext";
import { GlassCard, ProgressBar, cn } from "@/gurukul/components/shared";
import {
  BarChart2, RefreshCw, RotateCcw, AlertCircle,
  ArrowRight, TrendingUp, CheckCircle2, Loader2,
} from "lucide-react";
import { LineChart, Line, XAxis, ResponsiveContainer, Tooltip } from "recharts";
import { useMemo } from "react";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";

type Props = { setPage: (p: PageKey) => void };

const SUBJECT_COLORS: Record<string, string> = {
  Mathematics: "#3b5bdb",
  Math: "#3b5bdb",
  Physics: "#4b9fd4",
  Chemistry: "#6882e8",
  Biology: "#4aa87a",
  English: "#c08a3a",
  Hindi: "#cc5069",
  Science: "#4b9fd4",
  "Social Science": "#c08a3a",
};
const FALLBACK_COLORS = ["#3b5bdb", "#4b9fd4", "#6882e8", "#4aa87a", "#c08a3a"];

function subjectColor(name: string, index: number) {
  return SUBJECT_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

export default function LearningHub({ setPage }: Props) {
  const student = useGurukulStudent();
  const { data: snapshot, loading: snapLoading, error: snapError, reload: reloadSnap } = useStudentAcademicSnapshot();
  const { data: charts, loading: chartsLoading, error: chartsError, reload: reloadCharts } = useStudentPerformanceCharts();

  const loading = snapLoading || chartsLoading;
  const loadError = snapError || chartsError;

  const pendingRecovery = snapshot?.recovery_pending ?? 0;
  const dueRevision = snapshot?.revision_queue?.length ?? 0;
  const unresolvedErrors = snapshot?.mistake_count ?? 0;

  const chartSubjects = charts?.subjects ?? [];
  // Same SSOT as Home/Practice/Analysis/Nova/Battleground â€” shell profile (snapshot accuracy).
  const overallAccuracy = Math.round(student.accuracy);

  const accuracyTrend = useMemo(() => {
    const trend = charts?.practice_trend ?? [];
    if (trend.length > 0) {
      return trend.map((p) => ({
        week: new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        score: Math.round(p.score_pct),
      }));
    }
    // No practice_trend â€” do not invent a flat overall-accuracy line on activity days.
    return [] as { week: string; score: number }[];
  }, [charts?.practice_trend]);

  const trendDelta = accuracyTrend.length >= 2
    ? accuracyTrend[accuracyTrend.length - 1].score - accuracyTrend[0].score
    : 0;
  const latestScore = accuracyTrend.length > 0
    ? accuracyTrend[accuracyTrend.length - 1].score
    : overallAccuracy;

  const subjects = useMemo(
    () =>
      chartSubjects.map((s, i) => ({
        id: s.name,
        name: s.name,
        color: subjectColor(s.name, i),
        icon: s.name.charAt(0).toUpperCase(),
        trend: 0,
        accuracy: Math.round(s.accuracy),
      })),
    [chartSubjects],
  );

  const features = useMemo(
    () => [
      {
        key: "analysis" as PageKey,
        label: "Analysis",
        sub: "See how you're doing across all subjects",
        icon: <BarChart2 className="w-6 h-6"/>,
        color: "#4b9fd4",
        glow: "shadow-[0_0_32px_rgba(34,211,238,0.07)]",
        stat: `${overallAccuracy}% accuracy`,
        statSub: "overall",
      },
      {
        key: "recovery" as PageKey,
        label: "Recovery",
        sub: "Fix mistakes from past practice sessions",
        icon: <RefreshCw className="w-6 h-6"/>,
        color: "#cc5069",
        glow: "shadow-[0_0_32px_rgba(244,63,94,0.07)]",
        stat: `${pendingRecovery} pending`,
        statSub: "to recover",
      },
      {
        key: "revision" as PageKey,
        label: "Revision",
        sub: "Spaced-repetition review for long-term memory",
        icon: <RotateCcw className="w-6 h-6"/>,
        color: "#6882e8",
        glow: "shadow-[0_0_32px_rgba(167,139,250,0.07)]",
        stat: `${dueRevision} in queue`,
        statSub: "items",
      },
      {
        key: "mistakebook" as PageKey,
        label: "Mistake Book",
        sub: "A log of every error â€” your growth blueprint",
        icon: <AlertCircle className="w-6 h-6"/>,
        color: "#c08a3a",
        glow: "shadow-[0_0_32px_rgba(245,158,11,0.07)]",
        stat: `${unresolvedErrors} logged`,
        statSub: "mistakes",
      },
    ],
    [overallAccuracy, pendingRecovery, dueRevision, unresolvedErrors],
  );

  const loopSteps = useMemo(() => {
    const recoveryPending = pendingRecovery;
    const revisionPending = dueRevision;
    const mistakesLogged = unresolvedErrors > 0;
    const practiceDone = (snapshot?.self_practice?.sessions_completed ?? 0) > 0;
    const analysisDone = practiceDone;
    const mistakebookDone = mistakesLogged;
    const recoveryDone = recoveryPending === 0 && mistakebookDone;
    const revisionActive = recoveryDone && revisionPending > 0;
    const recoveryActive = recoveryPending > 0;

    return [
      { label: "Practice", color: "#3b5bdb", done: practiceDone, active: false },
      { label: "Analyse", color: "#4b9fd4", done: analysisDone, active: false },
      { label: "Mistake Book", color: "#c08a3a", done: mistakebookDone, active: false },
      { label: "Recover", color: "#cc5069", done: recoveryDone, active: recoveryActive },
      { label: "Revise", color: "#6882e8", done: revisionPending === 0 && recoveryDone, active: revisionActive },
    ];
  }, [pendingRecovery, dueRevision, unresolvedErrors, snapshot?.self_practice?.sessions_completed]);

  if (loading && !snapshot && !charts) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading learning hubâ€¦
      </div>
    );
  }

  if (loadError && !snapshot && !charts) {
    return (
      <div className="rounded-2xl border border-[#cc5069]/25 bg-[#cc5069]/08 p-6 text-center space-y-3">
        <p className="text-sm font-semibold text-foreground">Could not load learning data</p>
        <p className="text-xs text-muted-foreground">{loadError}</p>
        <button type="button" onClick={() => { void reloadSnap(); void reloadCharts(); }} className="text-xs font-bold text-[#3b5bdb] hover:underline">Try again</button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {loadError && (
        <div className="rounded-xl border border-[#c08a3a]/30 bg-[#c08a3a]/10 px-4 py-2 text-xs text-[#c08a3a]">Some live stats failed to refresh: {loadError}</div>
      )}
      {/* Header */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">Student Panel</div>
        <h1 className="text-3xl font-black text-foreground" style={{fontFamily:"var(--font-display)"}}>
          Learning
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Practice â†’ Analyse â†’ Recover â†’ Revise. Your complete growth loop.
        </p>
      </div>

      {/* Quick stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:"Overall Accuracy", value:`${overallAccuracy}%`,  color:"#4b9fd4" },
          { label:"To Recover",       value:pendingRecovery,        color:"#cc5069" },
          { label:"Due for Revision", value:dueRevision,            color:"#6882e8" },
          { label:"Unresolved",       value:unresolvedErrors,       color:"#c08a3a" },
        ].map(s => (
          <GlassCard key={s.label} className="p-4 text-center">
            <div className="text-2xl font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{s.label}</div>
          </GlassCard>
        ))}
      </div>

      {/* Feature cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map(f => (
          <button key={f.key} onClick={() => setPage(f.key)}
            className={cn(
              "group text-left p-5 rounded-2xl border border-border/70 bg-surface/90 transition-all duration-200",
              "hover:border-border hover:scale-[1.02]",
              f.glow
            )}>
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                style={{background:`${f.color}15`,color:f.color}}>
                {f.icon}
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all"/>
            </div>
            <div className="text-base font-black text-foreground mb-1" style={{fontFamily:"var(--font-display)"}}>{f.label}</div>
            <div className="text-xs text-muted-foreground leading-relaxed mb-4">{f.sub}</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-black tabular-nums" style={{color:f.color}}>{f.stat}</span>
              <span className="text-[11px] text-muted-foreground">{f.statSub}</span>
            </div>
          </button>
        ))}
      </div>

      {/* Accuracy trend + subject breakdown side by side */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Trend */}
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-1 h-4 rounded-full bg-[#4b9fd4]"/>
            <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Accuracy Trend</span>
          </div>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-2xl font-black text-foreground">{latestScore}%</span>
            {accuracyTrend.length >= 2 && (
              <span className={cn(
                "flex items-center gap-1 text-xs font-semibold",
                trendDelta >= 0 ? "text-emerald-400" : "text-destructive",
              )}>
                <TrendingUp className={cn("w-3.5 h-3.5", trendDelta < 0 && "rotate-180")}/>
                {trendDelta >= 0 ? "+" : ""}{trendDelta}% since start
              </span>
            )}
          </div>
          {accuracyTrend.length > 0 ? (
            <div className="h-32">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={accuracyTrend}>
                  <XAxis dataKey="week" tick={{fill:"hsl(var(--muted-foreground))",fontSize:10}} axisLine={false} tickLine={false}/>
                  <Tooltip contentStyle={{background:"#131316",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,fontSize:12}}/>
                  <Line type="monotone" dataKey="score" name="Accuracy" stroke="#4b9fd4" strokeWidth={2.5}
                    isAnimationActive={false} dot={{r:3,fill:"#4b9fd4",strokeWidth:0}} activeDot={{r:5}}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">No trend data yet â€” practice to build your chart.</p>
          )}
        </GlassCard>

        {/* Subject mastery rings */}
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-[#3b5bdb]"/>
            <span className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Subject Accuracy</span>
          </div>
          {subjects.length > 0 ? (
            <div className="space-y-3">
              {subjects.map(s => (
                <div key={s.id} className="flex items-center gap-3">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center text-xs font-bold shrink-0"
                    style={{background:`${s.color}15`,color:s.color}}>{s.icon}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between mb-1">
                      <span className="text-xs font-semibold text-foreground">{s.name}</span>
                      <span className="text-xs font-black tabular-nums" style={{color:s.color}}>{s.accuracy}%</span>
                    </div>
                    <ProgressBar value={s.accuracy} color={s.color} height="h-1.5"/>
                  </div>
                  {s.trend !== 0 && (
                    <div className="flex items-center gap-1 text-[10px] shrink-0"
                      style={{color:s.trend>=0?"#4aa87a":"#cc5069"}}>
                      <TrendingUp className={cn("w-3 h-3", s.trend<0&&"rotate-180")}/>
                      {s.trend>0?"+":""}{s.trend}%
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">No subject data yet.</p>
          )}
        </GlassCard>
      </div>

      {/* Learning loop reminder */}
      <GlassCard className="p-5 border-dashed border-border">
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
          {loopSteps.map((step, i, arr) => (
            <span key={step.label} className="flex items-center gap-2">
              <span className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-full border font-semibold transition-all",
                step.active ? "scale-105" : ""
              )} style={{
                borderColor:`${step.color}${step.done||step.active?"40":"18"}`,
                background:`${step.color}${step.done||step.active?"12":"06"}`,
                color:step.done||step.active?step.color:"#46465a",
              }}>
                {step.done && <CheckCircle2 className="w-3 h-3"/>}
                {step.active && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{background:step.color}}/>}
                {step.label}
              </span>
              {i < arr.length-1 && <span className="text-muted-foreground/30">â†’</span>}
            </span>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
