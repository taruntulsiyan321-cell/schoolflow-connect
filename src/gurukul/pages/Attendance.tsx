import { attendanceData } from "@/gurukul/data/mock";
import { GlassCard, SectionLabel, ProgressBar, subjectColor, cn } from "@/gurukul/components/shared";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const JUNE_DAYS = Array.from({ length: 30 }, (_, i) => i + 1);
const firstDay = new Date(2025, 5, 1).getDay(); // 0=Sun, so Monday offset = (firstDay + 6) % 7
const offset = (firstDay + 6) % 7;

export default function Attendance() {
  const pct = attendanceData.overall;
  const col = pct >= 90 ? "#4aa87a" : pct >= 75 ? "#c08a3a" : "#cc5069";

  return (
    <div className="space-y-5">
      {/* Overall */}
      <GlassCard glow={pct >= 90 ? "green" : "amber"} className="p-6 flex items-center gap-6">
        <OverallRing pct={pct} col={col} />
        <div>
          <div className="text-sm text-[#78788c] mb-0.5">Overall attendance</div>
          <div className="text-4xl font-black" style={{ color: col, fontFamily: "var(--font-display)" }}>{pct}%</div>
          <div className="text-xs text-[#78788c] mt-1">{pct >= 75 ? "You meet the minimum 75% requirement." : "Below minimum — attendance needed."}</div>
        </div>
      </GlassCard>

      {/* Calendar */}
      <GlassCard className="p-5">
        <SectionLabel>June 2025</SectionLabel>
        <div className="grid grid-cols-7 gap-1 mb-2">
          {DAYS.map((d) => <div key={d} className="text-center text-[10px] text-[#78788c]">{d}</div>)}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array(offset).fill(null).map((_, i) => <div key={`empty-${i}`} />)}
          {JUNE_DAYS.map((d) => {
            const key = `2025-06-${String(d).padStart(2, "0")}`;
            const status = attendanceData.calendar[key];
            const bg = status === "present" ? "bg-emerald-400/20 text-emerald-400" :
                       status === "absent" ? "bg-rose-400/20 text-rose-400" :
                       status === "holiday" ? "bg-white/5 text-[#78788c]" :
                       "bg-transparent text-[#78788c]/40";
            return (
              <div key={d} className={cn("h-8 rounded-lg flex items-center justify-center text-xs font-semibold transition-all hover:scale-110", bg)}>
                {d}
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-3 justify-center">
          {[["#4aa87a", "Present"], ["#cc5069", "Absent"], ["#78788c", "Holiday"]].map(([c, l]) => (
            <div key={l} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ background: `${c}50`, border: `1px solid ${c}` }} />
              <span className="text-[10px] text-[#78788c]">{l}</span>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* By subject */}
      <GlassCard className="p-5">
        <SectionLabel>Attendance by subject</SectionLabel>
        <div className="space-y-3">
          {attendanceData.bySubject.map((s) => {
            const col = s.pct >= 90 ? "#4aa87a" : s.pct >= 75 ? "#c08a3a" : "#cc5069";
            return (
              <div key={s.subject} className="flex items-center gap-3">
                <div className="w-28 text-sm text-[#a0aec0] shrink-0">{s.subject}</div>
                <div className="flex-1">
                  <ProgressBar value={s.pct} color={col} height="h-2" />
                </div>
                <div className="w-20 text-right shrink-0">
                  <span className="text-sm font-black tabular-nums" style={{ color: col }}>{s.pct}%</span>
                  <span className="text-[11px] text-[#78788c] ml-1">{s.present}/{s.total}</span>
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}

function OverallRing({ pct, col }: { pct: number; col: string }) {
  const size = 100; const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={col} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 6px ${col})` }} />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-black" style={{ color: col }}>{pct}%</span>
      </div>
    </div>
  );
}
