import { assignments } from "@/gurukul/data/mock";
import { GlassCard, SectionLabel, SubjectBadge, StatusBadge, subjectColor, ProgressBar, cn } from "@/gurukul/components/shared";
import { ClipboardList, CheckCircle2, Clock, AlertCircle } from "lucide-react";

export default function Assignments() {
  const pending = assignments.filter((a) => a.status === "in-progress" || a.status === "not-started");
  const completed = assignments.filter((a) => a.status === "submitted" || a.status === "graded");

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total",     value: assignments.length,  color: "#e8eaf0" },
          { label: "Pending",   value: pending.length,      color: "#c08a3a" },
          { label: "Completed", value: completed.length,    color: "#4aa87a" },
        ].map((s) => (
          <div key={s.label} className="p-4 rounded-2xl border border-white/7 bg-[#131316]/70 text-center">
            <div className="text-2xl font-black tabular-nums" style={{ color: s.color, fontFamily: "var(--font-display)" }}>{s.value}</div>
            <div className="text-[11px] text-[#78788c] mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      <GlassCard className="p-5">
        <SectionLabel>All assignments</SectionLabel>
        <div className="space-y-3">
          {assignments.map((a) => {
            const col = subjectColor[a.subject] ?? "#78788c";
            const pct = Math.round((a.completed / a.questions) * 100);
            return (
              <div key={a.id} className="p-4 rounded-xl border border-white/7 bg-white/2 hover:border-white/15 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${col}15`, color: col }}>
                    <ClipboardList className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="text-sm font-semibold text-white">{a.title}</span>
                      <StatusBadge status={a.status} />
                      {a.status === "graded" && <span className="text-xs font-bold text-purple-400">{a.marks}</span>}
                    </div>
                    <div className="flex items-center gap-2 mb-2">
                      <SubjectBadge subject={a.subject} color={col} />
                      <span className="text-[11px] text-[#78788c]">by {a.teacher} · Due {a.due}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ProgressBar value={a.completed} max={a.questions} color={col} height="h-1.5" />
                      <span className="text-[11px] text-[#78788c] shrink-0">{a.completed}/{a.questions}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </GlassCard>
    </div>
  );
}
