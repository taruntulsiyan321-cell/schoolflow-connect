import { useState } from "react";
import { resources } from "@/gurukul/data/mock";
import { GlassCard, SectionLabel, SubjectBadge, subjectColor, cn } from "@/gurukul/components/shared";
import { FileText, Video, Download, Search } from "lucide-react";

export default function Resources() {
  const [q, setQ] = useState("");
  const filtered = resources.filter((r) => r.title.toLowerCase().includes(q.toLowerCase()) || r.subject.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#78788c]" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search resources…"
          className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-[#78788c] focus:outline-none focus:border-[#3b5bdb]/50 transition-colors" />
      </div>

      <GlassCard className="p-5">
        <SectionLabel>Study materials</SectionLabel>
        <div className="space-y-2">
          {filtered.map((r) => {
            const col = subjectColor[r.subject] ?? "#78788c";
            return (
              <div key={r.id} className="flex items-center gap-3 p-4 rounded-xl border border-white/7 bg-white/2 hover:border-white/15 transition-colors group cursor-pointer">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: `${col}15`, color: col }}>
                  {r.type === "Video" ? <Video className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white truncate">{r.title}</div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <SubjectBadge subject={r.subject} color={col} />
                    <span className="text-[11px] text-[#78788c]">{r.size} · {r.date} · {r.downloads} downloads</span>
                  </div>
                </div>
                <button className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <Download className="w-4 h-4 text-[#78788c]" />
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && <div className="text-center py-8 text-[#78788c] text-sm">No resources found.</div>}
        </div>
      </GlassCard>
    </div>
  );
}
