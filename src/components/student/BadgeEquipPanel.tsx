import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { BadgeCard } from "@/components/battleground/bg-bits";
import { BADGES, getBadge, type BadgeTier } from "@/lib/badges";
import { useStudentBadges } from "@/hooks/useStudentBadges";
import { ProgressionService } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { cn } from "@/lib/utils";
import { Award, Star } from "lucide-react";
import { toast } from "sonner";

const MAX_FEATURED = 5;

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
  const { ctx, ready } = useAcademicContext();
  const { earned, equipped, loading, saving, equip } = useStudentBadges(userId);
  const [featured, setFeatured] = useState<string[]>([]);
  const [featSaving, setFeatSaving] = useState(false);
  const earnedSet = new Set(earned.map((b) => b.badge_code));
  const equippedMeta = getBadge(equipped);

  const loadFeatured = useCallback(async () => {
    if (!userId || !ready || !ctx) return;
    try {
      const snap = await ProgressionService.getSnapshot(ctx, userId);
      setFeatured(Array.isArray(snap.featured_badges) ? snap.featured_badges : []);
    } catch {
      setFeatured([]);
    }
  }, [userId, ready, ctx]);

  useEffect(() => {
    void loadFeatured();
  }, [loadFeatured]);

  const toggleFeatured = async (code: string) => {
    if (!ctx || !ready) return;
    if (!featured.includes(code) && featured.length >= MAX_FEATURED) {
      toast.error(`At most ${MAX_FEATURED} featured badges`);
      return;
    }
    const next = featured.includes(code)
      ? featured.filter((c) => c !== code)
      : [...featured, code];
    setFeatSaving(true);
    try {
      await ProgressionService.setFeaturedBadges(ctx, next);
      setFeatured(next);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update featured badges");
    } finally {
      setFeatSaving(false);
    }
  };

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
            {earned.length} unlocked · equip one · feature up to {MAX_FEATURED}
          </p>
        </div>
        <EquippedHeader equipped={equipped} equippedMeta={equippedMeta} />
      </div>

      {featured.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {featured.map((code) => (
            <EquippedBadge key={code} code={code} size="sm" showLabel />
          ))}
        </div>
      )}

      {earned.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Win battles, complete DPPs, and stay consistent to unlock badges. Equip one badge to show it on your profile and in class.
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground mb-3">
            Tap an earned badge to equip it publicly. Use Feature to showcase up to {MAX_FEATURED} on your profile.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.values(BADGES).map((b) => {
              if (!earnedSet.has(b.code)) return null;
              const row = earned.find((e) => e.badge_code === b.code);
              const isEquipped = equipped === b.code;
              const isFeatured = featured.includes(b.code);
              const tier = (row?.tier ?? b.tier) as BadgeTier;
              return (
                <div key={b.code} className="relative">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => equip(isEquipped ? null : b.code)}
                    className={cn(
                      "text-left rounded-lg transition-all ring-2 ring-transparent w-full",
                      isEquipped && "ring-primary shadow-elevated",
                    )}
                  >
                    <BadgeCard code={b.code} tier={tier} earned />
                    {isEquipped && (
                      <div className="text-[10px] text-center font-semibold text-primary -mt-2 pb-2">Equipped</div>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={featSaving}
                    onClick={() => void toggleFeatured(b.code)}
                    className={cn(
                      "absolute top-1 right-1 p-1 rounded-md border bg-background/90",
                      isFeatured ? "border-primary text-primary" : "border-border text-muted-foreground",
                    )}
                    title={isFeatured ? "Remove from featured" : "Add to featured"}
                  >
                    <Star className={cn("w-3 h-3", isFeatured && "fill-current")} />
                  </button>
                </div>
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
