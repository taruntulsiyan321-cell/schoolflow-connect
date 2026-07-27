import { useState } from "react";
import { tests, subjects } from "@/gurukul/data/mock";
import { GlassCard, SectionLabel, ProgressBar, SubjectBadge, cn } from "@/gurukul/components/shared";
import { Trophy, TrendingUp, TrendingDown, Clock, CheckCircle2, AlertCircle, BarChart2 } from "lucide-react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from "recharts";

const TYPE_COLOR: Record<string, string> = {
  "quiz":      "#6882e8",
  "unit-test": "#4b9fd4",
  "mid-term":  "#cc5069",
  "final":     "#c08a3a",
};

const TYPE_LABEL: Record<string, string> = {
  "quiz":      "Quiz",
  "unit-test": "Unit Test",
  "mid-term":  "Mid-Term",
  "final":     "Final Exam",
};

export default function Tests() {
  const [filter, setFilter] = useState<"all"|"graded"|"upcoming">("all");
  const [selected, setSelected] = useState<typeof tests[0] | null>(null);

  const graded   = tests.filter(t => t.status === "graded");
  const upcoming = tests.filter(t => t.status === "upcoming");
  const filtered = filter==="all" ? tests : filter==="graded" ? graded : upcoming;

  const avgPct = graded.length
    ? Math.round(graded.reduce((s,t) => s + (t.scored!/t.totalMarks)*100, 0) / graded.length)
    : 0;
  const bestRank = Math.min(...graded.filter(t=>t.rank).map(t=>t.rank!));

  const radarData = subjects.map(s => ({
    subject: s.name.slice(0,4),
    score: Math.round((graded.filter(t=>t.subject===s.name).reduce((a,t)=>a+(t.scored!/t.totalMarks)*100,0) / Math.max(1,graded.filter(t=>t.subject===s.name).length))),
  }));

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label:"Tests Given",   value:graded.length,      color:"#3b5bdb" },
          { label:"Avg Score",     value:`${avgPct}%`,       color:"#4b9fd4" },
          { label:"Best Rank",     value:`#${bestRank}`,     color:"#c08a3a" },
          { label:"Upcoming",      value:upcoming.length,    color:"#cc5069" },
        ].map(s => (
          <GlassCard key={s.label} className="p-4 text-center">
            <div className="text-2xl font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
            <div className="text-[11px] text-[#78788c] mt-0.5">{s.label}</div>
          </GlassCard>
        ))}
      </div>

      <div className="grid lg:grid-cols-[1fr_280px] gap-6">
        {/* Test list */}
        <div className="space-y-4">
          {/* Filter */}
          <div className="flex gap-2">
            {(["all","graded","upcoming"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn(
                  "px-4 py-1.5 rounded-xl text-xs font-semibold transition-all capitalize",
                  filter===f ? "bg-[#3b5bdb] text-white" : "border border-white/7 text-[#78788c] hover:text-white hover:border-white/20"
                )}>{f}</button>
            ))}
          </div>

          <div className="space-y-3">
            {filtered.map(t => {
              const isGraded = t.status === "graded";
              const pct = isGraded ? Math.round((t.scored!/t.totalMarks)*100) : null;
              const classAvgPct = isGraded && t.avgScore ? Math.round((t.avgScore/t.totalMarks)*100) : null;
              const typeColor = TYPE_COLOR[t.type] ?? "#78788c";
              const subj = subjects.find(s=>s.name===t.subject);
              const isSelected = selected?.id === t.id;

              return (
                <GlassCard key={t.id} glow={isSelected?"blue":undefined}
                  className={cn("p-5 cursor-pointer transition-all", isSelected && "border-blue-500/30")}
                  onClick={() => setSelected(isSelected ? null : t)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{color:typeColor,background:`${typeColor}15`}}>
                          {TYPE_LABEL[t.type]}
                        </span>
                        {subj && <SubjectBadge subject={t.subject} color={subj.color}/>}
                        {!isGraded && (
                          <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full text-amber-400 bg-amber-400/10">
                            <Clock className="w-3 h-3"/> Upcoming
                          </span>
                        )}
                      </div>
                      <div className="text-sm font-bold text-white">{t.title}</div>
                      <div className="text-[11px] text-[#78788c] mt-0.5">{t.date} · {t.totalMarks} marks</div>
                    </div>

                    {isGraded && pct !== null && (
                      <div className="flex flex-col items-end shrink-0">
                        <div className="text-2xl font-black tabular-nums"
                          style={{color:pct>=75?"#4aa87a":pct>=50?"#c08a3a":"#cc5069"}}>
                          {t.scored}/{t.totalMarks}
                        </div>
                        <div className="text-[11px] text-[#78788c]">{pct}%</div>
                      </div>
                    )}
                    {!isGraded && (
                      <div className="flex flex-col items-center justify-center w-12 h-12 rounded-xl bg-amber-400/10 border border-amber-400/20 shrink-0">
                        <AlertCircle className="w-5 h-5 text-amber-400"/>
                      </div>
                    )}
                  </div>

                  {isGraded && pct !== null && (
                    <div className="mt-3">
                      <ProgressBar value={pct} color={pct>=75?"#4aa87a":pct>=50?"#c08a3a":"#cc5069"} height="h-1.5"/>
                      <div className="flex justify-between mt-1.5">
                        <span className="text-[10px] text-[#78788c]">Class avg: {classAvgPct}%</span>
                        <span className="text-[10px] text-[#78788c]">Rank #{t.rank} of {t.totalStudents}</span>
                      </div>
                    </div>
                  )}

                  {/* Expanded detail */}
                  {isSelected && (
                    <div className="mt-4 pt-4 border-t border-white/5 space-y-3">
                      <div className="text-[11px] text-[#78788c] uppercase tracking-widest">Topics Covered</div>
                      <div className="flex flex-wrap gap-2">
                        {t.topics.map(topic => (
                          <span key={topic} className="text-[11px] px-2.5 py-1 rounded-lg border border-white/8 text-[#a0aec0] bg-white/3">{topic}</span>
                        ))}
                      </div>
                      {isGraded && t.avgScore && (
                        <div className="grid grid-cols-3 gap-3">
                          {[
                            {label:"Your Score", value:`${t.scored}/${t.totalMarks}`, color:"#3b5bdb"},
                            {label:"Class Avg",  value:`${t.avgScore}/${t.totalMarks}`,color:"#78788c"},
                            {label:"Top Score",  value:`${t.topScore}/${t.totalMarks}`,color:"#c08a3a"},
                          ].map(s=>(
                            <div key={s.label} className="bg-white/4 rounded-xl p-2.5 text-center border border-white/5">
                              <div className="text-sm font-black tabular-nums" style={{color:s.color}}>{s.value}</div>
                              <div className="text-[10px] text-[#78788c] mt-0.5">{s.label}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </GlassCard>
              );
            })}
          </div>
        </div>

        {/* Side: performance radar + rank progression */}
        <div className="space-y-4">
          <GlassCard glow="purple" className="p-5">
            <SectionLabel>Subject-wise Performance</SectionLabel>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData}>
                  <PolarGrid stroke="rgba(255,255,255,0.06)"/>
                  <PolarAngleAxis dataKey="subject" tick={{fill:"#78788c",fontSize:10}}/>
                  <Radar dataKey="score" stroke="#3b5bdb" fill="#3b5bdb" fillOpacity={0.15} strokeWidth={2} isAnimationActive={false}/>
                  <Tooltip contentStyle={{background:"#131316",border:"1px solid rgba(255,255,255,0.1)",borderRadius:10,fontSize:12}}/>
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <SectionLabel>Rank History</SectionLabel>
            <div className="space-y-3">
              {graded.filter(t=>t.rank).map(t => {
                const subj = subjects.find(s=>s.name===t.subject);
                const isTop3 = (t.rank??99) <= 3;
                return (
                  <div key={t.id} className="flex items-center gap-3">
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center text-xs font-black shrink-0",
                      isTop3 ? "bg-amber-400/15 text-amber-400" : "bg-white/5 text-[#78788c]"
                    )}>
                      #{t.rank}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-semibold text-white truncate">{t.title}</div>
                      <div className="text-[10px] text-[#78788c]">{t.date}</div>
                    </div>
                    {subj && (
                      <div className="w-6 h-6 rounded-md flex items-center justify-center text-sm shrink-0"
                        style={{background:`${subj.color}15`}}>{subj.icon}</div>
                    )}
                    {isTop3 && <Trophy className="w-3.5 h-3.5 text-amber-400 shrink-0"/>}
                  </div>
                );
              })}
            </div>
          </GlassCard>

          <GlassCard glow="amber" className="p-5">
            <SectionLabel>Upcoming Tests</SectionLabel>
            {upcoming.length === 0
              ? <p className="text-sm text-[#78788c]">No upcoming tests</p>
              : (
                <div className="space-y-2.5">
                  {upcoming.map(t => {
                    const subj = subjects.find(s=>s.name===t.subject);
                    return (
                      <div key={t.id} className="flex items-center gap-3 p-3 rounded-xl border border-amber-400/10 bg-amber-400/5">
                        {subj && (
                          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-base shrink-0"
                            style={{background:`${subj.color}15`}}>{subj.icon}</div>
                        )}
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-semibold text-white truncate">{t.title}</div>
                          <div className="text-[10px] text-[#78788c]">{t.date} · {t.totalMarks} marks</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )
            }
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
