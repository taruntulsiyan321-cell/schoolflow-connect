import { useCallback, useEffect, useMemo, useState } from "react";
import type { PageKey } from "@/gurukul/nav";
import { GlassCard, LoadingState, PageHeader, PageSkeleton, SectionLabel, Skeleton, SkeletonCard, XPBar, cn } from "@/gurukul/components/shared";
import { ArrowRight } from "lucide-react";
import {
  ProgressionService,
  TestService, MarksService, HomeworkService, RemarksService,
  useAcademicLive,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useStudentBadges } from "@/hooks/useStudentBadges";
import { getBadge, TIER_CLASS } from "@/lib/badges";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { progressionLevelProgress } from "@/academic/services/progressionMath";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";

/**
 * One date format for this screen. Named for what it renders rather than for
 * the first thing that happened to call it — it was `formatEarnedDate`, badge
 * language, which is why the test-marks list below wrote no date at all rather
 * than reach for a function that sounded like it belonged to something else.
 */
function formatDayMonthYear(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Student Profile — academic metrics from Academic Engine.
 * Level/XP/league/streak/reputation from ProgressionService (rpc_get_student_progression).
 * Milestones from live student_badges + featured badges from progression snapshot.
 */
export default function Profile({ setPage }: { setPage?: (p: PageKey) => void }) {
  const { user } = useAuth();
  const { ctx, ready, studentId } = useAcademicContext();
  const { earned, loading: badgesLoading } = useStudentBadges(user?.id);
  const [name, setName] = useState("Student");
  const [classLabel, setClassLabel] = useState("");
  const [rollNumber, setRollNumber] = useState<string | null>(null);
  const [parentName, setParentName] = useState<string | null>(null);
  const [parentPhone, setParentPhone] = useState<string | null>(null);
  const [testMarks, setTestMarks] = useState<
    { testId: string; title: string; mark: number | null; maxMark: number | null; takenAt: string | null }[]
  >([]);
  const [examMarks, setExamMarks] = useState<
    { id: string; label: string; obtained: number | null; max: number | null }[]
  >([]);
  const [hwDone, setHwDone] = useState(0);
  const [hwMissing, setHwMissing] = useState(0);
  const [remarks, setRemarks] = useState<{ id: string; text: string; author: string; at: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState(1);
  const [xp, setXp] = useState(0);
  const [xpIntoLevel, setXpIntoLevel] = useState(0);
  const [xpToNext, setXpToNext] = useState(0);
  const [levelProgressPct, setLevelProgressPct] = useState(0);
  const [league, setLeague] = useState("");
  const [streak, setStreak] = useState(0);
  const [reputation, setReputation] = useState(0);
  const [featured, setFeatured] = useState<string[]>([]);
  const [classRank, setClassRank] = useState<number | null>(null);

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
    if (!ready || !ctx || !studentId) {
      endLoading(setLoading);
      return;
    }
    beginLoading(setLoading);
    try {
      const settled = await Promise.allSettled([
        supabase
          .from("students_current")
          .select("full_name, roll_number, parent_name, parent_mobile, classes(name, section)")
          .eq("id", studentId)
          .maybeSingle(),
        ProgressionService.getSnapshot(ctx, user?.id ?? undefined),
        ProgressionService.leaderboard(ctx, {
          scope: "class",
          period: "lifetime",
          metric: "xp",
          limit: 200,
        }),
        TestService.listMarksForStudent(ctx, studentId, 10),
        MarksService.listForStudent(ctx, studentId, { limit: 50 }),
        HomeworkService.listForStudent(ctx, studentId),
        RemarksService.listForStudent(ctx, studentId),
      ]);
      const sRes = settled[0].status === "fulfilled" ? settled[0].value : null;
      const s = sRes?.data;
      const prog = settled[1].status === "fulfilled" ? settled[1].value : null;
      const lb = settled[2].status === "fulfilled" ? settled[2].value : null;
      setName(s?.full_name ?? "Student");
      const cls = s?.classes as { name?: string; section?: string } | null;
      setClassLabel(cls ? `${cls.name ?? ""} ${cls.section ?? ""}`.trim() : "");
      setRollNumber(s?.roll_number != null ? String(s.roll_number) : null);
      setParentName(s?.parent_name ? String(s.parent_name) : null);
      setParentPhone(s?.parent_mobile ? String(s.parent_mobile) : null);

      const tm = settled[3].status === "fulfilled" ? settled[3].value : [];
      setTestMarks(Array.isArray(tm) ? tm : []);

      // MarksRecord carries examId and nothing readable, so the exam's own name
      // and maximum are resolved here. `exams_read` already fences this to the
      // student's own school.
      const em = settled[4].status === "fulfilled" ? settled[4].value : [];
      const emRows = Array.isArray(em) ? em : [];
      const examIds = [...new Set(emRows.map((m) => m.examId).filter(Boolean))];
      const examMeta = new Map<string, { name: string; max: number | null }>();
      if (examIds.length) {
        const { data: exRows, error: exErr } = await supabase
          .from("exams")
          .select("id, name, subject, max_marks")
          .in("id", examIds);
        if (exErr) console.warn("[profile] exam names:", exErr.message);
        for (const e of (exRows ?? []) as Record<string, unknown>[]) {
          examMeta.set(String(e.id), {
            name: String(e.subject ?? e.name ?? "Exam"),
            max: e.max_marks == null ? null : Number(e.max_marks),
          });
        }
      }
      setExamMarks(
        emRows.map((m) => ({
          id: m.id,
          label: examMeta.get(m.examId)?.name ?? "Exam",
          // NULL is "not marked" and is never 0 (§7).
          obtained: m.marksObtained == null ? null : Number(m.marksObtained),
          max: examMeta.get(m.examId)?.max ?? null,
        })),
      );

      // Counts, not a percentage (v2 Screen 12). `displayStatus` is the
      // service's own derived state — recomputing it here would be a second
      // home for the same rule (G9).
      const hw = settled[5].status === "fulfilled" ? settled[5].value : [];
      const hwRows = Array.isArray(hw) ? hw : [];
      const handedIn = (st: string) => st === "Submitted" || st === "Reviewed" || st === "Graded";
      setHwDone(hwRows.filter((h) => handedIn(h.displayStatus)).length);
      setHwMissing(hwRows.filter((h) => !handedIn(h.displayStatus)).length);

      const rm = settled[6].status === "fulfilled" ? settled[6].value : [];
      setRemarks(
        (Array.isArray(rm) ? rm : []).map((r) => ({
          id: r.id,
          text: r.body,
          author: r.remarkType || "Remark",
          at: r.createdAt ?? null,
        })),
      );
      if (prog) {
        const derived = progressionLevelProgress(prog.xp, prog.level);
        setLevel(prog.level);
        setXp(prog.xp);
        setXpIntoLevel(prog.xp_into_level ?? derived.xpIntoLevel);
        setXpToNext(prog.xp_to_next_level ?? derived.xpToNextLevel);
        setLevelProgressPct(prog.level_progress_pct ?? derived.levelProgressPct);
        setLeague(prog.league?.label ?? prog.league?.code ?? "");
        setStreak(prog.study_streak);
        setReputation(prog.reputation);
        setFeatured(Array.isArray(prog.featured_badges) ? prog.featured_badges : []);
      }
      if (lb && user?.id) {
        const i = lb.rows.findIndex((r) => r.user_id === user.id);
        setClassRank(i >= 0 ? i + 1 : null);
      }
    } catch (e) {
      // G10: was `/* empty */`. Non-fatal — the profile renders without a rank —
      // but the failure is now identifiable.
      console.warn("[profile] class rank lookup failed:", e instanceof Error ? e.message : e);
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
    <PageHeader title="Profile" subtitle="Your record, your marks and your milestones." />
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
          <div className="grid sm:grid-cols-2 gap-3">
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
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-black text-foreground shrink-0"
            style={{ background: "linear-gradient(135deg,#3b5bdb,#6882e8)" }}
          >
            {name
              .split(" ")
              .map((w) => w[0])
              .slice(0, 2)
              .join("")}
          </div>
          <div className="flex-1 min-w-0">
            <h2
              className="text-xl font-black text-foreground leading-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {name}
            </h2>
            <div className="text-sm text-muted-foreground">
              {classLabel}
              {rollNumber ? ` · Roll ${rollNumber}` : ""}
            </div>
            {/*
              "Rep 8" was unexplained and had never been specced. Measured before
              touching it: it is COMMUNITY reputation, earned in the Doubt Portal
              — answers x20, upvotes x5, accepted answers x80, computed by
              `_community_refresh_reputation` and written by three RPCs. It is
              live and earned (nine students at 10, one at 24, one at 130), so it
              stays. It just says what it is now.
            */}
            <div className="text-xs text-primary mt-0.5">
              Level {level}
              {league ? ` · ${league}` : ""}
              {` · ${xp} XP · Streak ${streak}d`}
              {reputation > 0 ? ` · ${reputation} helper points` : ""}
              {classRank != null ? ` · Class rank #${classRank}` : ""}
            </div>
            {/*
              Parent contact. Present for 10 of 223 students today, so it is
              rendered on presence rather than as a permanently blank field.
            */}
            {(parentName || parentPhone) && (
              <div className="text-xs text-muted-foreground mt-1">
                Parent: {parentName ?? "—"}
                {parentPhone ? ` · ${parentPhone}` : ""}
              </div>
            )}
            <div className="mt-3">
              <XPBar
                xp={xp}
                level={level}
                xpIntoLevel={xpIntoLevel}
                xpToNext={xpToNext}
                progressPct={levelProgressPct}
              />
            </div>
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

      {/*
        THE FOUR AVERAGES ARE GONE (v2 Screen 12): Attendance 100%, Exam avg 80%,
        Homework 90%, Tests avg 0%. The last one is the reason the rule exists —
        the student had taken no tests, and "0%" claims they took them and scored
        nothing. Averages are banned product-wide; the profile shows the actual
        marks and honest counts instead.
      */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div className="p-4 rounded-2xl border border-border/70 bg-surface/70">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Homework handed in</div>
          <div className="text-2xl font-black tabular-nums text-foreground">{hwDone}</div>
        </div>
        <div className="p-4 rounded-2xl border border-border/70 bg-surface/70">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Not submitted</div>
          <div className="text-2xl font-black tabular-nums text-foreground">{hwMissing}</div>
        </div>
      </div>

      <GlassCard className="p-5">
        <SectionLabel>Last 10 test marks</SectionLabel>
        {testMarks.length === 0 ? (
          <div className="text-xs text-muted-foreground">No tests marked yet.</div>
        ) : (
          <div className="space-y-2">
            {/* The date was fetched and thrown away.
                `takenAt` came back on every row and nothing rendered it, so ten
                tests were ten identical-looking lines of title-plus-number with
                no way to tell which was recent, and two tests a teacher named
                similarly were indistinguishable. A mark means nothing without
                when it was taken. */}
            {testMarks.map((t) => (
              <div key={t.testId} className="flex items-center gap-3 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="truncate text-foreground">{t.title}</div>
                  {t.takenAt && (
                    <div className="text-[11px] text-muted-foreground">{formatDayMonthYear(t.takenAt)}</div>
                  )}
                </div>
                <span className="tabular-nums font-bold text-foreground shrink-0">
                  {t.mark == null ? "—" : `${t.mark}${t.maxMark != null ? ` / ${t.maxMark}` : ""}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Exam marks</SectionLabel>
        {examMarks.length === 0 ? (
          <div className="text-xs text-muted-foreground">No exam marks published yet.</div>
        ) : (
          <div className="space-y-2">
            {examMarks.map((m) => (
              <div key={m.id} className="flex items-center gap-3 text-sm">
                <span className="flex-1 min-w-0 truncate text-foreground">{m.label}</span>
                <span className="tabular-nums font-bold text-foreground shrink-0">
                  {m.obtained == null ? "—" : `${m.obtained}${m.max != null ? ` / ${m.max}` : ""}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/*
        TEACHER REMARKS. Rendered only when there are some.

        `teacher_remarks` holds ZERO rows platform-wide and no teacher-facing
        screen writes to it, so an always-visible panel would be permanently
        blank for every student at every school — which reads as a broken app,
        not an empty one. Rendering on presence means it appears by itself the
        day a teacher can write one, with no second change needed here.
      */}
      {remarks.length > 0 && (
        <GlassCard className="p-5">
          <SectionLabel>Teacher remarks</SectionLabel>
          <div className="space-y-3">
            {remarks.map((r) => (
              <div key={r.id} className="p-3 rounded-xl border border-border/70 bg-surface/60">
                <div className="text-sm text-foreground">{r.text}</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {r.author}{r.at ? ` · ${formatDayMonthYear(r.at)}` : ""}
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      <GlassCard className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <SectionLabel>Rankings</SectionLabel>
          {setPage && (
            <button
              onClick={() => setPage("leaderboard")}
              className={cn("ml-auto flex items-center gap-1 text-[10px] text-primary")}
            >
              View <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="text-xs text-muted-foreground">
          {/* The fallback named ProgressionService to the student. Same defect
              as KNOWN_ISSUES 24, which was fixed for the parent panel. */}
          {classRank != null
            ? `Your class XP rank is #${classRank}.`
            : "You'll get a class rank once you've earned some XP. See where you stand on Rankings."}
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
    </div>
  );
}
