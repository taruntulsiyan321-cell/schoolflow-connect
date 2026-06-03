import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { BadgeCard } from "@/components/battleground/bg-bits";
import { BADGES, getBadge, type BadgeTier } from "@/lib/badges";
import { useStudentBadges } from "@/hooks/useStudentBadges";
import { cn } from "@/lib/utils";
import { Award } from "lucide-react";

type Props = {
  userId: string | undefined;
  compact?: boolean;
};

function EquippedHeader({
  equipped,
  equippedMeta,
}: {
  equipped: string | null;
  equippedMeta: ReturnType<typeof getBadge>;
}) {
  return (
    <div className="text-right shrink-0">
      {equipped ? (
        <div className="flex flex-col items-end gap-1">
          <EquippedBadge code={equipped} size="md" showLabel />
          {equippedMeta && (
            <span className="text-[10px] text-muted-foreground max-w-[140px] text-right">{equippedMeta.desc}</span>
          )}
        </div>
      ) : (
        <span className="text-xs text-muted-foreground">None equipped</span>
      )}
    </div>
  );
}

export function BadgeEquipPanel({ userId, compact }: Props) {
  const { earned, equipped, loading, saving, equip } = useStudentBadges(userId);
  const earnedSet = new Set(earned.map((b) => b.badge_code));
  const equippedMeta = getBadge(equipped);

  if (loading) {
    return <p className="text-sm text-muted-foreground py-4 text-center">Loading badges…</p>;
  }

  return (
    <Card className={cn("p-5", compact && "p-4")}>
      <div className={cn("flex items-start justify-between gap-3 mb-4", compact && "mb-3")}>
        <div>
          <h3 className={cn("font-semibold flex items-center gap-2", compact && "text-sm")}>
            <Award className="w-4 h-4 text-primary" />
            Achievements & public badge
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {earned.length} unlocked · equip one for your public identity
          </p>
        </div>
        <EquippedHeader equipped={equipped} equippedMeta={equippedMeta} />
      </div>

      {earned.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Win battles, complete DPPs, and stay consistent to unlock badges. Equip one badge to show it on your profile and in class.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-3">
            Tap an earned badge to equip it publicly (one at a time). Visible in class, battleground, and leaderboards.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.values(BADGES).map((b) => {
              if (!earnedSet.has(b.code)) return null;
              const row = earned.find((e) => e.badge_code === b.code);
              const isEquipped = equipped === b.code;
              const tier = (row?.tier ?? b.tier) as BadgeTier;
              return (
                <button
                  key={b.code}
                  type="button"
                  disabled={saving}
                  onClick={() => equip(isEquipped ? null : b.code)}
                  className={cn(
                    "text-left rounded-lg transition-all ring-2 ring-transparent",
                    isEquipped && "ring-primary shadow-elevated",
                  )}
                >
                  <BadgeCard code={b.code} tier={tier} earned />
                  {isEquipped && (
                    <div className="text-[10px] text-center font-semibold text-primary -mt-2 pb-2">Equipped</div>
                  )}
                </button>
              );
            })}
          </div>
          {equipped && (
            <Button
              variant="outline"
              size="sm"
              className="mt-4 w-full"
              disabled={saving}
              onClick={() => equip(null)}
            >
              Unequip public badge
            </Button>
          )}
        </>
      )}
    </Card>
  );
}
