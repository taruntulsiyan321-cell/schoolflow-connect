import { useEffect, useState } from "react";
import { achievements } from "@/gurukul/data/mock";
import type { PageKey } from "@/gurukul/data/mock";
import { GlassCard, SectionLabel, cn } from "@/gurukul/components/shared";
import { Trophy, Target, Medal, Loader2, ArrowRight } from "lucide-react";
import { AcademicProfileService, AnalyticsService } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { supabase } from "@/integrations/supabase/client";

/**
 * Student Profile — academic metrics from Academic Engine.
 * Achievements remain presentation/gamification (non-engine).
 */
export default function Profile({ setPage }: { setPage?: (p: PageKey) => void }) {
  const { ctx, ready, studentId } = useAcademicContext();
  const [name, setName] = useState("Student");
  const [classLabel, setClassLabel] = useState("");
  const [attPct, setAttPct] = useState(0);
  const [examAvg, setExamAvg] = useState(0);
  const [hwPct, setHwPct] = useState(0);
  const [testsAvg, setTestsAvg] = useState(0);
  const [loading, setLoading] = useState(true);
  const unlocked = achievements.filter((a) => a.unlocked);

  useEffect(() => {
    if (!ready || !ctx || !studentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [{ data: s }, profile, analytics] = await Promise.all([
          supabase
            .from("students")
            .select("full_name, roll_number, classes(name, section)")
            .eq("id", studentId)
            .maybeSingle(),
          AcademicProfileService.get(ctx, studentId),
          AnalyticsService.forStudent(ctx, studentId),
        ]);
        if (cancelled) return;
        setName(s?.full_name ?? "Student");
        const cls = s?.classes as { name?: string; section?: string } | null;
        setClassLabel(
          cls ? `${cls.name ?? ""} ${cls.section ?? ""} · Roll ${s?.roll_number ?? "—"}` : "",
        );
        setAttPct(Math.round(profile?.attendancePct ?? analytics.attendance.pct));
        setExamAvg(Math.round(analytics.exams.averagePct));
        setHwPct(Math.round(analytics.homework.pct));
        setTestsAvg(Math.round(analytics.tests.averagePct));
      } catch {
        /* empty */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId]);

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
            <div className="text-xs text-[#3b5bdb] mt-0.5">Academic Engine profile</div>
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
          Class rankings load from AcademicProfileService on the Rankings page.
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <SectionLabel>Recent milestones</SectionLabel>
        <div className="flex flex-wrap gap-3">
          {unlocked.map((a) => (
            <div
              key={a.id}
              title={a.title}
              className="flex items-center gap-2 px-3 py-2 rounded-xl border border-amber-400/15 bg-amber-400/5"
            >
              <span className="text-lg">{a.icon}</span>
              <div>
                <div className="text-xs font-semibold text-white">{a.title}</div>
                <div className="text-[10px] text-[#78788c]">
                  +{a.xp} XP · {a.date}
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
