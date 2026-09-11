import type { PageKey } from "@/gurukul/nav";
import { useGurukulStudent } from "@/gurukul/StudentContext";
import { GlassCard, LoadingState, PageHeader, cn } from "@/gurukul/components/shared";
import {
  BarChart2, RefreshCw, RotateCcw, AlertCircle, ArrowRight
} from "lucide-react";
import { LineChart, Line, XAxis, ResponsiveContainer, Tooltip } from "recharts";
import { useMemo } from "react";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";

type Props = { setPage: (p: PageKey) => void };

export default function LearningHub({ setPage }: Props) {
  const student = useGurukulStudent();
  const { data: snapshot, loading: snapLoading, error: snapError, reload: reloadSnap } = useStudentAcademicSnapshot();
  const { data: charts, loading: chartsLoading, error: chartsError, reload: reloadCharts } = useStudentPerformanceCharts();

  const loading = snapLoading || chartsLoading;
  const loadError = snapError || chartsError;

  const pendingRecovery = snapshot?.recovery_pending ?? 0;
  const dueRevision = snapshot?.revision_queue?.length ?? 0;
  const unresolvedErrors = snapshot?.mistake_count ?? 0;

  // PRACTICE accuracy — the shell profile carries nothing else. This was
  // labelled "Overall Accuracy" over the identical value Home called "Practice
  // accuracy"; the profile field is named for what it holds now, which is what
  // settled it. null when nothing has been attempted (ruling 8).
  const practiceAccuracy = student.practiceAccuracy;

  const features = useMemo(
    () => [
      {
        key: "analysis" as PageKey,
        label: "Analysis",
        sub: "See how you're doing across all subjects",
        icon: <BarChart2 className="w-6 h-6"/>,
        color: "#4b9fd4",
        glow: "shadow-[0_0_32px_rgba(34,211,238,0.07)]",
        stat: practiceAccuracy == null ? "No practice yet" : `${practiceAccuracy}% accuracy`,
        statSub: "practice",
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
        sub: "A log of every error — your growth blueprint",
        icon: <AlertCircle className="w-6 h-6"/>,
        color: "#c08a3a",
        glow: "shadow-[0_0_32px_rgba(245,158,11,0.07)]",
        stat: `${unresolvedErrors} logged`,
        statSub: "mistakes",
      },
    ],
    [practiceAccuracy, pendingRecovery, dueRevision, unresolvedErrors],
  );


  if (loading && !snapshot && !charts) {
    return (
      <LoadingState label="Loading learning hub…" />
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
      {/* No subtitle: it recited the loop — "Practice → Analyse → Recover →
          Revise. Your complete growth loop." That is the marketing line for how
          the product works, not something a student needs read back to them on
          the page that already contains the four things. Removed 2026-09-11
          with the loop strip below it. */}
      <PageHeader title="Learning" />

      {/* Quick stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:"Practice Accuracy", value:practiceAccuracy == null ? "—" : `${practiceAccuracy}%`, color:"#4b9fd4" },
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

      {/* A "Learning loop reminder" strip stood here — five chips ending in
          Mistake Book, with its colours as raw hex literals. Removed
          2026-09-11: the loop is marketing and reference material, not a
          student surface. The four cards above ARE the loop; restating it
          underneath told the student nothing they could act on. */}
    </div>
  );
}
