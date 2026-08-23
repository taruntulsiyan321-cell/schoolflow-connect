import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  EXAM_TYPE_LABELS,
  MarksService,
  useAcademicContext,
} from "@/academic";
import type { ExamRecord, MarksRecord } from "@/academic/repository/marksRepository";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { displaySubject } from "@/lib/academicPresentation";
import {
  Calendar,
  CalendarClock,
  Clock,
  FileText,
  BookOpen,
  Trophy,
  TrendingUp,
  Award,
} from "lucide-react";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import "@/components/student/dashboard/student-dashboard.css";
import { toErrorMessage } from "@/lib/presentation";

const typeColors: Record<string, string> = {
  class_test: "bg-blue-500/10 text-blue-700 border-blue-500/25",
  unit_test: "bg-violet-500/10 text-violet-700 border-violet-500/25",
  monthly_test: "bg-sky-500/10 text-sky-700 border-sky-500/25",
  mid_term: "bg-indigo-500/10 text-indigo-700 border-indigo-500/25",
  half_yearly: "bg-amber-500/10 text-amber-800 border-amber-500/25",
  annual: "bg-red-500/10 text-red-700 border-red-500/25",
  final: "bg-red-500/10 text-red-700 border-red-500/25",
  other: "bg-muted text-muted-foreground border-border",
};

function scoreTone(pct: number) {
  if (pct >= 75) return { text: "text-emerald-700", bar: "bg-emerald-500", bg: "border-emerald-200/60" };
  if (pct >= 40) return { text: "text-amber-700", bar: "bg-amber-500", bg: "border-amber-200/60" };
  return { text: "text-red-700", bar: "bg-red-500", bg: "border-red-200/60" };
}

function examTypeLabel(type: string | null | undefined) {
  if (!type) return "Exam";
  return EXAM_TYPE_LABELS[type] ?? type;
}

