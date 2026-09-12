import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Trophy, BarChart2, Play, CheckCircle2, FileText } from "lucide-react";
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
import type { TestListRow } from "@/academic/services/testService";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";
import { toast } from "@/hooks/use-toast";
import { displaySubject } from "@/lib/academicPresentation";
import { GlassCard, NoStudentProfile, PageHeader, PageSkeleton, SectionLabel, Skeleton, SkeletonCard, SkeletonList, SkeletonStats, SubjectBadge, cn, subjectColor } from "@/gurukul/components/shared";
import { toErrorMessage } from "@/lib/presentation";
import { StudentErrorState } from "@/components/student/StudentPanelStates";

/**
 * Student Tests — MarksService + TestService + AnalyticsService (no mock catalogs).
 */
export default function Tests() {
  const { ctx, ready, studentId, classId } = useAcademicContext();
  const liveVersion = useAcademicLive(["test", "marks", "examination", "profile"]);
  const [marks, setMarks] = useState<MarksRecord[]>([]);
  const [exams, setExams] = useState<ExamRecord[]>([]);
  /**
   * The class's tests, from `rpc_test_list_for_class`.
   *
   * This was a hand-mapped shape over `TestService.listForClass`, and three of
   * its four fields could not be filled: `subject` read `t.subject` off a table
   * that has no subject column (§10.22) so every card's subject line was
   * blank, `published` re-derived a status the query had already filtered on,
   * and nothing said whether this student had sat the test — so a submitted
   * test still offered "Attempt" and sent them back into a paper they had
   * handed in, where every answer save is refused.
   */
  const [classTests, setClassTests] = useState<TestListRow[]>([]);
  /**
   * null means "no figure recorded", never 0 — ruling 8.
   *
   * Both of these were `useState(0)` filled from `analytics.exams.averagePct`,
   * and the repository returns `{ count: 0, averagePct: 0 }` for a student with
   * nothing marked. So a student who has never sat a test was shown a hard
   * "Tests avg 0%" in the panel's largest numeral — a failing grade, invented
   * from an absence, on the screen they open to find out how they are doing.
   * `count` is what tells the two apart and it was already on the bundle.
   */
  const [avgPct, setAvgPct] = useState<number | null>(null);
  const [testsAvg, setTestsAvg] = useState<number | null>(null);
  const [filter, setFilter] = useState<"all" | "graded" | "upcoming">("all");
  const [loading, setLoading] = useState(true);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate([studentId, classId]);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by the error state's Try again, so the load effect re-runs. */
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    // Still resolving is not loaded — see the long note in ClassHub.tsx.
    if (!ready) return;
    if (!ctx || !studentId) {
      endLoading(setLoading);
      return;
    }
    let cancelled = false;
    (async () => {
      beginLoading(setLoading);
      try {
        await HomeworkService.publishDueScheduled(ctx).catch(() => 0);
        const settled = await Promise.allSettled([
          MarksService.listForStudent(ctx, studentId, { limit: 100 }),
          AnalyticsService.forStudent(ctx, studentId),
          classId ? MarksService.listExamsForClass(ctx, classId, { limit: 50 }) : Promise.resolve([]),
          classId ? TestService.listForClassDetailed(ctx, classId) : Promise.resolve([]),
        ]);
        if (cancelled) return;
        const markRows = settled[0].status === "fulfilled" ? settled[0].value : [];
        const analytics = settled[1].status === "fulfilled" ? settled[1].value : null;
        const examRows = settled[2].status === "fulfilled" ? settled[2].value : [];
        const tests = settled[3].status === "fulfilled" ? settled[3].value : [];
        setMarks(markRows);
        setExams(examRows);
        setAvgPct(analytics && analytics.exams.count > 0 ? Math.round(analytics.exams.averagePct) : null);
        setTestsAvg(analytics && analytics.tests.count > 0 ? Math.round(analytics.tests.averagePct) : null);
        setClassTests(tests as TestListRow[]);
        const rejected = settled.filter((s) => s.status === "rejected").length;
        if (rejected > 0) {
          toast({
            title: "Some test data failed to load",
            description: "Showing available results; missing sections show as empty.",
            variant: "destructive",
          });
        }
        setError(null);
      } catch (e) {
        if (!cancelled) setError(toErrorMessage(e, "Failed to load tests"));
      } finally {
        if (!cancelled) endLoading(setLoading);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, ctx, studentId, classId, liveVersion, reloadNonce]);

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

  // The title needs no network, so it no longer waits for one.
  const header = (
    <PageHeader
      eyebrow="Class"
      title="Tests"
      subtitle="Your marks from class tests and exams, newest first."
    />
  );

  if (!ready || showLoading(loading)) {
    return (
      <div className="space-y-6">
        {header}
        <PageSkeleton label="Loading tests" className="space-y-6">
          <SkeletonStats count={3} className="grid-cols-3 sm:grid-cols-3" />
          <SkeletonCard className="p-5 space-y-4">
            <Skeleton className="h-3 w-28" />
            <SkeletonList rows={3} />
          </SkeletonCard>
          <SkeletonCard className="p-5 space-y-4">
            <Skeleton className="h-3 w-36" />
            <SkeletonList rows={2} />
          </SkeletonCard>
        </PageSkeleton>
      </div>
    );
  }

  if (!studentId) {
    return <div className="space-y-6">{header}<NoStudentProfile /></div>;
  }

  if (error) {
    return (
      <div className="space-y-6">
        {header}
        <StudentErrorState
          title="Could not load your tests"
          message={error}
          onRetry={() => {
            // Clear first: useInitialLoadGate suppresses the spinner on a
            // same-subject refetch, so without this the student presses Try
            // again and the unchanged error screen just sits there.
            setError(null);
            setReloadNonce((n) => n + 1);
          }}
        />
      </div>
    );
  }

  const showGraded = filter === "all" || filter === "graded";
  const showUpcoming = filter === "all" || filter === "upcoming";

  return (
    <div className="space-y-6">
      {header}
      <div className="grid grid-cols-3 gap-3">
        <GlassCard className="p-4 text-center">
          <div className="text-2xl font-black text-foreground">
            {avgPct == null ? <span className="text-muted-foreground">—</span> : `${avgPct}%`}
          </div>
          <div className="text-[10px] text-muted-foreground">Exam avg</div>
        </GlassCard>
        <GlassCard className="p-4 text-center">
          <div className="text-2xl font-black text-primary">
            {testsAvg == null ? <span className="text-muted-foreground">—</span> : `${testsAvg}%`}
          </div>
          <div className="text-[10px] text-muted-foreground">Tests avg</div>
        </GlassCard>
        <GlassCard className="p-4 text-center">
          <div className="text-2xl font-black text-success">{marks.length}</div>
          <div className="text-[10px] text-muted-foreground">Marked exams</div>
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
                ? "bg-primary/15 text-primary border border-primary/25"
                : "text-muted-foreground border border-border/70",
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
              <div className="text-xs text-muted-foreground py-6 text-center">No marks published yet.</div>
            )}
            {marks.map((m) => {
              const exam = examById.get(m.examId);
              const max = exam?.maxMarks ?? 100;
              const pct = max ? Math.round((m.marksObtained / max) * 100) : 0;
              const subj = exam?.subject ?? "";
              const col = subjectColor[displaySubject(subj) || subj] ?? subjectColor[subj] ?? "hsl(var(--muted-foreground))";
              const typeLabel =
                EXAM_TYPE_LABELS[exam?.examType ?? ""] ?? exam?.examType ?? null;
              return (
                <div key={m.id} className="p-4 rounded-xl border border-border/70 bg-muted/30">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{exam?.name ?? "Exam"}</div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {displaySubject(subj) ? <SubjectBadge subject={subj} color={col} /> : null}
                        {typeLabel && (
                          <span className="text-[10px] text-muted-foreground">{typeLabel}</span>
                        )}
                        <span className="text-[11px] text-muted-foreground">{exam?.examDate ?? ""}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-lg font-black text-foreground">
                        {m.marksObtained}/{max}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{pct}%</div>
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
            {classTests.length === 0 && (
              <div className="text-xs text-muted-foreground py-6 text-center">
                Your teachers have not published a test yet.
              </div>
            )}
            {classTests.map((t) => {
              const kindLabel =
                TEST_KIND_LABELS[t.test_kind as keyof typeof TEST_KIND_LABELS] ?? t.test_kind;
              const submitted = t.my_status === "submitted";
              const inProgress = t.my_status === "in_progress";
              // 0 questions is an uploaded paper: the teacher attaches it and
              // enters the marks from the written answers. There is nothing to
              // sit online, so no Attempt control is offered — it used to be,
              // and `rpc_test_start` then refused it with "test has no
              // questions" after the student had already tapped through.
              const attemptable = t.question_count > 0;
              return (
                <div
                  key={t.id}
                  className="p-4 rounded-xl border border-border/70 bg-muted/30 flex items-center gap-3"
                >
                  {submitted ? (
                    <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
                  ) : attemptable ? (
                    <Trophy className="w-4 h-4 text-warning shrink-0" />
                  ) : (
                    <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-foreground truncate">{t.title}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {[
                        t.subject ? displaySubject(t.subject) : null,
                        kindLabel,
                        attemptable ? `${t.question_count} questions` : "Written paper",
                        t.duration_sec ? `${Math.round(t.duration_sec / 60)} min` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {/* The mark, where the student looks for it. NULL is not 0
                        (§7): a submitted test with no mark recorded says so
                        rather than claiming a zero. */}
                    {submitted && (
                      <div className="text-[11px] font-bold text-success mt-0.5">
                        {t.my_mark == null
                          ? "Submitted — mark not recorded"
                          : `Scored ${t.my_mark}${t.max_mark != null ? ` / ${t.max_mark}` : ""}`}
                      </div>
                    )}
                  </div>
                  {submitted ? (
                    <Link
                      to={`/student/test/${t.id}/result`}
                      className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-success/15 text-success border border-success/25 hover:bg-success/25 transition-colors shrink-0"
                    >
                      <BarChart2 className="w-3 h-3" /> Report
                    </Link>
                  ) : attemptable ? (
                    <Link
                      to={`/student/test/${t.id}/attempt`}
                      className="inline-flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-xl bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-colors shrink-0"
                    >
                      <Play className="w-3 h-3" /> {inProgress ? "Resume" : "Attempt"}
                    </Link>
                  ) : (
                    <span className="text-[10px] text-muted-foreground shrink-0 text-right max-w-[120px]">
                      Sat in class — your teacher enters the marks
                    </span>
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
                <span className="text-muted-foreground">{displaySubject(s.subject) || s.subject}</span>
                <span className="font-black text-foreground">{s.score}%</span>
              </div>
            ))}
          </div>
        </GlassCard>
      )}
    </div>
  );
}
