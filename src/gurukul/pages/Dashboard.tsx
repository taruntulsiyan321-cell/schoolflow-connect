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

const SUBJECT_COLORS: Record<string, string> = {
  Mathematics: "#80cbd0",
  Math: "#80cbd0",
  Physics: "#2a7385",
  Chemistry: "#5b7b85",
  Biology: "#83cca5",
  English: "#e0b66c",
  Hindi: "#e08b86",
  Science: "#2a7385",
  "Social Science": "#e0b66c",
};
const FALLBACK_COLORS = ["#80cbd0", "#2a7385", "#5b7b85", "#83cca5", "#e0b66c"];

const PRACTICE_TARGET = 1;

function subjectColor(name: string, index: number) {
  return SUBJECT_COLORS[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
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

function WeeklyRing({ sessions }: { sessions: number }) {
  const goal=7, pct=Math.min(sessions/goal,1);
  const size=120, stroke=9, r=(size-stroke)/2, c=2*Math.PI*r;
  const offset=c-pct*c;
  const color=pct>=0.85?"#80cbd0":pct>=0.57?"#e0b66c":"#5b7b85";
  return (
    <div className="relative inline-flex" style={{width:size,height:size}}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#48656b" strokeOpacity="0.55" strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{transition:"stroke-dashoffset 1s ease"}}/>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black tabular-nums" style={{color}}>{sessions}</span>
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
        { key: "practice", label: "Practice", icon: <BookOpen className="w-3.5 h-3.5" />, color: "#80cbd0", done: practiceDone },
      { key: "analysis", label: "Analyse", icon: <BarChart2 className="w-3.5 h-3.5" />, color: "#2a7385", done: analysisDone },
      { key: "mistakebook", label: "Weakness", icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "#e0b66c", done: mistakebookDone },
      { key: "recovery", label: "Recover", icon: <RefreshCw className="w-3.5 h-3.5" />, color: "#e08b86", done: recoveryDone },
      { key: "revision", label: "Revise", icon: <RotateCcw className="w-3.5 h-3.5" />, color: "#5b7b85", done: revisionDone },
      { key: "aicoach", label: "Coach", icon: <Brain className="w-3.5 h-3.5" />, color: "#83cca5", done: false },
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
        color: subjectColor(name, i),
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
      <div className="rounded-2xl border border-[#cc5069]/25 bg-[#cc5069]/08 p-6 text-center space-y-3">
        <p className="text-sm font-semibold text-foreground">Could not load home data</p>
        <p className="text-xs text-muted-foreground">{loadError}</p>
        <button
          type="button"
          onClick={() => { void reloadSnap(); void reloadCharts(); }}
          className="text-xs font-bold text-[#3b5bdb] hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="rounded-xl border border-[#c08a3a]/30 bg-[#c08a3a]/10 px-4 py-2 text-xs text-[#c08a3a]">
          Some live stats failed to refresh: {loadError}
        </div>
      )}
      {/* Hero */}
      <GlassCard glow="blue" className="p-6 sm:p-8">
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
              <StatTile label="Practice accuracy" value={shellReady ? `${student.accuracy}%` : "—"} color="#4b9fd4"/>
              <StatTile label="Class Rank" value={shellReady && student.rank > 0 ? `#${student.rank}` : "—"} color="#c08a3a"/>
              <StatTile label="Level" value={levelLabel} color="#6882e8"/>
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

      {/* What to do next */}
      <GlassCard glow="cyan" className="p-5" onClick={() => setPage(mission.nextAction.page)}>
        <div className="flex items-start gap-4">
          <div className="w-10 h-10 rounded-xl bg-[#4b9fd4]/10 border border-[#4b9fd4]/20 flex items-center justify-center shrink-0">
            <RefreshCw className="w-5 h-5 text-[#4b9fd4]"/>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] uppercase tracking-[0.15em] text-[#4b9fd4] mb-0.5">What should you do next?</div>
            <div className="text-base font-bold text-foreground">{mission.nextAction.label}</div>
            <div className="text-sm text-muted-foreground mt-0.5">{mission.nextAction.reason}</div>
          </div>
          <ArrowRight className="w-5 h-5 text-[#4b9fd4] shrink-0 mt-0.5"/>
        </div>
      </GlassCard>

      {/* Learning Loop */}
      <GlassCard className="p-5">
        <SectionLabel>Your Learning Loop</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {loopSteps.map((step, i) => (
            <button key={step.key} onClick={() => setPage(step.key as PageKey)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all duration-200",
                step.active ? "scale-105" : step.done ? "opacity-80" : "opacity-40"
              )}
              style={step.done || step.active ? {borderColor:`${step.color}40`,background:`${step.color}10`,color:step.active?step.color:"#a0a0b0"} : {borderColor:"rgba(255,255,255,0.07)",color:"#78788c"}}>
              <span style={{color:step.active?step.color:step.done?step.color:"#78788c"}}>{step.icon}</span>
              {step.label}
              {step.done&&!step.active&&<CheckCircle2 className="w-3 h-3" style={{color:step.color}}/>}
              {step.active&&<span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{background:step.color}}/>}
              {i<loopSteps.length-1&&<ArrowRight className="w-3 h-3 text-muted-foreground/30 -mr-1"/>}
            </button>
          ))}
        </div>
      </GlassCard>

      {/* Today's Mission */}
      <div>
        <SectionLabel>{"Today's Mission"}</SectionLabel>
        <div className="grid sm:grid-cols-3 gap-4">
          {[
            {label:"Practice", done:mission.practiceDone, target:mission.practiceTarget, color:"#3b5bdb", icon:<BookOpen className="w-4 h-4"/>, page:"practice" as PageKey},
            {label:"Recovery", done:mission.recoveryDone, target:mission.recoveryTarget, color:"#cc5069", icon:<RefreshCw className="w-4 h-4"/>, page:"recovery" as PageKey},
            {label:"Revision", done:mission.revisionDone, target:mission.revisionTarget, color:"#6882e8", icon:<RotateCcw className="w-4 h-4"/>, page:"revision" as PageKey},
          ].map((m) => (
            <GlassCard key={m.label} className="p-4 cursor-pointer hover:border-black/15" onClick={() => setPage(m.page)}>
              <div className="flex items-center gap-2 mb-2">
                <span style={{color:m.color}}>{m.icon}</span>
                <span className="text-xs font-semibold text-foreground">{m.label}</span>
              </div>
              <div className="text-2xl font-black tabular-nums mb-1" style={{color:m.color}}>
                {m.done}<span className="text-sm text-muted-foreground font-normal">/{m.target}</span>
              </div>
              <ProgressBar value={m.done} max={m.target} color={m.color}/>
            </GlassCard>
          ))}
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <SectionLabel>Quick Actions</SectionLabel>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {label:"Practice",    sub:"Start a session",       icon:<BookOpen className="w-5 h-5"/>,  color:"#3b5bdb", page:"practice" as PageKey},
            {label:"AI Coach",    sub:"Chat with Nova",        icon:<Brain className="w-5 h-5"/>,    color:"#6882e8", page:"aicoach" as PageKey},
            {label:"Battleground",sub:"Challenge classmates",  icon:<Swords className="w-5 h-5"/>,   color:"#c08a3a", page:"battleground" as PageKey},
            {label:"Analysis",    sub:"View insights",       icon:<BarChart2 className="w-5 h-5"/>,color:"#4b9fd4", page:"analysis" as PageKey},
          ].map((a) => (
            <GlassCard key={a.label} className="p-4 cursor-pointer hover:border-black/20 group" onClick={() => setPage(a.page)}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3 transition-transform group-hover:scale-110" style={{background:`${a.color}15`,color:a.color}}>
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
          <div className="h-36">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={weeklyActivity}>
                <XAxis dataKey="day" tick={{fill:"#78788c",fontSize:10}} axisLine={false} tickLine={false}/>
                <Tooltip contentStyle={{background:"#131316",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,fontSize:12}} labelStyle={{color:"#78788c"}}/>
                <Area type="monotone" dataKey="total" name="Questions" stroke="#3b5bdb" strokeWidth={2} fill="#3b5bdb" fillOpacity={0.15}
                  isAnimationActive={false} dot={{r:3,fill:"#3b5bdb",strokeWidth:0}} activeDot={{r:5,fill:"#3b5bdb"}}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">No activity recorded this week yet.</p>
        )}
      </GlassCard>

      {/* Subjects */}
      <div>
        <SectionLabel>Subject Performance</SectionLabel>
        {subjects.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {subjects.map((s) => (
              <GlassCard key={s.id} className="p-4 hover:border-black/15 cursor-pointer" onClick={() => setPage("practice")}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold shrink-0" style={{background:`${s.color}15`,color:s.color}}>{s.icon}</div>
                    <span className="text-sm font-semibold text-foreground">{s.name}</span>
                  </div>
                  {s.trend !== 0 && (
                    <div className="flex items-center gap-1 text-xs" style={{color:s.trend>=0?"#4aa87a":"#cc5069"}}>
                      <TrendingUp className={cn("w-3 h-3",s.trend<0&&"rotate-180")}/>
                      {s.trend>0?"+":""}{s.trend}%
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-muted-foreground">{s.attempts} attempts</span>
                  <span className="text-sm font-black tabular-nums" style={{color:s.color}}>{s.accuracy}%</span>
                </div>
                <ProgressBar value={s.accuracy} color={s.color}/>
              </GlassCard>
            ))}
          </div>
        ) : (
          <GlassCard className="p-6 text-center">
            <p className="text-sm text-muted-foreground">No subject data yet - complete practice to see performance.</p>
          </GlassCard>
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
            <button onClick={() => setPage("achievements")} className="w-full text-center text-xs text-[#3b5bdb] hover:text-muted-foreground transition-colors">
              View all achievements {"->"}
            </button>
          </div>
        </GlassCard>

        <GlassCard glow="purple" className="p-5">
          <SectionLabel>Class Leaderboard</SectionLabel>
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{background:"#c08a3a20",border:"1px solid #c08a3a30"}}>
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
          </div>
          <button onClick={() => setPage("leaderboard")} className="w-full text-center text-xs text-[#3b5bdb] hover:text-muted-foreground transition-colors mt-2">
            See full leaderboard {"->"}
          </button>
        </GlassCard>
      </div>
    </div>
  );
}