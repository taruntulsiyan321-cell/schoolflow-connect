import { useState } from "react";
import { leaderboard, subjects } from "@/gurukul/data/mock";
import { GlassCard, SectionLabel, Avatar, ProgressBar, cn } from "@/gurukul/components/shared";
import { Trophy, Flame, Zap, TrendingUp } from "lucide-react";

export default function Leaderboard() {
  const [filter, setFilter] = useState("overall");

  const rankIcon = (r: number) => {
    if (r === 1) return <Trophy className="w-4 h-4 text-amber-400" />;
    if (r === 2) return <Trophy className="w-4 h-4 text-slate-400" />;
    if (r === 3) return <Trophy className="w-4 h-4 text-orange-400" />;
    return <span className="text-xs font-black text-[#78788c]">#{r}</span>;
  };

  return (
    <div className="space-y-5">
      {/* Top 3 podium */}
      <div className="flex items-end justify-center gap-3 pt-2 pb-6">
        {[leaderboard[1], leaderboard[0], leaderboard[2]].map((p, podiumIdx) => {
          const heights = ["h-24", "h-32", "h-20"];
          const sizes: ("sm" | "md" | "lg")[] = ["md", "lg", "md"];
          return (
            <div key={p.rank} className="flex flex-col items-center gap-2">
              <Avatar initials={p.avatar} color={p.color} size={sizes[podiumIdx]} />
              <div className="text-xs font-semibold text-white text-center truncate max-w-[72px]">{p.name.split(" ")[0]}</div>
              <div className={cn("w-20 rounded-t-xl flex flex-col items-center justify-end pb-2", heights[podiumIdx])}
                style={{ background: `linear-gradient(180deg, ${p.color}20 0%, ${p.color}08 100%)`, border: `1px solid ${p.color}30` }}>
                <div className="text-xl font-black" style={{ color: p.color, fontFamily: "var(--font-display)" }}>#{p.rank}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Filter */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {["overall", ...subjects.map((s) => s.name)].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all",
              filter === f ? "bg-[#3b5bdb] text-white" : "border border-white/10 text-[#78788c] hover:border-white/25 hover:text-white")}>
            {f}
          </button>
        ))}
      </div>

      {/* Rankings */}
      <GlassCard className="p-5">
        <SectionLabel>Class rankings</SectionLabel>
        <div className="space-y-2">
          {leaderboard.map((p) => (
            <div key={p.rank}
              className={cn("flex items-center gap-3 p-3 rounded-xl border transition-colors",
                p.you ? "border-blue-500/30 bg-blue-500/8" : "border-white/7 hover:border-white/12")}>
              <div className="w-7 h-7 flex items-center justify-center shrink-0">{rankIcon(p.rank)}</div>
              <Avatar initials={p.avatar} color={p.color} size="sm" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={cn("text-sm font-semibold", p.you ? "text-blue-300" : "text-white")}>{p.name}</span>
                  {p.you && <span className="text-[9px] text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded-full font-semibold">YOU</span>}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <ProgressBar value={p.accuracy} color={p.color} height="h-1" />
                  <span className="text-[11px] text-[#78788c] shrink-0">{p.accuracy}%</span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="flex items-center gap-1 text-amber-400 text-xs font-bold justify-end">
                  <Zap className="w-3 h-3" />{p.xp.toLocaleString()}
                </div>
                <div className="flex items-center gap-1 text-[#78788c] text-[11px] justify-end mt-0.5">
                  <Flame className="w-3 h-3" />{p.streak}d
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
