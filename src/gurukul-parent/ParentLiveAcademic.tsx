import { useMemo } from "react";
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
import { useKeyedResource } from "@/hooks/useKeyedResource";
import { localDateKey } from "@/lib/localDate";
import { cn } from "./shared";
import { toDisplayText, toErrorMessage } from "@/lib/presentation";

function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center py-12 text-muted-foreground text-xs gap-2">
      <Loader2 className="w-4 h-4 animate-spin" /> {label}
    </div>
  );
}

/** Parent homework from HomeworkService (no mock). */
export function ParentLiveHomework({ studentId }: { studentId: string }) {
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive(["homework", "profile"]);
  // Keyed on the child so one child's homework can never render under
  // another's name — see src/hooks/useKeyedResource.ts.
  const homework = useKeyedResource(
    [studentId, liveVersion],
    () => HomeworkService.listForStudent(ctx!, studentId),
    { enabled: settled && ready && !!ctx, errorFallback: "Failed to load homework" },
  );

  const rows = useMemo(() => homework.data ?? [], [homework.data]);
  const error = homework.error;
  const loading = homework.isLoading && !(settled && (!ready || !ctx));

  if (loading) return <Loading label="Loading homework…" />;
  if (error) return <div className="text-xs text-[#cc5069] py-6 text-center">{error}</div>;

  return (
    <div className="space-y-3">
      <div className="text-[9px] text-muted-foreground">HomeworkService · {rows.length} items</div>
      {rows.map(({ homework: h, submission: s, displayStatus }) => (
        <div key={h.id} className="p-4 bg-surface border border-border/70 rounded-2xl">
          <div className="flex justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="text-xs font-bold text-foreground">{h.title}</div>
                <span className="text-[9px] font-bold px-2 py-0.5 rounded-lg bg-[#3b5bdb]/15 text-[#3b5bdb]">
                  {WORK_KIND_LABELS[normalizeWorkKind(h.workKind)]}
                </span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
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
            <div className="text-[10px] text-foreground mt-2">Grade: {s.grade}</div>
          )}
          {s?.teacherRemarks && (
            <div className="text-[10px] text-[#4aa87a] mt-1">Remarks: {s.teacherRemarks}</div>
          )}
        </div>
      ))}
      {rows.length === 0 && (
        <div className="text-center py-10 text-xs text-muted-foreground">No homework assigned yet.</div>
      )}
    </div>
  );
}

