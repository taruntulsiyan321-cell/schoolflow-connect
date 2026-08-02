import { useCallback, useEffect, useMemo, useState } from "react";
import { GlassCard, SectionLabel, cn } from "@/gurukul/components/shared";
import { Lock, Loader2, Star } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useStudentBadges } from "@/hooks/useStudentBadges";
import { BADGES, getBadge, TIER_CLASS } from "@/lib/badges";
import { ProgressionService, type ProgressionSnapshot } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { toast } from "sonner";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";

const MAX_FEATURED = 5;

function formatEarnedDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

export default function Achievements() {
  const { user } = useAuth();
  const { ctx, ready } = useAcademicContext();
  const { earned, equipped, loading, saving, equip } = useStudentBadges(user?.id);
  const [featured, setFeatured] = useState<string[]>([]);
  const [achievements, setAchievements] = useState<ProgressionSnapshot["achievements"]>([]);
  const [progLoading, setProgLoading] = useState(true);
  const [featSaving, setFeatSaving] = useState(false);

  const loadProgression = useCallback(async () => {
    if (!user || !ready || !ctx) {
      setProgLoading(false);
      return;
    }
    setProgLoading(true);
    try {
      const snap = await ProgressionService.getSnapshot(ctx, user.id);
      setFeatured(Array.isArray(snap.featured_badges) ? snap.featured_badges : []);
      setAchievements(Array.isArray(snap.achievements) ? snap.achievements : []);
    } catch (e) {
      setFeatured([]);
      setAchievements([]);
      toast.error(e instanceof Error ? e.message : "Could not load progression achievements");
    } finally {
      setProgLoading(false);
    }
  }, [user, ready, ctx]);

  useEffect(() => {
    void loadProgression();
  }, [loadProgression]);

  useEffect(() => {
    const onXp = () => {
      void loadProgression();
    };
    window.addEventListener("student-xp-updated", onXp);
    return () => window.removeEventListener("student-xp-updated", onXp);
  }, [loadProgression]);

  const { unlocked, locked, visibleCatalogCount } = useMemo(() => {
    const earnedCodes = new Set(earned.map((e) => e.badge_code));
    const unlockedItems = earned
      .map((e) => {
        const meta = getBadge(e.badge_code);
        if (!meta) return null;
        return { ...meta, earned_at: e.earned_at };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    const lockedItems = Object.values(BADGES).filter((b) => !earnedCodes.has(b.code) && !b.hidden);
    const catalogCount = Object.values(BADGES).filter((b) => !b.hidden || earnedCodes.has(b.code)).length;
    return { unlocked: unlockedItems, locked: lockedItems, visibleCatalogCount: catalogCount };
  }, [earned]);

  const toggleFeatured = async (code: string) => {
    if (!ctx || !ready) return;
    const next = featured.includes(code)
      ? featured.filter((c) => c !== code)
      : featured.length >= MAX_FEATURED
        ? featured
        : [...featured, code];
    if (!featured.includes(code) && featured.length >= MAX_FEATURED) {
      toast.error(`At most ${MAX_FEATURED} featured badges`);
      return;
    }
    setFeatSaving(true);
    try {
      await ProgressionService.setFeaturedBadges(ctx, next);
      setFeatured(next);
      toast.success(next.includes(code) ? "Added to featured" : "Removed from featured");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update featured badges");
    } finally {
      setFeatSaving(false);
    }
  };

  if (loading || progLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#78788c] text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading milestones…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <div className="p-4 rounded-2xl border border-white/7 bg-[#131316]/70 text-center">
          <div className="text-2xl font-black text-amber-400" style={{ fontFamily: "var(--font-display)" }}>
            {unlocked.length}
          </div>
          <div className="text-[11px] text-[#78788c] mt-0.5">Milestones reached</div>
        </div>
        <div className="p-4 rounded-2xl border border-white/7 bg-[#131316]/70 text-center">
          <div className="text-2xl font-black text-[#6882e8]" style={{ fontFamily: "var(--font-display)" }}>
            {visibleCatalogCount || "—"}
          </div>
          <div className="text-[11px] text-[#78788c] mt-0.5">Total in catalog</div>
        </div>
      </div>

      <GlassCard glow="amber" className="p-5">
        <SectionLabel>Featured badges</SectionLabel>
        <p className="text-[11px] text-[#78788c] mb-3">
          Showcase up to {MAX_FEATURED} earned badges on your profile ({featured.length}/{MAX_FEATURED}).
        </p>
        {featured.length === 0 ? (
          <div className="text-xs text-[#78788c]">None featured yet — star badges below.</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {featured.map((code) => (
              <EquippedBadge key={code} code={code} size="sm" showLabel />
            ))}
          </div>
        )}
      </GlassCard>

      {achievements.length > 0 && (
        <GlassCard className="p-5">
          <SectionLabel>Progression achievements</SectionLabel>
          <div className="space-y-2 mt-2">
            {achievements.map((a) => (
              <div
                key={a.code}
                className="flex items-start gap-3 p-3 rounded-xl border border-white/7 bg-white/2"
              >
                <Star className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-white">{a.label}</div>
                  {a.description && <div className="text-[11px] text-[#78788c] mt-0.5">{a.description}</div>}
                  <div className="text-[10px] text-[#78788c] mt-1 capitalize">
                    {a.rarity} · {formatEarnedDate(a.earned_at)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      <GlassCard glow="amber" className="p-5">
        <SectionLabel>Milestones reached</SectionLabel>
        {unlocked.length === 0 ? (
          <div className="text-center py-8 text-[#78788c] text-sm">No milestones reached yet. Keep learning and battling to earn badges.</div>
        ) : (
          <>
            <p className="text-[11px] text-[#78788c] mb-3">
              Equip one badge publicly. Star up to {MAX_FEATURED} as featured on your profile.
              {equipped ? ` Currently equipped: ${getBadge(equipped)?.label ?? equipped}.` : ""}
            </p>
            <div className="grid sm:grid-cols-2 gap-3">
              {unlocked.map((a) => {
                const Icon = a.icon;
                const tier = TIER_CLASS[a.tier];
                const isEquipped = equipped === a.code;
                const isFeatured = featured.includes(a.code);
                return (
                  <div
                    key={a.code}
                    className={cn(
                      "flex items-start gap-3 p-4 rounded-xl border",
                      isEquipped ? "border-amber-400/40 bg-amber-400/10" : "border-amber-400/15 bg-amber-400/5",
                    )}
                  >
                    <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white", tier.bg)}>
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-white">{a.label}</div>
                      <div className="text-[11px] text-[#78788c] mt-0.5">{a.desc}</div>
                      <div className="text-[11px] text-amber-400/80 mt-1.5">{formatEarnedDate(a.earned_at)}</div>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => void equip(isEquipped ? null : a.code)}
                          className={cn(
                            "text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-colors",
                            isEquipped
                              ? "border-amber-400/40 text-amber-300 bg-amber-400/10"
                              : "border-white/10 text-[#a0a0b0] hover:text-white hover:border-white/25",
                          )}
                        >
                          {isEquipped ? "Unequip" : "Equip"}
                        </button>
                        <button
                          type="button"
                          disabled={featSaving}
                          onClick={() => void toggleFeatured(a.code)}
                          className={cn(
                            "text-[10px] font-bold px-2.5 py-1 rounded-lg border transition-colors inline-flex items-center gap-1",
                            isFeatured
                              ? "border-amber-400/40 text-amber-300 bg-amber-400/10"
                              : "border-white/10 text-[#a0a0b0] hover:text-white hover:border-white/25",
                          )}
                        >
                          <Star className={cn("w-3 h-3", isFeatured && "fill-current")} />
                          {isFeatured ? "Featured" : "Feature"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Coming up</SectionLabel>
        {locked.length === 0 ? (
          <div className="text-center py-8 text-[#78788c] text-sm">You have unlocked every visible milestone.</div>
        ) : (
          <div className="space-y-3">
            {locked.map((a) => {
              const Icon = a.icon;
              return (
                <div key={a.code} className="flex items-start gap-3 p-4 rounded-xl border border-white/7 bg-white/2">
                  <span className="text-2xl shrink-0 opacity-40">
                    <Icon className="w-6 h-6" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-[#a0a0b0]">{a.label}</span>
                      <Lock className="w-3 h-3 text-[#78788c]" />
                    </div>
                    <div className="text-[11px] text-[#78788c] mt-0.5">{a.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>
    </div>
  );
}
