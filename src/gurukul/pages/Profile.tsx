import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { GlassCard, LoadingState, PageHeader, PageSkeleton, SectionLabel, Skeleton, SkeletonCard, XPBar, cn } from "@/gurukul/components/shared";
import { ProgressionService, useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useStudentBadges } from "@/hooks/useStudentBadges";
import { getBadge, TIER_CLASS } from "@/lib/badges";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { progressionLevelProgress } from "@/academic/services/progressionMath";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import { useGurukulAcademicIdentity } from "@/gurukul/StudentContext";
import { Link } from "react-router-dom";
import { LEGAL_ENTITY } from "@/lib/legal";
import { toInitials, toPersonName } from "@/lib/presentation/people";
import { StudentAvatar } from "@/components/student/StudentAvatar";
import { ProfilePhotoEditor } from "@/components/student/ProfilePhotoEditor";
import { useProfilePhoto } from "@/hooks/useProfilePhoto";

/** One date format for this screen. */
function formatDayMonthYear(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Student Profile — the individual student's record.
 * Level/XP/league/streak from ProgressionService (rpc_get_student_progression).
 * Milestones from live student_badges + featured badges from progression snapshot.
 * The school student's blocks — homework, test and exam marks, teacher
 * remarks, class rank, roll number, parent contact and the Doubt Portal's
 * helper points — are kept on the `organisation` branch (2026-10-01).
 */
export default function Profile({
  screenCaptureSlot,
}: {
  /** Android-only Stage 1/2 capture controls (mounted from StudentDashboard). */
  screenCaptureSlot?: ReactNode;
}) {
  const { user, signOut } = useAuth();
  const { ctx, ready, studentId } = useAcademicContext();
  const { examName, examCode } = useGurukulAcademicIdentity();
  const { earned, loading: badgesLoading } = useStudentBadges(user?.id);
  const photo = useProfilePhoto(user?.id);
  const [name, setName] = useState("Student");
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState(1);
  const [xp, setXp] = useState(0);
  const [xpIntoLevel, setXpIntoLevel] = useState(0);
  const [xpToNext, setXpToNext] = useState(0);
  const [levelProgressPct, setLevelProgressPct] = useState(0);
  const [league, setLeague] = useState("");
  const [streak, setStreak] = useState(0);
  const [featured, setFeatured] = useState<string[]>([]);

  const recentMilestones = useMemo(
    () =>
      earned
        .map((e) => {
          const meta = getBadge(e.badge_code);
          if (!meta) return null;
          return { ...meta, earned_at: e.earned_at };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .slice(0, 6),
    [earned],
  );

  const liveVersion = useAcademicLive(["xp", "achievements", "profile"]);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate([studentId, user?.id]);

  const loadProfile = useCallback(async () => {
    // Still resolving is not loaded: the skeleton stays up rather than an
    // empty profile reading as a real one.
    if (!ready) return;
    if (!ctx || !studentId) {
      endLoading(setLoading);
      return;
    }
    beginLoading(setLoading);
    try {
      const settled = await Promise.allSettled([
        supabase
          .from("students_current")
          .select("full_name")
          .eq("id", studentId)
          .maybeSingle(),
        ProgressionService.getSnapshot(ctx, user?.id ?? undefined),
      ]);
      const sRes = settled[0].status === "fulfilled" ? settled[0].value : null;
      const prog = settled[1].status === "fulfilled" ? settled[1].value : null;
      setName(toPersonName(sRes?.data?.full_name, { kind: "student", fallback: "Student" }));
      if (prog) {
        const derived = progressionLevelProgress(prog.xp, prog.level);
        setLevel(prog.level);
        setXp(prog.xp);
        setXpIntoLevel(prog.xp_into_level ?? derived.xpIntoLevel);
        setXpToNext(prog.xp_to_next_level ?? derived.xpToNextLevel);
        setLevelProgressPct(prog.level_progress_pct ?? derived.levelProgressPct);
        setLeague(prog.league?.label ?? prog.league?.code ?? "");
        setStreak(prog.study_streak);
        setFeatured(Array.isArray(prog.featured_badges) ? prog.featured_badges : []);
      }
    } catch (e) {
      // G10: was `/* empty */`. Non-fatal — the profile renders what loaded —
      // but the failure is now identifiable.
      console.warn("[profile] load failed:", e instanceof Error ? e.message : e);
    } finally {
      endLoading(setLoading);
    }
  }, [ready, ctx, studentId, user?.id, beginLoading, endLoading]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile, liveVersion]);

  useEffect(() => {
    const onXp = () => {
      void loadProfile();
    };
    window.addEventListener("student-xp-updated", onXp);
    return () => window.removeEventListener("student-xp-updated", onXp);
  }, [loadProfile]);

  // The title needs no network, so it no longer waits for one.
  const header = (
    <PageHeader
      title="Profile"
      subtitle="Your record, your progress and your milestones."
    />
  );

  if (showLoading(loading)) {
    return (
      <div className="space-y-5">
        {header}
        <PageSkeleton label="Loading profile">
          <SkeletonCard className="p-6 space-y-4">
            <div className="flex items-start gap-4">
              <Skeleton className="w-16 h-16 rounded-2xl shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-3 w-36" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
            <Skeleton className="h-2 w-full" />
          </SkeletonCard>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} className="p-4 space-y-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-16" />
              </SkeletonCard>
            ))}
          </div>
          <SkeletonCard className="p-5 space-y-3">
            <Skeleton className="h-3 w-40" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-14" />
              </div>
            ))}
          </SkeletonCard>
        </PageSkeleton>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {header}
      <GlassCard glow="blue" className="p-6">
        <div className="flex items-start gap-4">
          {/* The photo, or the initials — worked out by toInitials, as the top bar
              does; this card used to slice the name itself. */}
          <div
            className="w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center text-xl font-black text-foreground shrink-0"
            style={{ background: "linear-gradient(135deg, hsl(var(--primary)), hsl(var(--primary) / 0.8))" }}
          >
            <StudentAvatar url={photo.url} initials={toInitials(name)} iconClassName="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h2
              className="text-xl font-black text-foreground leading-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {name}
            </h2>
            <div className="text-sm text-muted-foreground">{examName || examCode || ""}</div>
            <div className="text-xs text-primary mt-0.5">
              Level {level}
              {league ? ` · ${league}` : ""}
              {` · ${xp} XP · Streak ${streak}d`}
            </div>
            <div className="mt-3">
              <XPBar
                xp={xp}
                level={level}
                xpIntoLevel={xpIntoLevel}
                xpToNext={xpToNext}
                progressPct={levelProgressPct}
              />
            </div>
            <ProfilePhotoEditor hasPhoto={photo.hasPhoto} onSave={photo.save} onRemove={photo.remove} />
            {featured.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {featured.map((code) => (
                  <EquippedBadge key={code} code={code} size="sm" showLabel />
                ))}
              </div>
            )}
          </div>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Recent milestones</SectionLabel>
        {badgesLoading ? (
          <LoadingState label="Loading badges…" variant="section" />
        ) : recentMilestones.length === 0 ? (
          <div className="text-xs text-muted-foreground">No badges earned yet.</div>
        ) : (
          <div className="flex flex-wrap gap-3">
            {recentMilestones.map((a) => {
              const Icon = a.icon;
              const tier = TIER_CLASS[a.tier];
              return (
                <div
                  key={a.code}
                  title={a.label}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-400/15 bg-amber-400/5"
                >
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-foreground shrink-0", tier.bg)}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-foreground">{a.label}</div>
                    <div className="text-[10px] text-muted-foreground">{formatDayMonthYear(a.earned_at)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </GlassCard>

      {/*
        SIGN OUT.

        The only way out of this panel was the account menu in the shell's
        header. Profile is where people look for it, and it was the one screen
        that could not do it. Last card on the page, because it ends the session
        rather than telling you anything about yourself.
      */}
      {screenCaptureSlot}

      {/* HELP. The only way to reach anyone was the legal pages' small print. */}
      <GlassCard className="p-5">
        <SectionLabel>Help &amp; support</SectionLabel>
        <p className="text-xs text-muted-foreground">
          A question about your account, a payment or a refund? Email us and we reply within 2 working days.
        </p>
        <a
          href={`mailto:${LEGAL_ENTITY.supportEmail}`}
          className="mt-3 inline-flex items-center rounded-xl border border-border px-4 py-2 text-xs font-semibold text-primary hover:bg-muted transition-colors"
        >
          {LEGAL_ENTITY.supportEmail}
        </a>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <Link to="/terms" className="inline-block py-1 text-muted-foreground underline underline-offset-2 hover:text-foreground">Terms of use</Link>
          <Link to="/refund-policy" className="inline-block py-1 text-muted-foreground underline underline-offset-2 hover:text-foreground">Refund policy</Link>
          <Link to="/privacy" className="inline-block py-1 text-muted-foreground underline underline-offset-2 hover:text-foreground">Privacy policy</Link>
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Account</SectionLabel>
        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">End this session on this device.</div>
          <button
            type="button"
            onClick={() => void signOut()}
            className="shrink-0 px-4 py-2 rounded-xl text-xs font-semibold text-destructive bg-destructive/10 hover:bg-destructive/20 border border-destructive/25 transition-colors"
          >
            Sign out
          </button>
        </div>
      </GlassCard>
    </div>
  );
}