/** Parent exams + marks from MarksService; tests from TestService with attempt scores. */
export function ParentLiveExams({ studentId, classId }: { studentId: string; classId: string | null }) {
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive(["marks", "examination", "test", "profile"]);
  // Keyed on child AND class: switching either must not show the previous
  // subject's marks. `classId` is part of the key, not just a dependency.
  const examData = useKeyedResource(
    [studentId, classId ?? "no-class", liveVersion],
    async () => {
      const markRows = await MarksService.listForStudent(ctx!, studentId, { limit: 100 });
      let examRows: Awaited<ReturnType<typeof MarksService.listExamsForClass>> = [];
      let testRows: Awaited<ReturnType<typeof TestService.listForClass>> = [];
      let attemptMap: Record<string, Record<string, unknown>> = {};
      if (classId) {
        const results = await Promise.allSettled([
          MarksService.listExamsForClass(ctx!, classId, { limit: 50 }),
          TestService.listForClass(ctx!, classId),
        ]);
        examRows = results[0].status === "fulfilled" ? results[0].value : [];
        testRows = results[1].status === "fulfilled" ? results[1].value : [];
        const ids = testRows.map((t) => String(t.id)).filter(Boolean);
        if (ids.length) {
          try {
            attemptMap = await TestService.listLatestAttemptsForStudent(ctx!, studentId, ids);
          } catch {
            attemptMap = {};
          }
        }
      }
      return { marks: markRows, exams: examRows, tests: testRows, attemptsByTest: attemptMap };
    },
    { enabled: settled && ready && !!ctx, errorFallback: "Failed to load exams" },
  );

  const marks = useMemo(() => examData.data?.marks ?? [], [examData.data]);
  const exams = useMemo(() => examData.data?.exams ?? [], [examData.data]);
  const tests = useMemo(() => examData.data?.tests ?? [], [examData.data]);
  const attemptsByTest = useMemo(() => examData.data?.attemptsByTest ?? {}, [examData.data]);
  const error = examData.error;
  const loading = examData.isLoading && !(settled && (!ready || !ctx));

  if (loading) return <Loading label="Loading exams & tests…" />;
  if (error) return <div className="text-xs text-[#cc5069] py-6 text-center">{error}</div>;

  const examById = new Map(exams.map((e) => [e.id, e]));

  return (
    <div className="space-y-6">
      <div>
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
          Examination marks (MarksService)
        </div>
        <div className="space-y-2">
          {marks.map((m) => {
            const exam = examById.get(m.examId);
            const max = exam?.maxMarks ?? null;
            const pct = max ? Math.round((m.marksObtained / max) * 100) : null;
            return (
              <div key={m.id} className="p-3 bg-surface border border-border/70 rounded-xl flex justify-between">
                <div>
                  <div className="text-xs font-bold text-foreground">{toDisplayText(exam?.name, { kind: "label", fallback: "Exam" })}</div>
                  <div className="text-[10px] text-muted-foreground">{exam?.subject ?? "—"}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-black text-foreground">
                    {max ? `${m.marksObtained}/${max}` : m.marksObtained}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{pct !== null ? `${pct}%` : "—"}</div>
                </div>
              </div>
            );
          })}
          {marks.length === 0 && (
            <div className="text-xs text-muted-foreground py-6 text-center">No marks published yet.</div>
          )}
        </div>
      </div>
      <div>
        <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-3">
          Class tests (TestService)
        </div>
        <div className="space-y-2">
          {tests.map((t) => {
            const att = attemptsByTest[String(t.id)];
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
              <div key={t.id} className="p-3 bg-surface border border-border/70 rounded-xl flex justify-between gap-3">
                <div>
                  <div className="text-xs font-bold text-foreground">{t.title}</div>
                  {/* A test carries no subject column of its own: it anchors on
                      section_subject (§10.22), so the subject is the one that
                      section teaches. topic is what this particular test covers. */}
                  <div className="text-[10px] text-muted-foreground">{t.topic || "—"}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-xs font-black text-foreground">{scoreLabel}</div>
                </div>
              </div>
            );
          })}
          {tests.length === 0 && (
            <div className="text-xs text-muted-foreground py-4 text-center">No class tests scheduled.</div>
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
  // Keyed on the child. Partial-failure semantics are unchanged: any single
  // source may fail, but if all three primary sources fail the whole panel
  // reports an error rather than showing a hollow shell.
  const perf = useKeyedResource(
    [studentId, liveVersion],
    async () => {
      const results = await Promise.allSettled([
        AcademicProfileService.get(ctx!, studentId),
        AnalyticsService.forStudent(ctx!, studentId),
        AiSummaryService.student(ctx!, studentId),
        ProgressionService.getForStudent(ctx!, studentId),
      ]);
      if (results.slice(0, 3).every((s) => s.status === "rejected")) {
        throw (results[0] as PromiseRejectedResult).reason;
      }
      const p = results[0].status === "fulfilled" ? results[0].value : null;
      const a = results[1].status === "fulfilled" ? results[1].value : null;
      const summary = results[2].status === "fulfilled" ? results[2].value : null;
      const prog = results[3].status === "fulfilled" ? results[3].value : null;
      return {
        profile: p,
        analytics: a,
        progression: prog
          ? {
              xp: prog.xp ?? 0,
              level: prog.level ?? 0,
              league: prog.league?.label ?? prog.league?.code ?? "—",
              studyStreak: prog.study_streak ?? 0,
              badges: prog.badges?.length ?? 0,
            }
          : { xp: 0, level: 0, league: "—", studyStreak: 0, badges: 0 },
        narrative: summary
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
      };
    },
    { enabled: settled && ready && !!ctx, errorFallback: "Failed to load performance" },
  );

  const profile: StudentAcademicProfile | null = perf.data?.profile ?? null;
  const analytics = perf.data?.analytics ?? null;
  const progression = perf.data?.progression ?? null;
  const narrative: ParentNarrative | null = perf.data?.narrative ?? null;
  const error = perf.error;
  const loading = perf.isLoading && !(settled && (!ready || !ctx));

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
          <div key={s.label} className="bg-surface border border-border/70 rounded-2xl p-4 text-center">
            <div className="text-lg font-black text-foreground">{s.value}</div>
            <div className="text-[10px] text-muted-foreground">{s.label}</div>
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
            <div key={s.label} className="bg-surface border border-border/70 rounded-2xl p-4 text-center">
              <div className="text-sm font-black text-foreground truncate">{s.value}</div>
              <div className="text-[10px] text-muted-foreground">{s.label}</div>
            </div>
          ))}
        </div>
      )}
      {narrative && (
        <div className="p-4 rounded-2xl bg-muted text-xs text-muted-foreground leading-relaxed space-y-2">
          <div className="text-[10px] font-bold text-foreground">Progress Summary</div>
          <p>{narrative.narrative}</p>
          {narrative.bullets.length > 0 && (
            <ul className="list-disc list-inside space-y-0.5">
              {narrative.bullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          )}
        </div>
      )}
      <p className="text-[9px] text-muted-foreground">
        AcademicProfileService · AnalyticsService · AiSummaryService · ProgressionService · buildParentScheduledNarrative
      </p>
    </div>
  );
}
