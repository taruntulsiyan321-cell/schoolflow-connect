import type { PageKey } from "@/gurukul/nav";
import { useGurukulStudent, useGurukulShellReady } from "@/gurukul/StudentContext";
import { GlassCard, SectionLabel, StatTile, XPBar, ProgressBar, cn } from "@/gurukul/components/shared";
import {
  ArrowRight, Flame, BookOpen, Brain,
  RefreshCw, RotateCcw, BarChart2, Trophy, CheckCircle2,
  TrendingUp, AlertTriangle, Swords, Star, Loader2,
} from "lucide-react";
import { AreaChart, Area, XAxis, ResponsiveContainer, Tooltip } from "recharts";
import { useMemo } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { useStudentBadges } from "@/hooks/useStudentBadges";
import { getBadge } from "@/lib/badges";

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

/** Today's self-practice count from heatmap — not lifetime sessions_completed. */
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
      reason: practiceToday > 0 ? "Daily practice done — another session builds mastery" : "Build your daily practice habit",
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
  const color=pct>=0.85?"#4b9fd4":pct>=0.57?"#c08a3a":"#6882e8";
  return (
    <div className="relative inline-flex" style={{width:size,height:size}}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke}/>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{filter:`drop-shadow(0 0 8px ${color})`,transition:"stroke-dashoffset 1s ease"}}/>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-black tabular-nums" style={{color}}>{sessions}</span>
        <span className="text-[10px] text-[#78788c]">/ {goal}</span>
      </div>
    </div>
  );
}

