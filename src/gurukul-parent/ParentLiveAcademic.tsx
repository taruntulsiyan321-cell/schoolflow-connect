import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AcademicProfileService,
  AnalyticsService,
  AiSummaryService,
  HomeworkService,
  MarksService,
  TestService,
  WORK_KIND_LABELS,
  normalizeWorkKind,
  type StudentAcademicProfile,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { cn } from "./shared";

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-[#78788c] text-xs gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> {label}
    </div>
  );
}

/** Parent homework from HomeworkService (no mock). */
export function ParentLiveHomework({ studentId }: { studentId: string }) {
  const { ctx, ready } = useAcademicContext();
  const [rows, setRows] = useState<Awaited<ReturnType<typeof HomeworkService.listForStudent>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx || !studentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await HomeworkService.listForStudent(ctx, studentId);
        if (!cancelled) {
          setRows(list);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load homework");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId]);

  if (loading) return <Loading label="Loading homework…" />;
  if (error) return <div className="text-xs text-[#cc5069] py-6 text-center">{error}</div>;

  return (
    <div className="space-y-3">
      <div className="text-[9px] text-[#46465a]">HomeworkService · {rows.length} items</div>
      {rows.map(({ homework: h, submission: s, displayStatus }) => (
        <div key={h.id} className="p-4 bg-[#131316] border border-white/7 rounded-2xl">
          <div className="flex justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-xs font-bold text-white">{h.title}</div>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-[#3b5bdb]/15 text-[#3b5bdb]">
                  {WORK_KIND_LABELS[normalizeWorkKind(h.workKind)]}
                </span>
              </div>
              <div className="text-[10px] text-[#78788c] mt-0.5">
                {h.subject} · Due {h.dueDate ?? "—"}
                {s?.submittedAt ? ` · Submitted ${new Date(s.submittedAt).toLocaleString()}` : ""}
              </div>
            </div>
            <div
              className={cn(
                "text-[9px] font-bold px-2 py-1 rounded-lg h-fit capitalize",
                displayStatus === "Completed" || displayStatus === "Reviewed"
                  ? "bg-[#6366f1]/15 text-[#6366f1]"
                  : displayStatus === "Submitted"
                    ? "bg-[#3b5bdb]/15 text-[#3b5bdb]"
                    : displayStatus === "Late"
                      ? "bg-[#cc5069]/15 text-[#cc5069]"
                      : "bg-[#c08a3a]/15 text-[#c08a3a]",
              )}
            >
              {displayStatus}
            </div>
          </div>
          {s?.grade && (
            <div className="text-[10px] text-white mt-2">Grade: {s.grade}</div>
          )}
          {s?.teacherRemarks && (
            <div className="text-[10px] text-[#4aa87a] mt-1">Remarks: {s.teacherRemarks}</div>
          )}
        </div>
      ))}
      {rows.length === 0 && (
        <div className="text-center py-10 text-xs text-[#46465a]">No homework assigned yet.</div>
      )}
    </div>
  );
}

/** Parent exams + marks from MarksService; tests from TestService. */
export function ParentLiveExams({ studentId, classId }: { studentId: string; classId: string | null }) {
  const { ctx, ready } = useAcademicContext();
  const [marks, setMarks] = useState<Awaited<ReturnType<typeof MarksService.listForStudent>>>([]);
  const [exams, setExams] = useState<Awaited<ReturnType<typeof MarksService.listExamsForClass>>>([]);
  const [tests, setTests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx || !studentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const markRows = await MarksService.listForStudent(ctx, studentId, { limit: 100 });
        let examRows: Awaited<ReturnType<typeof MarksService.listExamsForClass>> = [];
        let testRows: any[] = [];
        if (classId) {
          const settled = await Promise.allSettled([
            MarksService.listExamsForClass(ctx, classId, { limit: 50 }),
            TestService.listForClass(ctx, classId),
          ]);
          examRows = settled[0].status === "fulfilled" ? settled[0].value : [];
          testRows = settled[1].status === "fulfilled" ? settled[1].value : [];
        }
        if (cancelled) return;
        setMarks(markRows);
        setExams(examRows);
        setTests(testRows);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load exams");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId, classId]);

  if (loading) return <Loading label="Loading exams & tests…" />;
  if (error) return <div className="text-xs text-[#cc5069] py-6 text-center">{error}</div>;

  const examById = new Map(exams.map((e) => [e.id, e]));

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider mb-3">
          Examination marks (MarksService)
        </div>
        <div className="space-y-2">
          {marks.map((m) => {
            const exam = examById.get(m.examId);
            const max = exam?.maxMarks ?? 100;
            const pct = max ? Math.round((m.marksObtained / max) * 100) : 0;
            return (
              <div key={m.id} className="p-3 bg-[#131316] border border-white/7 rounded-xl flex justify-between">
                <div>
                  <div className="text-xs font-bold text-white">{exam?.name ?? m.examId.slice(0, 8)}</div>
                  <div className="text-[10px] text-[#78788c]">{exam?.subject ?? "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-black text-white">
                    {m.marksObtained}/{max}
                  </div>
                  <div className="text-[10px] text-[#46465a]">{pct}%</div>
                </div>
              </div>
            );
          })}
          {marks.length === 0 && (
            <div className="text-xs text-[#46465a] py-6 text-center">No marks published yet.</div>
          )}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-bold text-[#78788c] uppercase tracking-wider mb-3">
          Class tests (TestService)
        </div>
        <div className="space-y-2">
          {tests.map((t) => (
            <div key={t.id} className="p-3 bg-[#131316] border border-white/7 rounded-xl">
              <div className="text-xs font-bold text-white">{t.title}</div>
              <div className="text-[10px] text-[#78788c]">{t.subject || "—"}</div>
            </div>
          ))}
          {tests.length === 0 && (
            <div className="text-xs text-[#46465a] py-4 text-center">No class tests scheduled.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Performance / insights from AcademicProfileService + Analytics + AI. */
export function ParentLivePerformance({ studentId }: { studentId: string }) {
  const { ctx, ready } = useAcademicContext();
  const [profile, setProfile] = useState<StudentAcademicProfile | null>(null);
  const [analytics, setAnalytics] = useState<Awaited<
    ReturnType<typeof AnalyticsService.forStudent>
  > | null>(null);
  const [ai, setAi] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !ctx || !studentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const settled = await Promise.allSettled([
          AcademicProfileService.get(ctx, studentId),
          AnalyticsService.forStudent(ctx, studentId),
          AiSummaryService.student(ctx, studentId),
        ]);
        if (cancelled) return;
        if (settled.every((s) => s.status === "rejected")) {
          const first = settled[0] as PromiseRejectedResult;
          setError(first.reason instanceof Error ? first.reason.message : "Failed to load performance");
          return;
        }
        const p = settled[0].status === "fulfilled" ? settled[0].value : null;
        const a = settled[1].status === "fulfilled" ? settled[1].value : null;
        const summary = settled[2].status === "fulfilled" ? settled[2].value : null;
        setProfile(p);
        setAnalytics(a);
        setAi(
          summary
            ? `Attendance ${Math.round(summary.attendancePct)}% · Homework ${Math.round(summary.homeworkCompletionPct)}% · Exams ${Math.round(summary.examsAvgPct)}% · Tests ${Math.round(summary.testsAvgPct)}%`
            : null,
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load performance");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId]);

  if (loading) return <Loading label="Loading performance…" />;
  if (error) return <div className="text-xs text-[#cc5069] py-6 text-center">{error}</div>;

  const att = analytics?.attendance.pct ?? profile?.attendancePct ?? 0;
  const hw = analytics?.homework.pct ?? profile?.homeworkCompletionPct ?? 0;
  const exams = analytics?.exams.averagePct ?? profile?.examsAvgPct ?? 0;
  const tests = analytics?.tests.averagePct ?? profile?.testsAvgPct ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Attendance", value: `${Math.round(att)}%` },
          { label: "Homework", value: `${Math.round(hw)}%` },
          { label: "Exams", value: `${Math.round(exams)}%` },
          { label: "Tests", value: `${Math.round(tests)}%` },
        ].map((s) => (
          <div key={s.label} className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
            <div className="text-lg font-black text-white">{s.value}</div>
            <div className="text-[10px] text-[#78788c]">{s.label}</div>
          </div>
        ))}
      </div>
      {ai && (
        <div className="p-4 rounded-2xl bg-white/3 text-xs text-[#78788c] leading-relaxed">
          <div className="text-[10px] font-bold text-white mb-2">AI Summary (engine)</div>
          {ai}
        </div>
      )}
      <p className="text-[9px] text-[#46465a]">
        AcademicProfileService · AnalyticsService · AiSummaryService
      </p>
    </div>
  );
}
