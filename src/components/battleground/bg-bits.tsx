import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Crown, Target, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { displaySubject, displayTopic } from "@/lib/academicPresentation";
import { isBattleWindowOpen } from "@/lib/battlegroundHelpers";


const Countdown = ({ to, onEnd }: { to: string | Date; onEnd?: () => void }) => {
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


export const BattleCard = ({ battle, onJoin }: { battle: any; onJoin: () => void }) => {
  const live = isBattleWindowOpen(battle);
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