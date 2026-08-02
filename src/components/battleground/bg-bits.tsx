import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Crown, Lock, HelpCircle, Flame, Target, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { BADGES, TIER_CLASS, RARITY_LABEL, type BadgeTier } from "@/lib/badges";
import { displaySubject, displayTopic } from "@/lib/academicPresentation";
import { progressionLevelProgress } from "@/academic/services/progressionMath";

/** Level ring — prefer ProgressionService fields; else SQL-mirrored curve (never invent xp%N). */
export const XPRing = ({
  xp,
  level,
  size = 120,
  xpIntoLevel,
  xpToNext,
  progressPct,
}: {
  xp: number;
  level: number;
  size?: number;
  xpIntoLevel?: number;
  xpToNext?: number;
  progressPct?: number;
}) => {
  const derived = progressionLevelProgress(xp, level);
  const into = Math.max(0, xpIntoLevel ?? derived.xpIntoLevel);
  const remaining = Math.max(0, xpToNext ?? derived.xpToNextLevel);
  const span = into + remaining;
  const pct =
    progressPct != null
      ? Math.min(100, Math.max(0, progressPct))
      : span > 0
        ? Math.min(100, (into / span) * 100)
        : derived.levelProgressPct;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c - (pct / 100) * c;
  const label = span > 0 ? `${into}/${span} XP` : `${Math.max(0, xp)} XP`;
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
        <div className="text-2xl font-bold text-primary">{level}</div>
        <div className="text-[10px] text-muted-foreground">{label}</div>
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
  const urgent = diff > 0 && diff <= 5000;
  return (
    <span className={cn("font-mono font-bold tabular-nums inline-block", urgent && "text-destructive animate-count-pulse")}>
      {h > 0 && `${h}h `}{String(m).padStart(2, "0")}:{String(s).padStart(2, "0")}
    </span>
  );
};

export const BadgeCard = ({
  code,
  tier,
  earned,
}: {
  code: string;
  tier?: BadgeTier;
  earned?: boolean;
}) => {
  const meta = BADGES[code];
  const effectiveTier: BadgeTier = tier ?? meta?.tier ?? "bronze";
  const t = TIER_CLASS[effectiveTier];
  // Hidden + not earned => mystery card
  const mystery = !earned && meta?.hidden;
  const Icon = meta?.icon ?? Crown;

  return (
    <Card
      className={cn(
        "p-4 text-center transition-all duration-300 hover:-translate-y-0.5",
        earned ? "shadow-elevated" : "opacity-60 grayscale hover:grayscale-0 hover:opacity-90",
      )}
    >
      <div className={cn("relative w-14 h-14 rounded-xl mx-auto flex items-center justify-center text-white", t.bg)}>
        {mystery ? <HelpCircle className="w-6 h-6" /> : <Icon className="w-6 h-6" />}
        {!earned && (
          <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-muted text-muted-foreground flex items-center justify-center ring-2 ring-card">
            <Lock className="w-2.5 h-2.5" />
          </span>
        )}
      </div>
      <div className="mt-3 font-semibold text-sm leading-tight">{mystery ? "Hidden Badge" : meta?.label ?? code}</div>
      <div className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{mystery ? "Keep playing to reveal" : meta?.desc ?? ""}</div>
      <div className="mt-2 flex items-center justify-center gap-1">
        <span className={cn("inline-block text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full text-white", t.bg)}>{effectiveTier}</span>
        {meta && !mystery && (
          <span className="inline-block text-[10px] uppercase tracking-wider font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{RARITY_LABEL[meta.rarity]}</span>
        )}
      </div>
    </Card>
  );
};

export const BattleCard = ({ battle, onJoin }: { battle: any; onJoin: () => void }) => {
  const live = battle.status === "live" || (battle.status === "scheduled" && new Date(battle.starts_at) <= new Date());
  const modeLabel =
    battle.mode === "open" ? "Open" : battle.mode === "lobby" ? "Class" : battle.mode === "duel" ? "Duel" : null;
  return (
    <Card className="overflow-hidden surface-card group">
      <div className="px-4 py-3 border-b border-border/60 bg-muted/30">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="section-label">
              {displaySubject(battle.subject)}{battle.topic ? ` · ${displayTopic(battle.topic)}` : ""}
              {modeLabel && <span className="ml-2 text-primary">· {modeLabel}</span>}
            </div>
            <div className="text-base font-semibold mt-1 truncate text-foreground">{battle.title}</div>
          </div>
          {live ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-destructive shrink-0">
              <span className="live-dot" /> Live
            </span>
          ) : (
            <span className="text-[11px] font-medium text-muted-foreground tabular-nums shrink-0">
              <Countdown to={battle.starts_at} />
            </span>
          )}
        </div>
      </div>
      <div className="p-4 flex items-center justify-between gap-3">
        <div className="flex gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><Target className="w-3.5 h-3.5" />{battle.question_count} questions</span>
          <span className="flex items-center gap-1"><Zap className="w-3.5 h-3.5" />{battle.per_question_sec}s each</span>
        </div>
        <button type="button" onClick={onJoin} className="px-4 py-2 rounded-lg btn-cta text-sm press">
          {live ? "Join battle" : "Join"}
        </button>
      </div>
    </Card>
  );
};

export const PodiumRow = ({
  rank,
  name,
  score,
  isMe,
  equippedBadge,
}: {
  rank: number;
  name: string;
  score: number;
  isMe?: boolean;
  equippedBadge?: string | null;
}) => {
  const tier = rank === 1 ? "text-tier-gold" : rank === 2 ? "text-tier-silver" : rank === 3 ? "text-tier-bronze" : "text-muted-foreground";
  return (
    <div className={cn("flex items-center gap-3 p-3 rounded-lg border transition-colors", isMe ? "bg-primary/5 border-primary/25" : "bg-card border-border/60")}>
      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-sm font-semibold bg-muted", tier)}>
        {rank <= 3 ? <Crown className="w-4 h-4" /> : rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold truncate flex items-center gap-2">
          <span className="truncate">{name}</span>
          {equippedBadge && <EquippedBadge code={equippedBadge} size="xs" />}
          {isMe && <span className="text-xs text-primary shrink-0">(you)</span>}
        </div>
      </div>
      <div className="font-semibold tabular-nums text-foreground">{score}</div>
    </div>
  );
};
