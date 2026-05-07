import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { FileText, Calendar, Clock, BookOpen } from "lucide-react";

const typeColors: Record<string, string> = {
  class_test: "bg-blue-500/10 text-blue-600 border-blue-500/30",
  unit_test: "bg-violet-500/10 text-violet-600 border-violet-500/30",
  half_yearly: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  final: "bg-red-500/10 text-red-600 border-red-500/30",
  other: "bg-muted text-muted-foreground",
};

const typeLabels: Record<string, string> = {
  class_test: "Class Test",
  unit_test: "Unit Test",
  half_yearly: "Half Yearly",
  final: "Final",
  other: "Other",
};

export default function StudentExamsPage() {
  const { user } = useAuth();
  const [exams, setExams] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      // Find the student's class
      const { data: s } = await supabase
        .from("students")
        .select("class_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!s?.class_id) {
        setLoading(false);
        return;
      }

      // Fetch exams for this class
      const { data: examList } = await supabase
        .from("exams")
        .select("*")
        .eq("class_id", s.class_id)
        .order("exam_date", { ascending: false });

      setExams(examList ?? []);
      setLoading(false);
    })();
  }, [user]);

  if (loading) {
    return <p className="text-muted-foreground text-center py-8">Loading…</p>;
  }

  const today = new Date().toISOString().split("T")[0];
  const upcoming = exams.filter((e) => e.exam_date && e.exam_date >= today);
  const past = exams.filter((e) => !e.exam_date || e.exam_date < today);

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

      {/* Upcoming exams */}
      {upcoming.length > 0 && (
        <>
          <h3 className="font-semibold mb-3">📅 Upcoming Exams</h3>
          <div className="space-y-2 mb-6">
            {upcoming
              .sort((a, b) => (a.exam_date > b.exam_date ? 1 : -1))
              .map((e) => (
                <ExamCard key={e.id} exam={e} isUpcoming />
              ))}
          </div>
        </>
      )}

      {/* Past exams */}
      {past.length > 0 && (
        <>
          <h3 className="font-semibold mb-3">✅ Past Exams</h3>
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
    ? Math.ceil((new Date(exam.exam_date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <Card className={`p-4 shadow-card ${isUpcoming ? "border-l-4 border-l-primary" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{exam.name}</div>
          <div className="text-sm text-muted-foreground mt-1 flex items-center gap-1">
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            {exam.subject}
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
          <Badge variant="outline" className={typeColors[exam.exam_type] || typeColors.other}>
            {typeLabels[exam.exam_type] || exam.exam_type}
          </Badge>
          <span className="text-xs text-muted-foreground">Max: {exam.max_marks}</span>
        </div>
      </div>
    </Card>
  );
}
