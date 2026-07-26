import { student, subjects, achievements, leaderboard } from "@/gurukul/data/mock";
import type { PageKey } from "@/gurukul/data/mock";
import { GlassCard, SectionLabel, XPBar, ProgressBar, ProgressRing, cn } from "@/gurukul/components/shared";
import { Flame, Zap, Trophy, Target, Medal, Edit3, ArrowRight } from "lucide-react";

export default function Profile({ setPage }: { setPage?: (p: PageKey) => void }) {
  const unlocked  = achievements.filter((a) => a.unlocked);
  const myRankRow = leaderboard.find(s => s.you);

  return (
    <div className="space-y-5">
      {/* Hero card */}
      <GlassCard glow="blue" className="p-6">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-black text-white shrink-0" style={{ background: "linear-gradient(135deg,#6366f1,#8f7dd6)" }}>
            {student.avatar}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start gap-2">
              <div>
                <h2 className="text-xl font-black text-white leading-tight" style={{ fontFamily: "var(--font-display)" }}>{student.name}</h2>
                <div className="text-sm text-[#78788c]">{student.class} · Roll #{student.rollNo} · Section {student.section}</div>
                <div className="text-xs text-[#6366f1] mt-0.5">Goal: {student.goal}</div>
              </div>
              <button className="ml-auto text-[#78788c] hover:text-white transition-colors">
                <Edit3 className="w-4 h-4" />
              </button>
            </div>
            <div className="mt-3">
              <XPBar xp={student.xp} level={student.level} />
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Class rank",    value: `#${student.rank}`,            color: "#c08a3a", icon: <Trophy className="w-4 h-4" /> },
          { label: "Accuracy",      value: `${student.accuracy}%`,        color: "#4b9fd4", icon: <Target className="w-4 h-4" /> },
          { label: "Streak",        value: `${student.streak} days`,      color: "#f97316", icon: <Flame className="w-4 h-4" /> },
          { label: "Total XP",      value: student.xp.toLocaleString(),   color: "#8f7dd6", icon: <Zap className="w-4 h-4" /> },
        ].map((s) => (
          <div key={s.label} className="p-4 rounded-2xl border border-white/7 bg-[#131316]/70">
            <div className="flex items-center gap-2 mb-1" style={{ color: s.color }}>
              {s.icon}
              <span className="text-[10px] uppercase tracking-wider text-[#78788c]">{s.label}</span>
            </div>
            <div className="text-xl font-black tabular-nums" style={{ color: s.color, fontFamily: "var(--font-display)" }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Subject mastery overview */}
      <GlassCard className="p-5">
        <SectionLabel>Your subjects</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {subjects.map((s) => (
            <div key={s.id} className="flex flex-col items-center gap-2 p-4 rounded-xl border border-white/7 bg-white/2 hover:border-white/15 transition-colors">
              <ProgressRing score={s.accuracy} size={64} color={s.color} />
              <div className="text-xs font-semibold text-white text-center">{s.name}</div>
              <div className="text-[11px] text-[#78788c] text-center">{s.attempts} questions done</div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Recent milestones */}
      <GlassCard className="p-5">
        <SectionLabel>Recent milestones</SectionLabel>
        <div className="flex flex-wrap gap-3">
          {unlocked.map((a) => (
            <div key={a.id} title={a.title} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-400/15 bg-amber-400/5">
              <span className="text-lg">{a.icon}</span>
              <div>
                <div className="text-xs font-semibold text-white">{a.title}</div>
                <div className="text-[10px] text-[#78788c]">+{a.xp} XP · {a.date}</div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Overall stats */}
      <GlassCard className="p-5">
        <SectionLabel>All-time stats</SectionLabel>
        <div className="grid sm:grid-cols-2 gap-4">
          {[
            { label: "Questions solved",   value: student.totalQuestions.toLocaleString() },
            { label: "Correct answers",    value: student.correctAnswers.toLocaleString() },
            { label: "Sessions this week", value: student.sessionsThisWeek },
            { label: "Avg speed",          value: `${student.avgSpeed}s/question` },
          ].map((s) => (
            <div key={s.label} className="flex items-center justify-between py-2.5 border-b border-white/5 last:border-0">
              <span className="text-sm text-[#78788c]">{s.label}</span>
              <span className="text-sm font-bold text-white">{s.value}</span>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Leaderboard + Achievements row */}
      <div className="grid sm:grid-cols-2 gap-4">
        {/* Leaderboard snapshot */}
        <GlassCard glow="amber" className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-amber-400"/>
            <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Class Rankings</span>
            {setPage && (
              <button onClick={() => setPage("leaderboard")} className="ml-auto flex items-center gap-1 text-[10px] text-[#6366f1] hover:text-blue-300 transition-colors">
                Full board <ArrowRight className="w-3 h-3"/>
              </button>
            )}
          </div>
          {/* My position */}
          {myRankRow && (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-[#6366f1]/10 border border-[#6366f1]/25 mb-3">
              <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-black text-white shrink-0"
                style={{background:"linear-gradient(135deg,#6366f1,#8f7dd6)"}}>
                {student.avatar}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold text-white">You</div>
                <div className="text-[10px] text-[#78788c]">{student.xp.toLocaleString()} XP · {student.accuracy}% accuracy</div>
              </div>
              <div className="text-2xl font-black text-amber-400">#{student.rank}</div>
            </div>
          )}
          <div className="space-y-2.5">
            {leaderboard.filter(s => !s.you).slice(0, 4).map((s, i) => (
              <div key={s.rank} className="flex items-center gap-2.5">
                <div className={cn(
                  "w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0",
                  s.rank===1?"bg-amber-400/20 text-amber-400":s.rank===2?"bg-slate-400/20 text-slate-400":"bg-white/5 text-[#78788c]"
                )}>#{s.rank}</div>
                <div className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black text-white shrink-0"
                  style={{background:`linear-gradient(135deg,${s.color},${s.color}99)`}}>{s.avatar}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{s.name}</div>
                </div>
                <span className="text-[11px] text-[#78788c] tabular-nums shrink-0">{s.xp.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        {/* Achievements snapshot */}
        <GlassCard glow="purple" className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 rounded-full bg-purple-400"/>
            <span className="text-xs uppercase tracking-[0.15em] text-[#78788c]">Achievements</span>
            {setPage && (
              <button onClick={() => setPage("achievements")} className="ml-auto flex items-center gap-1 text-[10px] text-[#6366f1] hover:text-blue-300 transition-colors">
                All <ArrowRight className="w-3 h-3"/>
              </button>
            )}
          </div>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-400/10 border border-amber-400/20 flex items-center justify-center shrink-0">
              <Medal className="w-6 h-6 text-amber-400"/>
            </div>
            <div>
              <div className="text-xl font-black text-white">{unlocked.length}</div>
              <div className="text-[11px] text-[#78788c]">Unlocked of {achievements.length}</div>
            </div>
          </div>
          <div className="space-y-2.5">
            {unlocked.map(a => (
              <div key={a.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-amber-400/5 border border-amber-400/10">
                <span className="text-xl shrink-0">{a.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-white truncate">{a.title}</div>
                  <div className="text-[10px] text-[#78788c]">+{a.xp} XP · {a.date}</div>
                </div>
              </div>
            ))}
            {achievements.filter(a => !a.unlocked).slice(0, 2).map(a => (
              <div key={a.id} className="flex items-center gap-3 p-2.5 rounded-xl border border-white/5 opacity-50">
                <span className="text-xl grayscale shrink-0">{a.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-[#78788c] truncate">{a.title}</div>
                  <div className="text-[10px] text-[#78788c]">{a.progress}/{a.target} · locked</div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
