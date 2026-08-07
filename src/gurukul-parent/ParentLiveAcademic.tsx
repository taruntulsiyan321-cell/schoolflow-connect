import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  AcademicProfileService,
  AnalyticsService,
  AiSummaryService,
  HomeworkService,
  MarksService,
  ProgressionService,
  TestService,
  WORK_KIND_LABELS,
  normalizeWorkKind,
  useAcademicLive,
  buildParentScheduledNarrative,
  type StudentAcademicProfile,
  type ParentNarrative,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { localDateKey } from "@/lib/localDate";
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
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive(["homework", "profile"]);
  const [rows, setRows] = useState<Awaited<ReturnType<typeof HomeworkService.listForStudent>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settled) return;
    if (!ready || !ctx || !studentId) {
      setLoading(false);
      return;
    }
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
  }, [settled, ready, ctx, studentId, liveVersion]);

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

/** Parent exams + marks from MarksService; tests from TestService with attempt scores. */
export function ParentLiveExams({ studentId, classId }: { studentId: string; classId: string | null }) {
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive(["marks", "examination", "test", "profile"]);
  const [marks, setMarks] = useState<Awaited<ReturnType<typeof MarksService.listForStudent>>>([]);
  const [exams, setExams] = useState<Awaited<ReturnType<typeof MarksService.listExamsForClass>>>([]);
  const [tests, setTests] = useState<any[]>([]);
  const [attemptsByDpp, setAttemptsByDpp] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settled) return;
    if (!ready || !ctx || !studentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const markRows = await MarksService.listForStudent(ctx, studentId, { limit: 100 });
        let examRows: Awaited<ReturnType<typeof MarksService.listExamsForClass>> = [];
        let testRows: any[] = [];
        let attemptMap: Record<string, Record<string, unknown>> = {};
        if (classId) {
          const results = await Promise.allSettled([
            MarksService.listExamsForClass(ctx, classId, { limit: 50 }),
            TestService.listForClass(ctx, classId),
          ]);
          examRows = results[0].status === "fulfilled" ? results[0].value : [];
          testRows = results[1].status === "fulfilled" ? results[1].value : [];
          const ids = testRows.map((t) => String(t.id)).filter(Boolean);
          if (ids.length) {
            try {
              attemptMap = await TestService.listLatestAttemptsForStudent(ctx, studentId, ids);
            } catch {
              attemptMap = {};
            }
          }
        }
        if (cancelled) return;
        setMarks(markRows);
        setExams(examRows);
        setTests(testRows);
        setAttemptsByDpp(attemptMap);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load exams");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, ready, ctx, studentId, classId, liveVersion]);

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
            const max = exam?.maxMarks ?? null;
            const pct = max ? Math.round((m.marksObtained / max) * 100) : null;
            return (
              <div key={m.id} className="p-3 bg-[#131316] border border-white/7 rounded-xl flex justify-between">
                <div>
                  <div className="text-xs font-bold text-white">{exam?.name ?? m.examId.slice(0, 8)}</div>
                  <div className="text-[10px] text-[#78788c]">{exam?.subject ?? "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-black text-white">
                    {max ? `${m.marksObtained}/${max}` : m.marksObtained}
                  </div>
                  <div className="text-[10px] text-[#46465a]">{pct !== null ? `${pct}%` : "—"}</div>
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
          {tests.map((t) => {
            const att = attemptsByDpp[String(t.id)];
            const score = att?.score != null ? Number(att.score) : null;
            const correct = att?.correct_count != null ? Number(att.correct_count) : null;
            const total = att?.total_count != null ? Number(att.total_count) : null;
            const submitted = Boolean(att?._submitted);
            let scoreLabel = "Not attempted";
            if (att && submitted && score != null) {
              scoreLabel =
                total != null && total > 0
                  ? `${correct ?? score}/${total}`
                  : String(score);
            } else if (att && !submitted) {
              scoreLabel = "In progress";
            }
            return (
              <div key={t.id} className="p-3 bg-[#131316] border border-white/7 rounded-xl flex justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-white">{t.title}</div>
                  <div className="text-[10px] text-[#78788c]">{t.subject || "—"}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-black text-white">{scoreLabel}</div>
                </div>
              </div>
            );
          })}
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
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive([
    "attendance",
    "homework",
    "marks",
    "examination",
    "test",
    "profile",
  ]);
  const [profile, setProfile] = useState<StudentAcademicProfile | null>(null);
  const [analytics, setAnalytics] = useState<Awaited<
    ReturnType<typeof AnalyticsService.forStudent>
  > | null>(null);
  const [progression, setProgression] = useState<{
    xp: number;
    level: number;
    league: string;
    studyStreak: number;
    badges: number;
  } | null>(null);
  const [narrative, setNarrative] = useState<ParentNarrative | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settled) return;
    if (!ready || !ctx || !studentId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const results = await Promise.allSettled([
          AcademicProfileService.get(ctx, studentId),
          AnalyticsService.forStudent(ctx, studentId),
          AiSummaryService.student(ctx, studentId),
          ProgressionService.getForStudent(ctx, studentId),
        ]);
        if (cancelled) return;
        if (results.slice(0, 3).every((s) => s.status === "rejected")) {
          const first = results[0] as PromiseRejectedResult;
          setError(first.reason instanceof Error ? first.reason.message : "Failed to load performance");
          return;
        }
        const p = results[0].status === "fulfilled" ? results[0].value : null;
        const a = results[1].status === "fulfilled" ? results[1].value : null;
        const summary = results[2].status === "fulfilled" ? results[2].value : null;
        const prog = results[3].status === "fulfilled" ? results[3].value : null;
        setProfile(p);
        setAnalytics(a);
        setProgression(
          prog
            ? {
                xp: prog.xp ?? 0,
                level: prog.level ?? 0,
                league: prog.league?.label ?? prog.league?.code ?? "—",
                studyStreak: prog.study_streak ?? 0,
                badges: prog.badges?.length ?? 0,
              }
            : { xp: 0, level: 0, league: "—", studyStreak: 0, badges: 0 },
        );
        setNarrative(
          summary
            ? buildParentScheduledNarrative({
                attendance_pct: summary.attendancePct,
                homework_completion_pct: summary.homeworkCompletionPct,
                tests_avg_pct: summary.testsAvgPct,
                exams_avg_pct: summary.examsAvgPct,
                weak_topics: summary.weakTopics,
                strong_topics: summary.strongTopics,
                source_as_of: localDateKey(),
                data_version: `parent_performance:${studentId}`,
              })
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
  }, [settled, ready, ctx, studentId, liveVersion]);

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
      {progression && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: "XP", value: String(progression.xp) },
            { label: "Level", value: String(progression.level) },
            { label: "League", value: progression.league },
            { label: "Streak / Badges", value: `${progression.studyStreak} / ${progression.badges}` },
          ].map((s) => (
            <div key={s.label} className="bg-[#131316] border border-white/7 rounded-2xl p-4 text-center">
              <div className="text-sm font-black text-white truncate">{s.value}</div>
              <div className="text-[10px] text-[#78788c]">{s.label}</div>
            </div>
          ))}
        </div>
      )}
      {narrative && (
        <div className="p-4 rounded-2xl bg-white/3 text-xs text-[#78788c] leading-relaxed space-y-2">
          <div className="text-[10px] font-bold text-white">Progress Summary</div>
          <p>{narrative.narrative}</p>
          {narrative.bullets.length > 0 && (
            <ul className="list-disc list-inside space-y-0.5">
              {narrative.bullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          )}
        </div>
      )}
      <p className="text-[9px] text-[#46465a]">
        AcademicProfileService · AnalyticsService · AiSummaryService · ProgressionService · buildParentScheduledNarrative
      </p>
    </div>
  );
}
