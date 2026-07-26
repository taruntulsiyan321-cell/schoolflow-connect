import { useState } from "react";
import { timetable } from "@/gurukul/data/mock";
import { GlassCard, SectionLabel, cn } from "@/gurukul/components/shared";
import { Clock, MapPin, User, ChevronLeft, ChevronRight } from "lucide-react";

const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday"];
const TODAY_IDX = Math.min(new Date().getDay() - 1, 4); // 0-4, clamp to weekdays

export default function Timetable() {
  const [dayIdx, setDayIdx] = useState(TODAY_IDX < 0 ? 0 : TODAY_IDX);
  const day = timetable[dayIdx];
  const periods = day.periods;
  const classSubjects = periods.filter((p) => p.teacher);
  const currentHour = new Date().getHours();

  function getCurrentPeriod() {
    return periods.findIndex((p) => {
      if (!p.time.includes("–")) return false;
      const [start] = p.time.split("–");
      const h = parseInt(start.split(":")[0]);
      return h === currentHour;
    });
  }
  const currentPeriodIdx = getCurrentPeriod();

  return (
    <div className="space-y-6">
      {/* Header */}
      <GlassCard glow="blue" className="p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-black text-white" style={{fontFamily:"var(--font-display)"}}>Class Timetable</h2>
            <p className="text-sm text-[#78788c] mt-0.5">XII — Science · Section A · 2024–25</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setDayIdx((i) => Math.max(0, i-1))}
              className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white hover:border-white/25 transition-all disabled:opacity-30"
              disabled={dayIdx===0}>
              <ChevronLeft className="w-4 h-4"/>
            </button>
            <div className="flex gap-1.5">
              {DAYS.map((d, i) => (
                <button key={d} onClick={() => setDayIdx(i)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                    i===dayIdx ? "bg-[#6366f1] text-white" : "text-[#78788c] hover:text-white hover:bg-white/5"
                  )}>
                  {d.slice(0,3)}
                </button>
              ))}
            </div>
            <button onClick={() => setDayIdx((i) => Math.min(4, i+1))}
              className="w-8 h-8 rounded-xl border border-white/10 flex items-center justify-center text-[#78788c] hover:text-white hover:border-white/25 transition-all disabled:opacity-30"
              disabled={dayIdx===4}>
              <ChevronRight className="w-4 h-4"/>
            </button>
          </div>
        </div>
      </GlassCard>

      {/* Today summary pills */}
      <div className="flex flex-wrap gap-2">
        {classSubjects.map((p, i) => (
          <div key={i} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold"
            style={{borderColor:`${p.color}30`,background:`${p.color}10`,color:p.color}}>
            {p.subject}
          </div>
        ))}
      </div>

      {/* Period list */}
      <div className="space-y-2">
        <SectionLabel>{day.day}</SectionLabel>
        {periods.map((period, idx) => {
          const isBreak = !period.teacher;
          const isCurrent = idx === currentPeriodIdx;
          return (
            <div key={idx} className={cn(
              "flex items-stretch gap-4 rounded-2xl border transition-all duration-200",
              isCurrent ? "border-[#6366f1]/40 bg-[#6366f1]/8 shadow-[0_0_24px_rgba(59,130,246,0.12)]" : "border-white/5 bg-[#131316]/70",
              isBreak && "opacity-50"
            )}>
              {/* Color stripe */}
              {!isBreak && (
                <div className="w-1 rounded-l-2xl shrink-0" style={{background:period.color}}/>
              )}

              <div className={cn("flex-1 py-4 pr-4", isBreak && "pl-4")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={cn("text-sm font-bold", isBreak?"text-[#78788c]":"text-white")}>
                        {period.subject}
                      </span>
                      {isCurrent && (
                        <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#6366f1]/20 text-[#6366f1]">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#6366f1] animate-pulse"/>NOW
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-1 text-[11px] text-[#78788c]">
                        <Clock className="w-3 h-3"/>
                        {period.time}
                      </div>
                      {period.teacher && (
                        <div className="flex items-center gap-1 text-[11px] text-[#78788c]">
                          <User className="w-3 h-3"/>{period.teacher}
                        </div>
                      )}
                      {period.room && (
                        <div className="flex items-center gap-1 text-[11px] text-[#78788c]">
                          <MapPin className="w-3 h-3"/>{period.room}
                        </div>
                      )}
                    </div>
                  </div>
                  {!isBreak && (
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0"
                      style={{background:`${period.color}15`}}>
                      {{ Mathematics:"∑", Physics:"⚡", Chemistry:"⚗", Biology:"🧬", English:"✍", "Physics Lab":"⚡", "Chemistry Lab":"⚗" }[period.subject] ?? "📖"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Weekly overview grid */}
      <div>
        <SectionLabel>Full Week at a Glance</SectionLabel>
        <div className="overflow-x-auto">
          <div className="min-w-[640px] grid grid-cols-5 gap-2">
            {timetable.map((d, di) => (
              <div key={d.day}>
                <div className={cn(
                  "text-center text-xs font-bold mb-2 py-1.5 rounded-lg",
                  di===dayIdx ? "bg-[#6366f1]/20 text-[#6366f1]" : "text-[#78788c]"
                )}>{d.day.slice(0,3)}</div>
                <div className="space-y-1">
                  {d.periods.filter(p=>p.teacher).map((p, pi) => (
                    <div key={pi} className="px-2 py-1.5 rounded-lg text-[10px] font-semibold truncate"
                      style={{background:`${p.color}15`,color:p.color}}>
                      {p.subject.replace(" Lab","")}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
