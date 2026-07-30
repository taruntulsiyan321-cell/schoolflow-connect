import { useEffect, useMemo, useState } from "react";
import { Loader2, Trophy, Zap } from "lucide-react";
import { AcademicProfileService } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard, SectionLabel, ProgressBar, cn } from "@/gurukul/components/shared";

/**
 * Class rankings from AcademicProfileService (class roster profiles).
 * No mock leaderboard XP.
 */
export default function Leaderboard() {
  const { ctx, ready, studentId, classId } = useAcademicContext();
  const [rows, setRows] = useState<
    { studentId: string; name: string; exams: number; attendance: number; homework: number; you: boolean }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        let profiles: Awaited<ReturnType<typeof AcademicProfileService.listForClass>> = [];
        if (classId) {
          profiles = await AcademicProfileService.listForClass(ctx, classId, { limit: 100 });
        }
        const ids = profiles.map((p) => p.studentId);
        const { data: students } = ids.length
          ? await supabase.from("students").select("id, full_name").in("id", ids)
          : { data: [] as { id: string; full_name: string }[] };
        const nameById = new Map((students ?? []).map((s) => [s.id, s.full_name]));
        if (cancelled) return;
        setRows(
          profiles
            .map((p) => ({
              studentId: p.studentId,
              name: nameById.get(p.studentId) ?? p.studentId.slice(0, 8),
              exams: Math.round(p.examsAvgPct),
              attendance: Math.round(p.attendancePct),
              homework: Math.round(p.homeworkCompletionPct),
              you: p.studentId === studentId,
            }))
            .sort((a, b) => b.exams - a.exams),
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load rankings");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, classId, studentId]);

  const ranked = useMemo(
    () => rows.map((r, i) => ({ ...r, rank: i + 1 })),
    [rows],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#78788c] text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading rankings…
      </div>
    );
  }

  if (error) {
    return <div className="text-center text-sm text-[#cc5069] py-16">{error}</div>;
  }

  return (
    <div className="space-y-5">
      <GlassCard className="p-5">
        <SectionLabel>Class rankings · AcademicProfileService</SectionLabel>
        {ranked.length === 0 && (
          <div className="text-xs text-[#46465a] py-8 text-center">
            No class academic profiles available yet. Rankings appear once profiles sync.
          </div>
        )}
        <div className="space-y-2">
          {ranked.map((p) => (
            <div
              key={p.studentId}
              className={cn(
                "flex items-center gap-3 p-3 rounded-xl border transition-colors",
                p.you ? "border-blue-500/30 bg-blue-500/8" : "border-white/7 hover:border-white/12",
              )}
            >
              <div className="w-7 h-7 flex items-center justify-center shrink-0">
                {p.rank <= 3 ? (
                  <Trophy
                    className={cn(
                      "w-4 h-4",
                      p.rank === 1 ? "text-amber-400" : p.rank === 2 ? "text-slate-400" : "text-orange-400",
                    )}
                  />
                ) : (
                  <span className="text-xs font-black text-[#78788c]">#{p.rank}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={cn("text-sm font-semibold", p.you ? "text-blue-300" : "text-white")}>
                    {p.name}
                  </span>
                  {p.you && (
                    <span className="text-[9px] text-blue-400 bg-blue-400/10 px-1.5 py-0.5 rounded-full font-semibold">
                      YOU
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <ProgressBar value={p.exams} color="#6882e8" height="h-1" />
                  <span className="text-[11px] text-[#78788c] shrink-0">{p.exams}% exams</span>
                </div>
              </div>
              <div className="text-right shrink-0 text-[11px] text-[#78788c]">
                <div className="flex items-center gap-1 justify-end text-white font-bold">
                  <Zap className="w-3 h-3 text-amber-400" />
                  {p.attendance}% att
                </div>
                <div className="mt-0.5">{p.homework}% HW</div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  );
}