export default function StudentExamsResultsPage() {
  const { ctx, ready, studentId, classId } = useAcademicContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "results" ? "results" : "schedule";

  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [marks, setMarks] = useState<MarksRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!ready || !ctx || !studentId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const settled = await Promise.allSettled([
        classId
          ? MarksService.listExamsForClass(ctx, classId, { limit: 100 })
          : Promise.resolve([] as ExamRecord[]),
        MarksService.listForStudent(ctx, studentId, { limit: 100 }),
      ]);
      setExams(settled[0].status === "fulfilled" ? settled[0].value : []);
      setMarks(settled[1].status === "fulfilled" ? settled[1].value : []);
      if (settled[0].status === "rejected" && settled[1].status === "rejected") {
        setError("Could not load exams");
      }
    } catch (e) {
      setError(toErrorMessage(e, "Could not load exams"));
      setExams([]);
      setMarks([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx, studentId, classId]);

  const today = new Date().toISOString().split("T")[0];
  const upcoming = useMemo(
    () =>
      exams
        .filter((e) => e.examDate && e.examDate >= today)
        .sort((a, b) => String(a.examDate).localeCompare(String(b.examDate))),
    [exams, today],
  );
  const past = useMemo(
    () => exams.filter((e) => !e.examDate || e.examDate < today),
    [exams, today],
  );

  const examById = useMemo(() => new Map(exams.map((e) => [e.id, e])), [exams]);

  const avgPct = useMemo(() => {
    const scored = marks
      .map((m) => {
        const exam = examById.get(m.examId);
        const max = exam?.maxMarks ?? 0;
        if (!max) return null;
        return (m.marksObtained / max) * 100;
      })
      .filter((v): v is number => v != null);
    if (!scored.length) return null;
    return Math.round(scored.reduce((a, b) => a + b, 0) / scored.length);
  }, [marks, examById]);

  const setTab = (value: string) => {
    if (value === "results") setSearchParams({ tab: "results" });
    else setSearchParams({});
  };

  if (!ready || loading) {
    return (
      <div className="sd-dashboard max-w-4xl mx-auto">
        <StudentListSkeleton rows={6} />
      </div>
    );
  }

  if (!studentId) {
    return (
      <div className="sd-dashboard max-w-4xl mx-auto py-12 text-center text-sm text-muted-foreground">
        No student profile linked to this account.
      </div>
    );
  }

  if (error) {
    return (
      <div className="sd-dashboard max-w-4xl mx-auto">
        <StudentErrorState title="Could not load exams" message={error} onRetry={load} />
      </div>
    );
  }

  return (
    <div className="sd-dashboard student-premium max-w-4xl mx-auto space-y-6 pb-8">
      <section className="sd-hero rounded-[1.75rem] overflow-hidden relative text-primary-foreground p-6 sm:p-8">
        <div className="sd-hero-glow absolute inset-0 pointer-events-none" />
        <div className="relative z-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary-foreground/70">
            Academic performance
          </p>
          <h1 className="font-['Sora'] text-2xl sm:text-3xl font-semibold mt-2 tracking-tight">
            Exams & Results
          </h1>
          <p className="text-sm text-primary-foreground/75 mt-2 max-w-lg">
            Your exam schedule and published marks in one place.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            {[
              { label: "Upcoming", value: upcoming.length, icon: CalendarClock },
              { label: "Completed", value: past.length, icon: FileText },
              { label: "Results", value: marks.length, icon: Trophy },
              { label: "Avg score", value: avgPct != null ? `${avgPct}%` : "—", icon: TrendingUp },
            ].map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.label}
                  className="rounded-2xl bg-white/10 ring-1 ring-white/15 backdrop-blur-sm px-4 py-3"
                >
                  <div className="flex items-center gap-2 text-primary-foreground/70">
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-[10px] uppercase tracking-wider">{s.label}</span>
                  </div>
                  <p className="text-xl sm:text-2xl font-bold mt-1 tabular-nums">{s.value}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="w-full h-12 p-1 rounded-2xl bg-muted/80 grid grid-cols-2">
          <TabsTrigger
            value="schedule"
            className="rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-sm font-medium gap-2"
          >
            <Calendar className="w-4 h-4" />
            Exam schedule
          </TabsTrigger>
          <TabsTrigger
            value="results"
            className="rounded-xl data-[state=active]:bg-card data-[state=active]:shadow-sm font-medium gap-2"
          >
            <Award className="w-4 h-4" />
            My results
          </TabsTrigger>
        </TabsList>

        <TabsContent value="schedule" className="mt-5 space-y-6">
          {upcoming.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-primary" />
                Upcoming exams
              </h2>
              <div className="space-y-3">
                {upcoming.map((e) => (
                  <ExamCard key={e.id} exam={e} isUpcoming />
                ))}
              </div>
            </section>
          )}

          {past.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Past exams
              </h2>
              <div className="space-y-3">
                {past.map((e) => (
                  <ExamCard key={e.id} exam={e} />
                ))}
              </div>
            </section>
          )}

          {exams.length === 0 && (
            <div className="sd-card rounded-3xl p-10 text-center">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-60" />
              <p className="font-medium text-foreground">No exams scheduled yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Your class exam calendar will appear here when published.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="results" className="mt-5 space-y-3">
          {marks.length > 0 ? (
            marks.map((r) => {
              const exam = examById.get(r.examId);
              const max = exam?.maxMarks ?? 0;
              const obtained = Number(r.marksObtained);
              const pct = max ? (obtained / max) * 100 : 0;
              const tone = scoreTone(pct);
              const dateStr = exam?.examDate
                ? new Date(exam.examDate).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : null;

              return (
                <div
                  key={r.id}
                  className={cn("sd-card rounded-2xl p-5 border ", tone.bg)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Trophy className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">
                          {exam?.name ?? "Exam"}
                        </p>
                        <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <BookOpen className="w-3.5 h-3.5 shrink-0" />
                          {displaySubject(exam?.subject ?? "") || "—"}
                          {dateStr && (
                            <>
                              <span className="text-border">·</span>
                              <Calendar className="w-3.5 h-3.5 shrink-0" />
                              {dateStr}
                            </>
                          )}
                        </p>
                        {exam?.examType && (
                          <Badge
                            variant="outline"
                            className={cn(
                              "mt-2 text-[10px]",
                              typeColors[exam.examType] || typeColors.other,
                            )}
                          >
                            {examTypeLabel(exam.examType)}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn("text-2xl font-bold tabular-nums", tone.text)}>
                        {obtained}
                        <span className="text-base font-medium text-muted-foreground">/{max || "—"}</span>
                      </p>
                      <p className={cn("text-sm font-semibold tabular-nums", tone.text)}>
                        {max ? `${pct.toFixed(0)}%` : "—"}
                      </p>
                    </div>
                  </div>
                  {max > 0 && (
                    <div className="mt-4">
                      <Progress
                        value={pct}
                        className={cn(
                          "h-2 bg-black/5",
                          pct >= 75 && "[&>div]:bg-emerald-500",
                          pct >= 40 && pct < 75 && "[&>div]:bg-amber-500",
                          pct < 40 && "[&>div]:bg-red-500",
                        )}
                      />
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="sd-card rounded-3xl p-10 text-center">
              <Trophy className="w-12 h-12 mx-auto text-muted-foreground mb-3 opacity-60" />
              <p className="font-medium text-foreground">No results published yet</p>
              <p className="text-sm text-muted-foreground mt-1">
                Marks will show here after your teachers publish exam results.
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ExamCard({ exam, isUpcoming }: { exam: ExamRecord; isUpcoming?: boolean }) {
  const dateStr = exam.examDate
    ? new Date(exam.examDate).toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Date TBD";

  const daysUntil = exam.examDate
    ? Math.ceil((new Date(exam.examDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div
      className={cn(
        "sd-card rounded-2xl p-5 transition-all",
        isUpcoming && "ring-2 ring-primary/20 border-primary/15",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4 min-w-0">
          <div
            className={cn(
              "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
              isUpcoming ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
            )}
          >
            <FileText className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{exam.name}</p>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 shrink-0" />
              {displaySubject(exam.subject) || "—"}
            </p>
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5 flex-wrap">
              <Calendar className="w-3.5 h-3.5 shrink-0" />
              {dateStr}
              {isUpcoming && daysUntil !== null && daysUntil >= 0 && (
                <span className="ml-1 font-semibold text-primary px-2 py-0.5 rounded-full bg-primary/10">
                  {daysUntil === 0 ? "Today" : daysUntil === 1 ? "Tomorrow" : `In ${daysUntil} days`}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <Badge variant="outline" className={typeColors[exam.examType] || typeColors.other}>
            {examTypeLabel(exam.examType)}
          </Badge>
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            Max {exam.maxMarks} marks
          </span>
        </div>
      </div>
    </div>
  );
}
