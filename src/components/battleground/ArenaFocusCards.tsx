import { Link } from "react-router-dom";
import { BookOpen, Flame, RefreshCw, Sword, Target } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RecoveryZoneData } from "@/hooks/useRecoveryZone";

function ProgressCard({
  icon: Icon,
  iconClass,
  borderClass,
  endsLabel,
  title,
  description,
  reward,
  progress,
  total,
  barClass,
  href,
}: {
  icon: typeof Flame;
  iconClass: string;
  borderClass?: string;
  endsLabel: string;
  title: string;
  description: string;
  reward: string;
  progress: number;
  total: number;
  barClass?: string;
  href: string;
}) {
  const pct = total > 0 ? Math.min(100, Math.round((progress / total) * 100)) : 0;
  return (
    <Link
      to={href}
      className={cn(
        "ba-card p-4 flex flex-col justify-between hover:border-[var(--ba-primary-container)] transition-colors group",
        borderClass,
      )}
    >
      <div className="space-y-2">
        <div className="flex justify-between items-start">
          <div className={cn("p-2 rounded-lg", iconClass)}>
            <Icon className="w-4 h-4" />
          </div>
          <span className="ba-label text-[10px] text-[var(--ba-on-surface-variant)]">{endsLabel}</span>
        </div>
        <h4 className="ba-headline group-hover:text-[var(--ba-primary-container)] transition-colors">{title}</h4>
        <p className="text-sm text-[var(--ba-on-surface-variant)] leading-snug">{description}</p>
      </div>
      <div className="mt-4 pt-3 border-t border-[var(--ba-outline-variant)]">
        <div className="flex justify-between items-center mb-2">
          <span className="ba-label text-[10px] text-[var(--ba-primary-container)]">{reward}</span>
          <span className="ba-label text-[10px] font-bold text-[var(--ba-primary)]">
            {progress} / {total}
          </span>
        </div>
        <div className="w-full h-1 bg-[var(--ba-outline-variant)] rounded-full overflow-hidden">
          <div
            className={cn("h-full rounded-full transition-all", barClass ?? "bg-[var(--ba-primary-container)]")}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </Link>
  );
}

export function ArenaFocusCards({
  streak,
  wins,
  recovery,
}: {
  streak: number;
  wins: number;
  recovery: RecoveryZoneData | null;
}) {
  const openAssignments = recovery?.open_assignments ?? [];
  const recoveryTotal = openAssignments.reduce((a, x) => a + (x.question_count || 0), 0);
  const recoveryDone = openAssignments.reduce((a, x) => a + (x.questions_completed || 0), 0);
  const pendingCount = recovery?.pending_count ?? 0;

  const cards = [
    {
      key: "streak",
      show: true,
      node: (
        <ProgressCard
          icon={Flame}
          iconClass="bg-[var(--ba-surface-low)] text-[var(--ba-primary-container)]"
          endsLabel="Daily goal"
          title="Keep the streak"
          description={`You're on a ${streak}-day activity streak. Hit 7 days for the Consistency Warrior badge.`}
          reward="Badge milestone"
          progress={Math.min(streak, 7)}
          total={7}
          href="/student/battleground/progress"
        />
      ),
    },
    {
      key: "wins",
      show: true,
      node: (
        <ProgressCard
          icon={Sword}
          iconClass="bg-[var(--ba-surface-low)] text-[var(--ba-primary-container)]"
          endsLabel="Arena goal"
          title="Win more battles"
          description={`${wins} wins so far. Reach 5 wins to unlock Battle Champion.`}
          reward="Battle Champion"
          progress={Math.min(wins, 5)}
          total={5}
          href="/student/battleground"
        />
      ),
    },
    {
      key: "recovery",
      show: pendingCount > 0 || recoveryDone > 0,
      node: (
        <ProgressCard
          icon={RefreshCw}
          iconClass="bg-[var(--ba-error-container)] text-[var(--ba-error)]"
          borderClass="border-[var(--ba-error)]/20 hover:border-[var(--ba-error)]/40"
          endsLabel={pendingCount > 0 ? "Needs review" : "In progress"}
          title="Fix your mistakes"
          description={
            pendingCount > 0
              ? `${pendingCount} recovery set${pendingCount === 1 ? "" : "s"} waiting. Target weak concepts from practice and battles.`
              : "Complete assigned recovery questions to strengthen weak concepts."
          }
          reward="Recovery XP"
          progress={recoveryDone}
          total={Math.max(recoveryTotal, 1)}
          barClass="bg-[var(--ba-error)]"
          href="/student/recovery"
        />
      ),
    },
    {
      key: "practice",
      show: !pendingCount && wins === 0 && streak === 0,
      node: (
        <ProgressCard
          icon={BookOpen}
          iconClass="bg-[var(--ba-surface-low)] text-[var(--ba-primary-container)]"
          endsLabel="Get started"
          title="Class 12 practice"
          description="Answer fresh questions to build mastery before your first battle."
          reward="Mastery"
          progress={0}
          total={5}
          href="/student/practice/math12"
        />
      ),
    },
  ];

  const visible = cards.filter((c) => c.show);

  if (visible.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <Target className="w-4 h-4 text-[var(--ba-primary-container)]" />
        <h3 className="ba-headline text-sm uppercase tracking-tight text-[var(--ba-primary)]">Your focus</h3>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {visible.slice(0, 3).map((c) => (
          <div key={c.key}>{c.node}</div>
        ))}
      </div>
    </section>
  );
}
