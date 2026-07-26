import { achievements } from "@/gurukul/data/mock";
import { GlassCard, SectionLabel, ProgressBar, cn } from "@/gurukul/components/shared";
import { Zap, Lock } from "lucide-react";

export default function Achievements() {
  const unlocked = achievements.filter((a) => a.unlocked);
  const locked = achievements.filter((a) => !a.unlocked);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-2xl border border-white/7 bg-[#131316]/70 text-center">
          <div className="text-2xl font-black text-amber-400" style={{ fontFamily: "var(--font-display)" }}>{unlocked.length}</div>
          <div className="text-[11px] text-[#78788c] mt-0.5">Milestones reached</div>
        </div>
        <div className="p-4 rounded-2xl border border-white/7 bg-[#131316]/70 text-center">
          <div className="text-2xl font-black text-[#8f7dd6]" style={{ fontFamily: "var(--font-display)" }}>
            {unlocked.reduce((s, a) => s + a.xp, 0).toLocaleString()}
          </div>
          <div className="text-[11px] text-[#78788c] mt-0.5">XP earned from milestones</div>
        </div>
      </div>

      <GlassCard glow="amber" className="p-5">
        <SectionLabel>Milestones reached</SectionLabel>
        <div className="grid sm:grid-cols-2 gap-3">
          {unlocked.map((a) => (
            <div key={a.id} className="flex items-start gap-3 p-4 rounded-xl border border-amber-400/15 bg-amber-400/5">
              <span className="text-2xl shrink-0">{a.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-white">{a.title}</div>
                <div className="text-[11px] text-[#78788c] mt-0.5">{a.desc}</div>
                <div className="flex items-center gap-1 mt-1.5 text-amber-400">
                  <Zap className="w-3 h-3" />
                  <span className="text-xs font-semibold">+{a.xp} XP</span>
                  <span className="text-[#78788c] text-[11px] ml-1">· {a.date}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Coming up</SectionLabel>
        <div className="space-y-3">
          {locked.map((a) => (
            <div key={a.id} className="flex items-start gap-3 p-4 rounded-xl border border-white/7 bg-white/2">
              <span className="text-2xl shrink-0 opacity-40">{a.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[#a0a0b0]">{a.title}</span>
                  <Lock className="w-3 h-3 text-[#78788c]" />
                </div>
                <div className="text-[11px] text-[#78788c] mt-0.5 mb-2">{a.desc}</div>
                {"progress" in a && (
                  <>
                    <ProgressBar value={a.progress ?? 0} max={a.target} color="#78788c" height="h-1" />
                    <div className="text-[10px] text-[#78788c] mt-1">{a.progress}/{a.target}</div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-1 text-[#78788c] text-xs shrink-0">
                <Zap className="w-3 h-3" />{a.xp}
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
