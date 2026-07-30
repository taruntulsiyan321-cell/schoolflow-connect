import { useEffect, useMemo, useState } from "react";
import { Loader2, Trophy, BarChart2 } from "lucide-react";
import {
  AnalyticsService,
  MarksService,
  TestService,
  type MarksRecord,
} from "@/academic";
import type { ExamRecord } from "@/academic/repository/marksRepository";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { GlassCard, SectionLabel, SubjectBadge, subjectColor, cn } from "@/gurukul/components/shared";

/**
 * Student Tests — MarksService + TestService + AnalyticsService (no mock tests / ranks).
 */
export default function Tests() {
  const { ctx, ready, studentId, classId } = useAcademicContext();
  const [marks, setMarks] = useState<MarksRecord[]>([]);
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [upcoming, setUpcoming] = useState<{ id: string; title: string; subject: string }[]>([]);
  const [avgPct, setAvgPct] = useState(0);
  const [testsAvg, setTestsAvg] = useState(0);
  const [filter, setFilter] = useState<"all" | "graded" | "upcoming">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx || !studentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [markRows, analytics, examRows, tests] = await Promise.all([
          MarksService.listForStudent(ctx, studentId, { limit: 100 }),
          AnalyticsService.forStudent(ctx, studentId),
          classId ? MarksService.listExamsForClass(ctx, classId, { limit: 50 }) : Promise.resolve([]),
          classId ? TestService.listForClass(ctx, classId) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        setMarks(markRows);
        setExams(examRows);
        setAvgPct(Math.round(analytics.exams.averagePct));
        setTestsAvg(Math.round(analytics.tests.averagePct));
        setUpcoming(
          (tests as { id: string; title: string; subject?: string }[]).map((t) => ({
            id: t.id,
            title: t.title,
            subject: t.subject ?? "—",
          })),
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load tests");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId, classId]);

  const examById = useMemo(() => new Map(exams.map((e) => [e.id, e])), [exams]);

  const bySubject = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const m of marks) {
      const exam = examById.get(m.examId);
      const key = exam?.subject || "General";
      const max = exam?.maxMarks ?? 100;
      const pct = max ? (m.marksObtained / max) * 100 : 0;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(pct);
    }
    return [...map.entries()].map(([subject, vals]) => ({
      subject,
      score: Math.round(vals.reduce((a, b) => a + b, 0) / vals.length),
    }));
  }, [marks, examById]);

  if (!ready || loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#78788c] text-xs gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading tests…
      </div>
    );
  }

  if (!studentId) {
    return (
      <div className="text-center text-sm text-[#78788c] py-16">
        No student profile linked to this account.
      </div>
    );
  }

  if (error) {
    return <div className="text-center text-sm text-[#cc5069] py-16">{error}</div>;
  }

  const showGraded = filter === "all" || filter === "graded";
  const showUpcoming = filter === "all" || filter === "upcoming";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <GlassCard className="p-4 text-center">
          <div className="text-2xl font-black text-white">{avgPct}%</div>
          <div className="text-[10px] text-[#78788c]">Exam avg (AnalyticsService)</div>
        </GlassCard>
        <GlassCard className="p-4 text-center">
          <div className="text-2xl font-black text-[#6882e8]">{testsAvg}%</div>
          <div className="text-[10px] text-[#78788c]">Tests avg</div>
        </GlassCard>
        <GlassCard className="p-4 text-center">
          <div className="text-2xl font-black text-[#4aa87a]">{marks.length}</div>
          <div className="text-[10px] text-[#78788c]">Marked exams</div>
        </GlassCard>
      </div>

      <div className="flex gap-2">
        {(["all", "graded", "upcoming"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn(
              "text-[10px] font-bold px-3 py-1.5 rounded-xl capitalize",
              filter === f
                ? "bg-[#3b5bdb]/15 text-[#3b5bdb] border border-[#3b5bdb]/25"
                : "text-[#78788c] border border-white/7",
            )}
          >
            {f}
          </button>
        ))}
      </div>

      {showGraded && (
        <GlassCard className="p-5">
          <SectionLabel>Exam marks · MarksService</SectionLabel>
          <div className="space-y-3">
            {marks.length === 0 && (
              <div className="text-xs text-[#46465a] py-6 text-center">No marks published yet.</div>
            )}
            {marks.map((m) => {
              const exam = examById.get(m.examId);
              const max = exam?.maxMarks ?? 100;
              const pct = max ? Math.round((m.marksObtained / max) * 100) : 0;
              const col = subjectColor[exam?.subject ?? ""] ?? "#78788c";
              return (
                <div key={m.id} className="p-4 rounded-xl border border-white/7 bg-white/2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{exam?.name ?? "Exam"}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <SubjectBadge subject={exam?.subject || "—"} color={col} />
                        <span className="text-[11px] text-[#78788c]">{exam?.examDate ?? ""}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-black text-white">
                        {m.marksObtained}/{max}
                      </div>
                      <div className="text-[10px] text-[#78788c]">{pct}%</div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {showUpcoming && (
        <GlassCard className="p-5">
          <SectionLabel>Class tests · TestService</SectionLabel>
          <div className="space-y-3">
            {upcoming.length === 0 && (
              <div className="text-xs text-[#46465a] py-6 text-center">No class tests scheduled.</div>
            )}
            {upcoming.map((t) => (
              <div key={t.id} className="p-4 rounded-xl border border-white/7 bg-white/2 flex items-center gap-3">
                <Trophy className="w-4 h-4 text-[#c08a3a]" />
                <div>
                  <div className="text-sm font-semibold text-white">{t.title}</div>
                  <div className="text-[11px] text-[#78788c]">{t.subject}</div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {bySubject.length > 0 && (
        <GlassCard className="p-5">
          <SectionLabel>
            <span className="inline-flex items-center gap-2">
              <BarChart2 className="w-3.5 h-3.5" /> Subject averages (from MarksService)
            </span>
          </SectionLabel>
          <div className="space-y-2">
            {bySubject.map((s) => (
              <div key={s.subject} className="flex items-center justify-between text-sm">
                <span className="text-[#a0aec0]">{s.subject}</span>
                <span className="font-black text-white">{s.score}%</span>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
