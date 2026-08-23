import { useEffect, useMemo, useState } from "react";
import { EXAM_TYPE_LABELS, MarksService, useAcademicContext } from "@/academic";
import type { ExamRecord } from "@/academic/repository/marksRepository";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { FileText, Calendar, Clock, BookOpen } from "lucide-react";
import { displaySubject } from "@/lib/academicPresentation";
import { StudentErrorState } from "@/components/student/StudentPanelStates";
import { toErrorMessage } from "@/lib/presentation";

const typeColors: Record<string, string> = {
  class_test: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  unit_test: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  monthly_test: "bg-sky-500/10 text-sky-600 border-sky-500/30",
  mid_term: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
  half_yearly: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  annual: "bg-red-500/10 text-red-600 border-red-500/30",
  final: "bg-red-500/10 text-red-600 border-red-500/30",
  other: "bg-muted text-muted-foreground",
};

function examTypeLabel(type: string | null | undefined) {
  if (!type) return "Exam";
  return EXAM_TYPE_LABELS[type] ?? type;
}

/**
 * Student exam schedule — MarksService only (legacy surface; prefer Tests / Exams & Results).
 */
export default function StudentExamsPage() {
  const { ctx, ready, classId, studentId } = useAcademicContext();
  const [exams, setExams] = useState<ExamRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!ready || !ctx) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (!classId) {
        setExams([]);
        return;
      }
      const rows = await MarksService.listExamsForClass(ctx, classId, { limit: 100 });
      setExams(rows);
    } catch (e) {
      setError(toErrorMessage(e, "Could not load exams"));
      setExams([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx, classId]);

  const today = new Date().toISOString().split("T")[0];
  const upcoming = useMemo(
    () => exams.filter((e) => e.examDate && e.examDate >= today),
    [exams, today],
  );
  const past = useMemo(
    () => exams.filter((e) => !e.examDate || e.examDate < today),
    [exams, today],
  );

  if (loading) {
    return <p className="text-muted-foreground text-center py-8">Loading…</p>;
  }

  if (!studentId) {
    return (
      <p className="text-muted-foreground text-center py-8">
        No student profile linked to this account.
      </p>
    );
  }

  if (error) {
    return <StudentErrorState title="Could not load exams" message={error} onRetry={load} />;
  }

  return (
    <>
      <PageHeader title="Exams" subtitle="Upcoming exams and date sheet" />

      <div className="grid grid-cols-2 gap-4 mb-4">
        <StatCard
          icon={<Clock className="w-5 h-5" />}
          label="Upcoming"
          value={upcoming.length}
          tone="warning"
        />
        <StatCard
          icon={<FileText className="w-5 h-5" />}
          label="Completed"
          value={past.length}
          tone="accent"
        />
      </div>

      {upcoming.length > 0 && (
        <>
          <h3 className="font-semibold mb-3">Upcoming Exams</h3>
          <div className="space-y-2 mb-6">
            {upcoming
              .slice()
              .sort((a, b) => String(a.examDate).localeCompare(String(b.examDate)))
              .map((e) => (
                <ExamCard key={e.id} exam={e} isUpcoming />
              ))}
          </div>
        </>
      )}

      {past.length > 0 && (
        <>
          <h3 className="font-semibold mb-3">Past Exams</h3>
          <div className="space-y-2">
            {past.map((e) => (
              <ExamCard key={e.id} exam={e} />
            ))}
          </div>
        </>
      )}

      {exams.length === 0 && (
        <Card className="p-8 text-center">
          <FileText className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No exams scheduled for your class yet.</p>
        </Card>
      )}
    </>
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
    <Card className={`p-4 shadow-card ${isUpcoming ? "border-l-4 border-l-primary" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{exam.name}</div>
          <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            {displaySubject(exam.subject) || "—"}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
            <Calendar className="w-3.5 h-3.5 shrink-0" />
            {dateStr}
            {isUpcoming && daysUntil !== null && daysUntil >= 0 && (
              <span className="ml-1 text-primary font-medium">
                · {daysUntil === 0 ? "Today!" : daysUntil === 1 ? "Tomorrow" : `in ${daysUntil} days`}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Badge variant="outline" className={typeColors[exam.examType] || typeColors.other}>
            {examTypeLabel(exam.examType)}
          </Badge>
          <span className="text-xs text-muted-foreground">Max: {exam.maxMarks}</span>
        </div>
      </div>
    </Card>
  );
}