export default function Dashboard({ setPage }: { setPage: (p: PageKey) => void }) {
  const student = useGurukulStudent();
  const { user } = useAuth();
  const { data: snapshot, loading: snapLoading, error: snapError, reload: reloadSnap } = useStudentAcademicSnapshot();
  const { data: charts, loading: chartsLoading, error: chartsError, reload: reloadCharts } = useStudentPerformanceCharts();
  const { earned } = useStudentBadges(user?.id);

  const loading = snapLoading || chartsLoading;
  const loadError = snapError || chartsError;

  const mission = useMemo(() => buildMission(snapshot), [snapshot]);

  const loopSteps = useMemo(() => {
    const practiceDone = mission.practiceSessions > 0;
    const analysisDone = practiceDone;
    const mistakebookDone = mission.mistakesLogged > 0;
    const recoveryDone = mission.recoveryPending === 0 && mistakebookDone;
    const revisionDone = mission.revisionPending === 0 && recoveryDone;
    const activeKey = mission.nextAction.page === "assignments" ? "practice" : mission.nextAction.page;

    const steps = [
      { key: "practice", label: "Practice", icon: <BookOpen className="w-3.5 h-3.5" />, color: "#3b5bdb", done: practiceDone },
      { key: "analysis", label: "Analyse", icon: <BarChart2 className="w-3.5 h-3.5" />, color: "#4b9fd4", done: analysisDone },
      { key: "mistakebook", label: "Weakness", icon: <AlertTriangle className="w-3.5 h-3.5" />, color: "#c08a3a", done: mistakebookDone },
      { key: "recovery", label: "Recover", icon: <RefreshCw className="w-3.5 h-3.5" />, color: "#cc5069", done: recoveryDone },
      { key: "revision", label: "Revise", icon: <RotateCcw className="w-3.5 h-3.5" />, color: "#6882e8", done: revisionDone },
      { key: "aicoach", label: "Coach", icon: <Brain className="w-3.5 h-3.5" />, color: "#4aa87a", done: false },
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

  // Roll topic-level chart rows up to one tile per subject (defensive if SQL not yet applied).
  const subjects = useMemo(() => {
    const byName = new Map<string, { attempts: number; weighted: number }>();
    for (const row of charts?.subjects ?? []) {
      const name = (row.name ?? "").trim();
      if (!name) continue;
      const attempts = Math.max(0, Number(row.attempts) || 0);
      const accuracy = Number(row.accuracy) || 0;
      const prev = byName.get(name) ?? { attempts: 0, weighted: 0 };
      byName.set(name, {
        attempts: prev.attempts + attempts,
        weighted: prev.weighted + accuracy * attempts,
      });
    }
    return [...byName.entries()]
      .map(([name, agg], i) => ({
        id: name,
        name,
        color: subjectColor(name, i),
        icon: name.charAt(0).toUpperCase(),
        trend: 0,
        attempts: agg.attempts,
        accuracy: agg.attempts > 0 ? Math.round(agg.weighted / agg.attempts) : 0,
      }))
      .sort((a, b) => b.accuracy - a.accuracy);
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
  const streakLabel = shellReady ? `${student.streak}-day streak` : "...";

  return (
    <div className="space-y-6">
      {/* Hero */}
      <GlassCard glow="blue" className="p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase tracking-[0.2em] text-[#78788c]">{timeOfDayGreeting()}</span>
              <div className="flex items-center gap-1 bg-amber-400/10 border border-amber-400/20 rounded-full px-2 py-0.5">
                <Flame className="w-3 h-3 text-amber-400"/><span className="text-[10px] font-bold text-amber-400">{student.streak}-day streak</span>
              </div>
            </div>
            <h1 className="text-3xl sm:text-4xl font-black text-white leading-tight" style={{fontFamily:"var(--font-display)"}}>
              {student.firstName} 👋
            </h1>
            <p className="text-[#78788c] text-sm mt-1">{student.class}{goalLine}</p>
            <div className="grid grid-cols-3 gap-3 mt-4">
              <StatTile label="Exam accuracy"   value={`${student.accuracy}%`}   color="#4b9fd4"/>
              <StatTile label="Class Rank" value={student.rank > 0 ? `#${student.rank}` : "—"} color="#c08a3a"/>
              <StatTile label="Level"      value={`Lv.${student.level}`}    color="#6882e8"/>
            </div>
            <div className="mt-3">
              <XPBar
                xp={student.xp}
                level={student.level}
                xpIntoLevel={student.xpIntoLevel}
                xpToNext={student.xpToNext}
                progressPct={student.levelProgressPct}
              />
            </div>
          </div>
          <div className="flex flex-col items-center shrink-0">
            <WeeklyRing sessions={student.sessionsThisWeek}/>
            <span className="text-[11px] text-[#78788c] uppercase tracking-widest mt-2">Sessions / Week</span>
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
            <div className="text-base font-bold text-white">{mission.nextAction.label}</div>
            <div className="text-sm text-[#78788c] mt-0.5">{mission.nextAction.reason}</div>
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
              {i<loopSteps.length-1&&<ArrowRight className="w-3 h-3 text-[#78788c]/30 -mr-1"/>}
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
            <GlassCard key={m.label} className="p-4 cursor-pointer hover:border-white/15" onClick={() => setPage(m.page)}>
              <div className="flex items-center gap-2 mb-2">
                <span style={{color:m.color}}>{m.icon}</span>
                <span className="text-xs font-semibold text-white">{m.label}</span>
              </div>
              <div className="text-2xl font-black tabular-nums mb-1" style={{color:m.color}}>
                {m.done}<span className="text-sm text-[#78788c] font-normal">/{m.target}</span>
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
            <GlassCard key={a.label} className="p-4 cursor-pointer hover:border-white/20 group" onClick={() => setPage(a.page)}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3 transition-transform group-hover:scale-110" style={{background:`${a.color}15`,color:a.color}}>
                {a.icon}
              </div>
              <div className="text-sm font-semibold text-white">{a.label}</div>
              <div className="text-[11px] text-[#78788c] mt-0.5">{a.sub}</div>
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
                <defs>
                  <linearGradient id="dash-actGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b5bdb" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b5bdb" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis dataKey="day" tick={{fill:"#78788c",fontSize:10}} axisLine={false} tickLine={false}/>
                <Tooltip contentStyle={{background:"#131316",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,fontSize:12}} labelStyle={{color:"#78788c"}}/>
                <Area type="monotone" dataKey="total" name="Questions" stroke="#3b5bdb" strokeWidth={2} fill="url(#dash-actGrad)"
                  isAnimationActive={false} dot={{r:3,fill:"#3b5bdb",strokeWidth:0}} activeDot={{r:5,fill:"#3b5bdb"}}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-sm text-[#78788c] py-8 text-center">No activity recorded this week yet.</p>
        )}
      </GlassCard>

      {/* Subjects */}
      <div>
        <SectionLabel>Subject Performance</SectionLabel>
        {subjects.length > 0 ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {subjects.map((s) => (
              <GlassCard key={s.id} className="p-4 hover:border-white/15 cursor-pointer" onClick={() => setPage("practice")}>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold shrink-0" style={{background:`${s.color}15`,color:s.color}}>{s.icon}</div>
                    <span className="text-sm font-semibold text-white">{s.name}</span>
                  </div>
                  {s.trend !== 0 && (
                    <div className="flex items-center gap-1 text-xs" style={{color:s.trend>=0?"#4aa87a":"#cc5069"}}>
                      <TrendingUp className={cn("w-3 h-3",s.trend<0&&"rotate-180")}/>
                      {s.trend>0?"+":""}{s.trend}%
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-[#78788c]">{s.attempts} attempts</span>
                  <span className="text-sm font-black tabular-nums" style={{color:s.color}}>{s.accuracy}%</span>
                </div>
                <ProgressBar value={s.accuracy} color={s.color}/>
              </GlassCard>
            ))}
          </div>
        ) : (
          <GlassCard className="p-6 text-center">
            <p className="text-sm text-[#78788c]">No subject data yet — complete practice to see performance.</p>
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
                  <div className="text-sm font-semibold text-white">{a.title}</div>
                  <div className="text-xs text-[#78788c]">{a.desc}</div>
                </div>
                <div className="flex items-center gap-1 text-amber-400 capitalize"><span className="text-xs font-bold">{a.tier}</span></div>
              </div>
            )) : (
              <p className="text-sm text-[#78788c] text-center py-4">No badges earned yet — keep practicing!</p>
            )}
            <button onClick={() => setPage("achievements")} className="w-full text-center text-xs text-[#3b5bdb] hover:text-[#a5b4fc] transition-colors">
              View all achievements →
            </button>
          </div>
        </GlassCard>

        <GlassCard glow="purple" className="p-5">
          <SectionLabel>Class Leaderboard</SectionLabel>
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center" style={{background:"linear-gradient(135deg,#c08a3a20,#c08a3a05)",border:"1px solid #c08a3a30"}}>
              <Trophy className="w-7 h-7 text-amber-400"/>
            </div>
            <div className="text-4xl font-black text-white" style={{fontFamily:"var(--font-display)"}}>
              {student.rank > 0 ? `#${student.rank}` : "—"}
            </div>
            <div className="text-[#78788c] text-sm">
              {student.totalStudents > 0 ? `of ${student.totalStudents} students` : "Rankings unavailable"}
            </div>
            {student.rank > 0 && (
              <div className="flex items-center gap-1.5 text-emerald-400 text-sm font-semibold">
                <Star className="w-4 h-4"/>Class rank
              </div>
            )}
          </div>
          <button onClick={() => setPage("leaderboard")} className="w-full text-center text-xs text-[#3b5bdb] hover:text-[#a5b4fc] transition-colors mt-2">
            See full leaderboard →
          </button>
        </GlassCard>
      </div>
    </div>
  );
}