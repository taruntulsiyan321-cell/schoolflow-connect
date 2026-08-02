import { useCallback, useEffect, useMemo, useState } from "react";
import type { PageKey } from "@/gurukul/nav";
import { GlassCard, SectionLabel, XPBar, cn } from "@/gurukul/components/shared";
import { Trophy, Target, Medal, Loader2, ArrowRight } from "lucide-react";
import { AcademicProfileService, AnalyticsService, ProgressionService, useAcademicLive } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useStudentBadges } from "@/hooks/useStudentBadges";
import { getBadge, TIER_CLASS } from "@/lib/badges";
import { EquippedBadge } from "@/components/battleground/EquippedBadge";
import { progressionLevelProgress } from "@/academic/services/progressionMath";

function formatEarnedDate(iso: string) {
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
  const [attPct, setAttPct] = useState(0);
  const [examAvg, setExamAvg] = useState(0);
  const [hwPct, setHwPct] = useState(0);
  const [testsAvg, setTestsAvg] = useState(0);
  const [loading, setLoading] = useState(true);
  const [level, setLevel] = useState(1);
  const [xp, setXp] = useState(0);
  const [xpIntoLevel, setXpIntoLevel] = useState(0);
  const [xpToNext, setXpToNext] = useState(0);
  const [levelProgressPct, setLevelProgressPct] = useState(0);
  const [league, setLeague] = useState("Bronze");
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

  useEffect(() => {
    if (!ready || !ctx || !studentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const settled = await Promise.allSettled([
          supabase
            .from("students")
            .select("full_name, roll_number, classes(name, section)")
            .eq("id", studentId)
            .maybeSingle(),
          AcademicProfileService.get(ctx, studentId),
          AnalyticsService.forStudent(ctx, studentId),
          ProgressionService.getForStudent(ctx, studentId),
          ProgressionService.leaderboard(ctx, {
            scope: "class",
            period: "lifetime",
            metric: "xp",
            limit: 200,
          }),
        ]);
        if (cancelled) return;
        const sRes = settled[0].status === "fulfilled" ? settled[0].value : null;
        const s = sRes?.data;
        const profile = settled[1].status === "fulfilled" ? settled[1].value : null;
        const analytics = settled[2].status === "fulfilled" ? settled[2].value : null;
        const prog = settled[3].status === "fulfilled" ? settled[3].value : null;
        const lb = settled[4].status === "fulfilled" ? settled[4].value : null;
        setName(s?.full_name ?? "Student");
        const cls = s?.classes as { name?: string; section?: string } | null;
        setClassLabel(
          cls ? `${cls.name ?? ""} ${cls.section ?? ""} · Roll ${s?.roll_number ?? "—"}` : "",
        );
        setAttPct(Math.round(profile?.attendancePct ?? analytics?.attendance.pct ?? 0));
        setExamAvg(Math.round(analytics?.exams.averagePct ?? 0));
        setHwPct(Math.round(analytics?.homework.pct ?? 0));
        setTestsAvg(Math.round(analytics?.tests.averagePct ?? 0));
        if (prog) {
          setLevel(prog.level);
          setXp(prog.xp);
          setXpIntoLevel(prog.xp_into_level);
          setXpToNext(prog.xp_to_next_level);
          setLevelProgressPct(prog.level_progress_pct);
          setLeague(prog.league?.label ?? prog.league?.code ?? "Bronze");
          setStreak(prog.study_streak);
          setReputation(prog.reputation);
          setFeatured(Array.isArray(prog.featured_badges) ? prog.featured_badges : []);
        }
        if (lb && user?.id) {
          const i = lb.rows.findIndex((r) => r.user_id === user.id);
          setClassRank(i >= 0 ? i + 1 : null);
        }
      } catch {
        /* empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId, user?.id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#78788c] text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading profile…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <GlassCard glow="blue" className="p-6">
        <div className="flex items-start gap-4">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center text-xl font-black text-white shrink-0"
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
              className="text-xl font-black text-white leading-tight"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {name}
            </h2>
            <div className="text-sm text-[#78788c]">{classLabel}</div>
            <div className="text-xs text-[#3b5bdb] mt-0.5">
              Level {level} · {league} · {xp} XP · Streak {streak}d · Rep {reputation}
              {classRank != null ? ` · Rank #${classRank}` : ""}
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

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Attendance", value: `${attPct}%`, color: "#4aa87a", icon: <Trophy className="w-4 h-4" /> },
          { label: "Exam avg", value: `${examAvg}%`, color: "#6882e8", icon: <Target className="w-4 h-4" /> },
          { label: "Homework", value: `${hwPct}%`, color: "#c08a3a", icon: <Medal className="w-4 h-4" /> },
          { label: "Tests avg", value: `${testsAvg}%`, color: "#4b9fd4", icon: <Target className="w-4 h-4" /> },
        ].map((s) => (
          <div key={s.label} className="p-4 rounded-2xl border border-white/7 bg-[#131316]/70">
            <div className="flex items-center gap-2 mb-1" style={{ color: s.color }}>
              {s.icon}
              <span className="text-[10px] uppercase tracking-wider text-[#78788c]">{s.label}</span>
            </div>
            <div
              className="text-xl font-black tabular-nums"
              style={{ color: s.color, fontFamily: "var(--font-display)" }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      <GlassCard className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <SectionLabel>Rankings</SectionLabel>
          {setPage && (
            <button
              onClick={() => setPage("leaderboard")}
              className={cn("ml-auto flex items-center gap-1 text-[10px] text-[#3b5bdb]")}
            >
              View <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
        <div className="text-xs text-[#78788c]">
          {classRank != null
            ? `Your class XP rank is #${classRank} (Progression Engine).`
            : "Class XP rankings load from ProgressionService on the Rankings page."}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Recent milestones</SectionLabel>
        {badgesLoading ? (
          <div className="flex items-center gap-2 text-[#78788c] text-xs py-2">
            <Loader2 className="w-3 h-3 animate-spin" /> Loading badges…
          </div>
        ) : recentMilestones.length === 0 ? (
          <div className="text-xs text-[#78788c]">No badges earned yet.</div>
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
                  <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0", tier.bg)}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white">{a.label}</div>
                    <div className="text-[10px] text-[#78788c]">{formatEarnedDate(a.earned_at)}</div>
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
