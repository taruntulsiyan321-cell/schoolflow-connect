import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Trophy, BarChart2, Play } from "lucide-react";
import {
  AnalyticsService,
  EXAM_TYPE_LABELS,
  HomeworkService,
  MarksService,
  TEST_KIND_LABELS,
  TestService,
  useAcademicLive,
} from "@/academic";
import type { ExamRecord, MarksRecord } from "@/academic/repository/marksRepository";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { displaySubject } from "@/lib/academicPresentation";
import { GlassCard, SectionLabel, SubjectBadge, subjectColor, cn } from "@/gurukul/components/shared";

/**
 * Student Tests — MarksService + TestService + AnalyticsService (no mock catalogs).
 */
export default function Tests() {
  const { ctx, ready, studentId, classId } = useAcademicContext();
  const liveVersion = useAcademicLive(["test", "marks"]);
  const [marks, setMarks] = useState<MarksRecord[]>([]);
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [upcoming, setUpcoming] = useState<
    { id: string; title: string; subject: string; testKind: string; published: boolean }[]
  >([]);
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
        await HomeworkService.publishDueScheduled(ctx).catch(() => 0);
        const settled = await Promise.allSettled([
          MarksService.listForStudent(ctx, studentId, { limit: 100 }),
          AnalyticsService.forStudent(ctx, studentId),
          classId ? MarksService.listExamsForClass(ctx, classId, { limit: 50 }) : Promise.resolve([]),
          classId ? TestService.listForClass(ctx, classId) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        const markRows = settled[0].status === "fulfilled" ? settled[0].value : [];
        const analytics = settled[1].status === "fulfilled" ? settled[1].value : null;
        const examRows = settled[2].status === "fulfilled" ? settled[2].value : [];
        const tests = settled[3].status === "fulfilled" ? settled[3].value : [];
        setMarks(markRows);
        setExams(examRows);
        setAvgPct(Math.round(analytics?.exams.averagePct ?? 0));
        setTestsAvg(Math.round(analytics?.tests.averagePct ?? 0));
        setUpcoming(
          (
            tests as {
              id: string;
              title: string;
              subject?: string;
              test_kind?: string;
              is_published?: boolean;
              status?: string;
            }[]
          ).map((t) => ({
            id: t.id,
            title: t.title,
            subject: t.subject ?? "",
            testKind: t.test_kind ?? "class_test",
            published: t.is_published === true || t.status === "published",
          })),
        );
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load tests");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId, classId, liveVersion]);

  const examById = useMemo(() => new Map(exams.map((e) => [e.id, e])), [exams]);

  const bySubject = useMemo(() => {
    const map = new Map<string, number[]>();
    for (const m of marks) {
      const exam = examById.get(m.examId);
      const key = (exam?.subject ?? "").trim();
      if (!key || !displaySubject(key)) continue;
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
          <div className="text-[10px] text-[#78788c]">Exam avg</div>
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
          <SectionLabel>Exam marks</SectionLabel>
          <div className="space-y-3">
            {marks.length === 0 && (
              <div className="text-xs text-[#46465a] py-6 text-center">No marks published yet.</div>
            )}
            {marks.map((m) => {
              const exam = examById.get(m.examId);
              const max = exam?.maxMarks ?? 100;
              const pct = max ? Math.round((m.marksObtained / max) * 100) : 0;
              const subj = exam?.subject ?? "";
              const col = subjectColor[displaySubject(subj) || subj] ?? subjectColor[subj] ?? "#78788c";
              const typeLabel =
                EXAM_TYPE_LABELS[exam?.examType ?? ""] ?? exam?.examType ?? null;
              return (
                <div key={m.id} className="p-4 rounded-xl border border-white/7 bg-white/2">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">{exam?.name ?? "Exam"}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {displaySubject(subj) ? <SubjectBadge subject={subj} color={col} /> : null}
                        {typeLabel && (
                          <span className="text-[10px] text-[#78788c]">{typeLabel}</span>
                        )}
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
          <SectionLabel>Class tests</SectionLabel>
          <div className="space-y-3">
            {upcoming.length === 0 && (
              <div className="text-xs text-[#46465a] py-6 text-center">No class tests scheduled.</div>
            )}
            {upcoming.map((t) => {
              const kindLabel =
                TEST_KIND_LABELS[t.testKind as keyof typeof TEST_KIND_LABELS] ?? t.testKind;
              return (
                <div
                  key={t.id}
                  className="p-4 rounded-xl border border-white/7 bg-white/2 flex items-center gap-3"
                >
                  <Trophy className="w-4 h-4 text-[#c08a3a] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{t.title}</div>
                    <div className="text-[11px] text-[#78788c]">
                      {[displaySubject(t.subject), kindLabel].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {t.published ? (
                    <Link
                      to={`/student/dpp/${t.id}/attempt`}
                      className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-[#3b5bdb]/15 text-[#818cf8] border border-[#3b5bdb]/25 hover:bg-[#3b5bdb]/25 transition-colors shrink-0"
                    >
                      <Play className="w-3 h-3" /> Attempt
                    </Link>
                  ) : (
                    <span className="text-[10px] text-[#46465a] shrink-0">Not published</span>
                  )}
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {bySubject.length > 0 && (
        <GlassCard className="p-5">
          <SectionLabel>
            <span className="inline-flex items-center gap-2">
              <BarChart2 className="w-3.5 h-3.5" /> Subject averages
            </span>
          </SectionLabel>
          <div className="space-y-2">
            {bySubject.map((s) => (
              <div key={s.subject} className="flex items-center justify-between text-sm">
                <span className="text-[#a0aec0]">{displaySubject(s.subject) || s.subject}</span>
                <span className="font-black text-white">{s.score}%</span>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
