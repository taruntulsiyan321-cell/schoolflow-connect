import { Award, Clock, Target, UserPlus, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { Countdown } from "@/components/battleground/bg-bits";
import { displaySubject, displayTopic } from "@/lib/academicPresentation";
import { isBattleWindowOpen } from "@/lib/battlegroundHelpers";

type Participant = { display_name: string; user_id?: string };

function avatarInitials(name: string) {
  return name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function ArenaLiveBattleCard({
  battle,
  participants,
  onJoin,
}: {
  battle: {
    id: string;
    title: string;
    subject: string;
    topic?: string | null;
    status: string;
    starts_at: string;
    question_count: number;
    per_question_sec: number;
    mode?: string;
    joinedByMe?: boolean;
  };
  participants: Participant[];
  onJoin: () => void;
}) {
  const live = isBattleWindowOpen(battle);
  const p1 = participants[0];
  const p2 = participants[1];
  const openSlot = participants.length < 2;

  const subjectTone =
    battle.subject === "Mathematics"
      ? "bg-[var(--ba-primary)]/10 text-[var(--ba-primary)]"
      : "bg-[var(--ba-secondary-container)]/40 text-[var(--ba-on-surface-variant)]";

  return (
    <div className="ba-card p-4 group">
      <div className="flex justify-between items-center mb-3">
        <span className={cn("ba-label text-[10px] px-2 py-0.5 rounded-full", subjectTone)}>
          {displaySubject(battle.subject)}
        </span>
        {live ? (
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[var(--ba-error)] ba-pulse-live" />
            <span className="ba-label text-[10px] text-[var(--ba-error)]">Live</span>
          </div>
        ) : (
          <span className="ba-label text-[10px] text-[var(--ba-on-surface-variant)] italic flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Starts in <Countdown to={battle.starts_at} />
          </span>
        )}
      </div>

      <p className="text-sm font-semibold text-[var(--ba-on-surface)] mb-1 truncate">{battle.title}</p>
      {battle.topic && (
        <p className="text-xs text-[var(--ba-on-surface-variant)] mb-3">{displayTopic(battle.topic)}</p>
      )}

      <div className="flex items-center justify-around py-3">
        <div className="text-center">
          <div className="w-14 h-14 rounded-full bg-[var(--ba-surface-high)] border-2 border-[var(--ba-primary-container)] flex items-center justify-center text-xs font-bold text-[var(--ba-primary-container)] mb-1.5">
            {p1 ? avatarInitials(p1.display_name) : "?"}
          </div>
          <div className="text-sm font-semibold">{p1?.display_name?.split(" ")[0] ?? "Waiting"}</div>
        </div>

        <div className="ba-display text-2xl italic text-[var(--ba-outline-variant)] opacity-60 font-black">
          VS
        </div>

        <div className={cn("text-center", openSlot && !p2 && "opacity-60")}>
          {p2 ? (
            <>
              <div className="w-14 h-14 rounded-full bg-[var(--ba-surface-high)] border-2 border-[var(--ba-outline-variant)] flex items-center justify-center text-xs font-bold text-[var(--ba-on-surface-variant)] mb-1.5">
                {avatarInitials(p2.display_name)}
              </div>
              <div className="text-sm font-semibold">{p2.display_name.split(" ")[0]}</div>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-full border-2 border-dashed border-[var(--ba-outline-variant)] flex items-center justify-center mb-1.5">
                <UserPlus className="w-5 h-5 text-[var(--ba-outline-variant)]" />
              </div>
              <div className="text-sm font-semibold text-[var(--ba-on-surface-variant)]">Open slot</div>
            </>
          )}
        </div>
      </div>

      <div className="flex gap-3 text-[10px] text-[var(--ba-on-surface-variant)] mb-3 px-1">
        <span className="flex items-center gap-1">
          <Target className="w-3 h-3" />
          {battle.question_count} Q
        </span>
        <span className="flex items-center gap-1">
          <Zap className="w-3 h-3" />
          {battle.per_question_sec}s
        </span>
        {battle.mode === "lobby" && (
          <span className="flex items-center gap-1">
            <Award className="w-3 h-3" />
            Class lobby
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={onJoin}
        className={cn(
          "w-full py-2.5 rounded-lg ba-label font-bold transition-transform active:scale-[0.98]",
          live
            ? "bg-[var(--ba-primary-container)] text-white hover:opacity-95"
            : "ba-gold-shimmer text-[var(--ba-on-surface)]",
        )}
      >
        {battle.joinedByMe ? "Continue match" : "Join match"}
      </button>
    </div>
  );
}
