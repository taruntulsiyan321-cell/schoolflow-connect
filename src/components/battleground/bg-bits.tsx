import { ReactNode, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Trophy, Flame, Zap, Crown, Medal, Target, Star } from "lucide-react";
import { cn } from "@/lib/utils";

export const XPRing = ({ xp, level, size = 120 }: { xp: number; level: number; size?: number }) => {
  const xpInLevel = xp % 100;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (xpInLevel / 100) * c;
  return (
    <div className="relative inline-flex" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="hsl(var(--muted))" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r}
          stroke="url(#xpGrad)" strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.6s ease" }}
        />
        <defs>
          <linearGradient id="xpGrad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--primary))" />
            <stop offset="100%" stopColor="hsl(330 81% 60%)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">Level</div>
        <div className="text-3xl font-black bg-gradient-battle bg-clip-text text-transparent">{level}</div>
        <div className="text-[10px] text-muted-foreground">{xpInLevel}/100 XP</div>
      </div>
    </div>
  );
};

export const StreakFlame = ({ streak }: { streak: number }) => (
  <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-warning/10 text-warning font-semibold text-sm">
    <Flame className="w-4 h-4 fill-current" /> {streak} day streak
  </div>
);

export const Countdown = ({ to, onEnd }: { to: string | Date; onEnd?: () => void }) => {
  const target = new Date(to).getTime();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);
  const diff = Math.max(0, target - now);
  useEffect(() => { if (diff === 0) onEnd?.(); }, [diff, onEnd]);
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  return (
    <span className="font-mono font-bold tabular-nums">
      {h > 0 && `${h}h `}{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
};

export const BadgeCard = ({ code, tier, earned }: { code: string; tier: "bronze" | "silver" | "gold" | "platinum"; earned?: boolean }) => {
  const meta: Record<string, { label: string; icon: ReactNode; desc: string }> = {
    first_win: { label: "First Victory", icon: <Trophy className="w-6 h-6" />, desc: "Win your first battle" },
    sharp_shooter: { label: "Sharp Shooter", icon: <Target className="w-6 h-6" />, desc: "5+ correct in one battle" },
    speed_master: { label: "Speed Master", icon: <Zap className="w-6 h-6" />, desc: "Fastest solver" },
    consistency: { label: "Consistency Warrior", icon: <Flame className="w-6 h-6" />, desc: "7-day streak" },
    topper: { label: "Subject Topper", icon: <Crown className="w-6 h-6" />, desc: "Top of class" },
    quiz_winner: { label: "Quiz Winner", icon: <Medal className="w-6 h-6" />, desc: "Win 5 battles" },
  };
  const m = meta[code] ?? { label: code, icon: <Star className="w-6 h-6" />, desc: "" };
  const tierBg = { bronze: "bg-tier-bronze", silver: "bg-tier-silver", gold: "bg-tier-gold", platinum: "bg-tier-platinum" }[tier];
  return (
    <Card className={cn("p-4 text-center transition-all", earned ? "shadow-elevated" : "opacity-50 grayscale")}>
      <div className={cn("w-14 h-14 rounded-2xl mx-auto flex items-center justify-center text-white shadow-glow", tierBg)}>
        {m.icon}
      </div>
      <div className="mt-3 font-semibold text-sm">{m.label}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5">{m.desc}</div>
      <div className={cn("mt-2 inline-block text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full text-white", tierBg)}>{tier}</div>
    </Card>
  );
};

export const BattleCard = ({ battle, onJoin }: { battle: any; onJoin: () => void }) => {
  const live = battle.status === "live" || (battle.status === "scheduled" && new Date(battle.starts_at) <= new Date());
  return (
    <Card className="overflow-hidden relative group hover:shadow-battle transition-all animate-rise">
      <div className="bg-gradient-battle p-4 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-shimmer" />
        <div className="relative flex items-start justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider opacity-80 font-semibold">{battle.subject}{battle.topic ? ` · ${battle.topic}` : ""}</div>
            <div className="text-lg font-bold mt-0.5">{battle.title}</div>
          </div>
          {live ? (
            <span className="text-[10px] uppercase font-bold bg-destructive px-2 py-1 rounded-full animate-pulse-glow">● Live</span>
          ) : (
            <span className="text-[10px] uppercase font-bold bg-white/20 px-2 py-1 rounded-full">
              <Countdown to={battle.starts_at} />
            </span>
          )}
        </div>
      </div>
      <div className="p-4 flex items-center justify-between">
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Target className="w-3.5 h-3.5" />{battle.question_count}Q</span>
          <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5" />{battle.per_question_sec}s</span>
        </div>
        <button onClick={onJoin} className="px-4 py-2 rounded-lg bg-gradient-battle text-white font-semibold text-sm shadow-card hover:shadow-battle transition-shadow">
          {live ? "Enter Arena" : "Join"}
        </button>
      </div>
    </Card>
  );
};

export const PodiumRow = ({ rank, name, score, isMe }: { rank: number; name: string; score: number; isMe?: boolean }) => {
  const tier = rank === 1 ? "text-tier-gold" : rank === 2 ? "text-tier-silver" : rank === 3 ? "text-tier-bronze" : "text-muted-foreground";
  return (
    <div className={cn("flex items-center gap-3 p-3 rounded-xl transition-all", isMe ? "bg-primary/10 ring-2 ring-primary shadow-card animate-pulse-glow" : "bg-muted/40")}>
      <div className={cn("w-9 h-9 rounded-full flex items-center justify-center font-black text-lg", tier, rank <= 3 && "shadow-glow")}>
        {rank <= 3 ? <Crown className="w-5 h-5" /> : `#${rank}`}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate">{name} {isMe && <span className="text-xs text-primary">(you)</span>}</div>
      </div>
      <div className="font-bold text-lg tabular-nums">{score}</div>
    </div>
  );
};
