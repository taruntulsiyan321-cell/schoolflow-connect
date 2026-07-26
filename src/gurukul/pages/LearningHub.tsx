import type { PageKey } from "@/gurukul/data/mock";
import { student, subjects, recoveryItems, revisionItems, mistakes, accuracyTrend } from "@/gurukul/data/mock";
import { GlassCard, ProgressBar, cn } from "@/gurukul/components/shared";
import {
  BarChart2, RefreshCw, RotateCcw, AlertCircle,
  ArrowRight, TrendingUp, CheckCircle2,
} from "lucide-react";
import { LineChart, Line, XAxis, ResponsiveContainer, Tooltip } from "recharts";

type Props = { setPage: (p: PageKey) => void };

const FEATURES = [
  {
    key:      "analysis"       as PageKey,
    label:    "Analysis",
    sub:      "See how you're doing across all subjects",
    icon:     <BarChart2 className="w-6 h-6"/>,
    color:    "#4b9fd4",
    glow:     "shadow-[0_0_32px_rgba(34,211,238,0.07)]",
    stat:     `${student.accuracy}% accuracy`,
    statSub:  "overall",
  },
  {
    key:      "recovery"       as PageKey,
    label:    "Recovery",
    sub:      "Fix mistakes from past practice sessions",
    icon:     <RefreshCw className="w-6 h-6"/>,
    color:    "#cc5069",
    glow:     "shadow-[0_0_32px_rgba(244,63,94,0.07)]",
    stat:     `${recoveryItems.length} pending`,
    statSub:  "to recover",
  },
  {
    key:      "revision"       as PageKey,
    label:    "Revision",
    sub:      "Spaced-repetition review for long-term memory",
    icon:     <RotateCcw className="w-6 h-6"/>,
    color:    "#8f7dd6",
    glow:     "shadow-[0_0_32px_rgba(167,139,250,0.07)]",
    stat:     `${revisionItems.filter(r => r.dueIn === "Now" || r.dueIn === "Today").length} due today`,
    statSub:  "items",
  },
  {
    key:      "mistakebook"    as PageKey,
    label:    "Mistake Book",
    sub:      "A log of every error — your growth blueprint",
    icon:     <AlertCircle className="w-6 h-6"/>,
    color:    "#c08a3a",
    glow:     "shadow-[0_0_32px_rgba(245,158,11,0.07)]",
    stat:     `${mistakes.length} logged`,
    statSub:  "mistakes",
  },
];

export default function LearningHub({ setPage }: Props) {
  const pendingRecovery  = recoveryItems.length;
  const dueRevision      = revisionItems.filter(r => r.dueIn === "Now" || r.dueIn === "Today").length;
  const unresolvedErrors = mistakes.filter(m => m.status !== "mastered").length;
  const overallAccuracy  = Math.round(subjects.reduce((a,s)=>a+s.accuracy,0)/subjects.length);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-[#78788c] mb-1">Student Panel</div>
        <h1 className="text-3xl font-black text-white" style={{fontFamily:"var(--font-display)"}}>
          Learning
        </h1>
        <p className="text-[#78788c] text-sm mt-1">
          Practice → Analyse → Recover → Revise. Your complete growth loop.
        </p>
      </div>

      {/* Quick stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label:"Overall Accuracy", value:`${overallAccuracy}%`,  color:"#4b9fd4" },
          { label:"To Recover",       value:pendingRecovery,        color:"#cc5069" },
          { label:"Due for Revision", value:dueRevision,            color:"#8f7dd6" },
          { label:"Unresolved",       value:unresolvedErrors,       color:"#c08a3a" },
        ].map(s => (
          <GlassCard key={s.label} className="p-4 text-center">
            <div className="text-2xl font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
            <div className="text-[11px] text-[#78788c] mt-0.5">{s.label}</div>
          </GlassCard>
        ))}
      </div>

      {/* Feature cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {FEATURES.map(f => (
          <button key={f.key} onClick={() => setPage(f.key)}
            className={cn(
              "group text-left p-5 rounded-2xl border border-white/7 bg-[#131316]/90 transition-all duration-200",
              "hover:border-white/20 hover:scale-[1.02]",
              f.glow
            )}>
            <div className="flex items-start justify-between mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center transition-transform group-hover:scale-110"
                style={{background:`${f.color}15`,color:f.color}}>
                {f.icon}
              </div>
              <ArrowRight className="w-4 h-4 text-[#78788c] group-hover:text-white group-hover:translate-x-0.5 transition-all"/>
            </div>
            <div className="text-base font-black text-white mb-1" style={{fontFamily:"var(--font-display)"}}>{f.label}</div>
            <div className="text-xs text-[#78788c] leading-relaxed mb-4">{f.sub}</div>
            <div className="flex items-baseline gap-1.5">
              <span className="text-xl font-black tabular-nums" style={{color:f.color}}>{f.stat}</span>
              <span className="text-[11px] text-[#78788c]">{f.statSub}</span>
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
            <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Accuracy Trend</span>
          </div>
          <div className="flex items-baseline gap-2 mb-4">
            <span className="text-2xl font-black text-white">{accuracyTrend[accuracyTrend.length-1].score}%</span>
            <span className="flex items-center gap-1 text-emerald-400 text-xs font-semibold">
              <TrendingUp className="w-3.5 h-3.5"/>
              +{accuracyTrend[accuracyTrend.length-1].score - accuracyTrend[0].score}% since week 1
            </span>
          </div>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={accuracyTrend}>
                <XAxis dataKey="week" tick={{fill:"#78788c",fontSize:10}} axisLine={false} tickLine={false}/>
                <Tooltip contentStyle={{background:"#131316",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,fontSize:12}}/>
                <Line type="monotone" dataKey="score" name="Accuracy" stroke="#4b9fd4" strokeWidth={2.5}
                  isAnimationActive={false} dot={{r:3,fill:"#4b9fd4",strokeWidth:0}} activeDot={{r:5}}/>
              </LineChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* Subject mastery rings */}
        <GlassCard className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-[#6366f1]"/>
            <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Subject Accuracy</span>
          </div>
          <div className="space-y-3">
            {subjects.map(s => (
              <div key={s.id} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-md flex items-center justify-center text-sm shrink-0"
                  style={{background:`${s.color}15`}}>{s.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between mb-1">
                    <span className="text-xs font-semibold text-white">{s.name}</span>
                    <span className="text-xs font-black tabular-nums" style={{color:s.color}}>{s.accuracy}%</span>
                  </div>
                  <ProgressBar value={s.accuracy} color={s.color} height="h-1.5"/>
                </div>
                <div className="flex items-center gap-1 text-[10px] shrink-0"
                  style={{color:s.trend>=0?"#4aa87a":"#cc5069"}}>
                  <TrendingUp className={cn("w-3 h-3", s.trend<0&&"rotate-180")}/>
                  {s.trend>0?"+":""}{s.trend}%
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Learning loop reminder */}
      <GlassCard className="p-5 border-dashed border-white/10">
        <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-[#78788c]">
          {[
            {label:"Practice",    color:"#6366f1", done:true},
            {label:"Analyse",     color:"#4b9fd4", done:true},
            {label:"Mistake Book",color:"#c08a3a", done:true},
            {label:"Recover",     color:"#cc5069", done:false, active:true},
            {label:"Revise",      color:"#8f7dd6", done:false},
          ].map((step, i, arr) => (
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
              {i < arr.length-1 && <span className="text-[#78788c]/30">→</span>}
            </span>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
