import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
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
import { StudentListSkeleton } from "@/components/student/StudentPanelStates";
import "@/components/student/dashboard/student-dashboard.css";

const typeColors: Record<string, string> = {
  class_test: "bg-blue-500/10 text-blue-700 border-blue-500/25",
  unit_test: "bg-violet-500/10 text-violet-700 border-violet-500/25",
  half_yearly: "bg-amber-500/10 text-amber-800 border-amber-500/25",
  final: "bg-red-500/10 text-red-700 border-red-500/25",
  other: "bg-muted text-muted-foreground border-border",
};

const typeLabels: Record<string, string> = {
  class_test: "Class Test",
  unit_test: "Unit Test",
  half_yearly: "Half Yearly",
  final: "Final",
  other: "Other",
};

function scoreTone(pct: number) {
  if (pct >= 75) return { text: "text-emerald-700", bar: "bg-emerald-500", bg: "from-emerald-50 to-white border-emerald-200/60" };
  if (pct >= 40) return { text: "text-amber-700", bar: "bg-amber-500", bg: "from-amber-50 to-white border-amber-200/60" };
  return { text: "text-red-700", bar: "bg-red-500", bg: "from-red-50 to-white border-red-200/60" };
}

export default function StudentExamsResultsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "results" ? "results" : "schedule";

  const [exams, setExams] = useState<any[]>([]);
  const [marks, setMarks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data: s } = await supabase
        .from("students")
        .select("id, class_id")
        .eq("user_id", user.id)
        .maybeSingle();

      const examPromise = s?.class_id
        ? supabase
            .from("exams")
            .select("*")
            .eq("class_id", s.class_id)
            .order("exam_date", { ascending: false })
        : Promise.resolve({ data: [] as any[] });

      const marksPromise = s?.id
        ? supabase
            .from("marks")
            .select("*, exams(name, subject, max_marks, exam_date, exam_type)")
            .eq("student_id", s.id)
            .order("created_at", { ascending: false })
        : Promise.resolve({ data: [] as any[] });

      const [{ data: examList }, { data: markList }] = await Promise.all([examPromise, marksPromise]);
      setExams(examList ?? []);
      setMarks(markList ?? []);
      setLoading(false);
    })();
  }, [user]);

  const today = new Date().toISOString().split("T")[0];
  const upcoming = useMemo(
    () => exams.filter((e) => e.exam_date && e.exam_date >= today).sort((a, b) => (a.exam_date > b.exam_date ? 1 : -1)),
    [exams, today],
  );
  const past = useMemo(() => exams.filter((e) => !e.exam_date || e.exam_date < today), [exams, today]);

  const avgPct = useMemo(() => {
    const scored = marks.filter((m) => m.exams?.max_marks);
    if (!scored.length) return null;
    const sum = scored.reduce(
      (acc, m) => acc + (Number(m.marks_obtained) / Number(m.exams.max_marks)) * 100,
      0,
    );
    return Math.round(sum / scored.length);
  }, [marks]);

  const setTab = (value: string) => {
    if (value === "results") setSearchParams({ tab: "results" });
    else setSearchParams({});
  };

  if (loading) {
    return (
      <div className="sd-dashboard max-w-4xl mx-auto">
        <StudentListSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div className="sd-dashboard student-premium max-w-4xl mx-auto space-y-6 pb-8">
      {/* Hero */}
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
              const max = Number(r.exams?.max_marks) || 0;
              const obtained = Number(r.marks_obtained);
              const pct = max ? (obtained / max) * 100 : 0;
              const tone = scoreTone(pct);
              const dateStr = r.exams?.exam_date
                ? new Date(r.exams.exam_date).toLocaleDateString("en-IN", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                : null;

              return (
                <div
                  key={r.id}
                  className={cn(
                    "sd-card rounded-2xl p-5 border bg-gradient-to-br",
                    tone.bg,
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4 min-w-0">
                      <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                        <Trophy className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-foreground truncate">{r.exams?.name ?? "Exam"}</p>
                        <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
                          <BookOpen className="w-3.5 h-3.5 shrink-0" />
                          {r.exams?.subject ?? "Subject"}
                          {dateStr && (
                            <>
                              <span className="text-border">·</span>
                              <Calendar className="w-3.5 h-3.5 shrink-0" />
                              {dateStr}
                            </>
                          )}
                        </p>
                        {r.exams?.exam_type && (
                          <Badge
                            variant="outline"
                            className={cn("mt-2 text-[10px]", typeColors[r.exams.exam_type] || typeColors.other)}
                          >
                            {typeLabels[r.exams.exam_type] || r.exams.exam_type}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={cn("text-2xl font-bold tabular-nums", tone.text)}>
                        {obtained}
                        <span className="text-base font-medium text-muted-foreground">/{max}</span>
                      </p>
                      <p className={cn("text-sm font-semibold tabular-nums", tone.text)}>{pct.toFixed(0)}%</p>
                    </div>
                  </div>
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

function ExamCard({ exam, isUpcoming }: { exam: any; isUpcoming?: boolean }) {
  const dateStr = exam.exam_date
    ? new Date(exam.exam_date).toLocaleDateString("en-IN", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "Date TBD";

  const daysUntil = exam.exam_date
    ? Math.ceil((new Date(exam.exam_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
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
              {exam.subject}
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
          <Badge variant="outline" className={typeColors[exam.exam_type] || typeColors.other}>
            {typeLabels[exam.exam_type] || exam.exam_type}
          </Badge>
          <span className="text-xs font-medium text-muted-foreground tabular-nums">
            Max {exam.max_marks} marks
          </span>
        </div>
      </div>
    </div>
  );
}
