import { useState } from "react";
import { concepts, subjects } from "@/gurukul/data/mock";
import { GlassCard, SectionLabel, subjectColor, ProgressBar, cn } from "@/gurukul/components/shared";
import { Target, CheckCircle2, AlertCircle, Minus } from "lucide-react";

export default function ConceptMastery() {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? concepts : concepts.filter((c) => c.subject === filter);
  const completed = concepts.filter((c) => c.mastery >= 80);
  const inProgress = concepts.filter((c) => c.mastery >= 60 && c.mastery < 80);
  const needsWork = concepts.filter((c) => c.mastery < 60);

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Doing well",  value: completed.length,  color: "#34d399", icon: <CheckCircle2 className="w-4 h-4" /> },
          { label: "In progress", value: inProgress.length, color: "#3b82f6", icon: <Target className="w-4 h-4" /> },
          { label: "Need work",   value: needsWork.length,  color: "#f59e0b", icon: <AlertCircle className="w-4 h-4" /> },
        ].map((s) => (
          <div key={s.label} className="p-4 rounded-2xl border border-white/7 bg-[#0e1322]/70 text-center">
            <div className="flex justify-center mb-1" style={{ color: s.color }}>{s.icon}</div>
            <div className="text-2xl font-black tabular-nums" style={{ color: s.color, fontFamily: "var(--font-display)" }}>{s.value}</div>
            <div className="text-[11px] text-[#6b7a99] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {["all", ...subjects.map((s) => s.name)].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("shrink-0 px-3 py-1.5 rounded-full text-xs font-medium capitalize transition-all",
              filter === f ? "bg-[#3b82f6] text-white" : "border border-white/10 text-[#6b7a99] hover:border-white/25 hover:text-white")}>
            {f}
          </button>
        ))}
      </div>

      {/* Concepts list */}
      <GlassCard className="p-5">
        <SectionLabel>Topics — how well you know them</SectionLabel>
        <div className="space-y-3">
          {filtered.map((c) => {
            const col = c.mastery >= 80 ? "#34d399" : c.mastery >= 60 ? "#3b82f6" : "#f59e0b";
            const subCol = subjectColor[c.subject] ?? "#6b7a99";
            const statusLabel = c.mastery >= 80 ? "Doing well" : c.mastery >= 60 ? "In progress" : "Needs work";
            return (
              <div key={c.id} className="flex items-center gap-3 p-4 rounded-xl border border-white/7 bg-white/2 hover:border-white/15 transition-colors">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${col}15`, color: col }}>
                  {c.mastery >= 80 ? <CheckCircle2 className="w-4 h-4" /> : c.mastery >= 60 ? <Target className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-white">{c.concept}</span>
                    <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-full font-semibold" style={{ color: col, background: `${col}12` }}>{statusLabel}</span>
                  </div>
                  <div className="text-[11px] text-[#6b7a99] mb-1.5" style={{ color: subCol }}>{c.subject} · {c.practiced} questions done · Last: {c.lastPracticed}</div>
                  <ProgressBar value={c.mastery} color={col} height="h-1.5" />
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-black tabular-nums" style={{ color: col }}>{c.mastery}%</div>
                  {c.mistakes > 0 && <div className="text-[11px] text-[#6b7a99]">{c.mistakes} mistakes</div>}
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}
