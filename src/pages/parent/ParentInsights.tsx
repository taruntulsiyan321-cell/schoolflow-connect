import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { Progress } from "@/components/ui/progress";
import { ClipboardCheck, NotebookPen, Trophy, Wallet } from "lucide-react";

type ChildInsight = {
  id: string;
  name: string;
  classLabel: string;
  attPct: number;
  homeworkDone: number;
  homeworkTotal: number;
  avgMarksPct: number;
  pendingFees: number;
};

export default function ParentInsights() {
  const { user } = useAuth();
  const [kids, setKids] = useState<ChildInsight[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      const { data: students } = await supabase
        .from("students")
        .select("id, full_name, class_id, classes(name,section)")
        .eq("parent_user_id", user.id);

      const insights: ChildInsight[] = [];
      for (const s of students ?? []) {
        const classLabel = s.classes ? `Class ${s.classes.name}-${s.classes.section}` : "Unassigned";

        const { data: att } = await supabase.from("attendance").select("status").eq("student_id", s.id);
        const attTotal = att?.length ?? 0;
        const present = att?.filter((a) => a.status === "present").length ?? 0;
        const attPct = attTotal ? Math.round((present / attTotal) * 100) : 0;

        let homeworkDone = 0;
        let homeworkTotal = 0;
        const hwIds: string[] = [];
        if (s.class_id) {
          const { data: hw } = await supabase.from("homework").select("id").eq("class_id", s.class_id);
          hwIds.push(...(hw ?? []).map((h) => h.id));
          homeworkTotal = hwIds.length;
        }
        if (hwIds.length) {
          const { data: subs } = await supabase
            .from("homework_submissions")
            .select("homework_id, status")
            .eq("student_id", s.id)
            .in("homework_id", hwIds);
          homeworkDone = (subs ?? []).filter((x) => x.status === "submitted" || x.status === "graded").length;
          homeworkTotal = hwIds.length;
        }

        let avgMarksPct = 0;
        if (s.class_id) {
          const { data: exams } = await supabase.from("exams").select("id, max_marks").eq("class_id", s.class_id);
          const examIds = (exams ?? []).map((e) => e.id);
          const maxByExam: Record<string, number> = {};
          exams?.forEach((e) => {
            maxByExam[e.id] = Number(e.max_marks) || 100;
          });
          if (examIds.length) {
            const { data: marks } = await supabase
              .from("marks")
              .select("marks_obtained, exam_id")
              .eq("student_id", s.id)
              .in("exam_id", examIds);
            const pcts = (marks ?? [])
              .map((m) => {
                const max = maxByExam[m.exam_id] || 100;
                return max ? (Number(m.marks_obtained) / max) * 100 : 0;
              })
              .filter((p) => !Number.isNaN(p));
            avgMarksPct = pcts.length ? Math.round(pcts.reduce((a, b) => a + b, 0) / pcts.length) : 0;
          }
        }

        const { data: fees } = await supabase.from("fees").select("amount, paid_amount, status").eq("student_id", s.id);
        const pendingFees = (fees ?? [])
          .filter((f) => f.status !== "paid")
          .reduce((sum, f) => sum + (Number(f.amount) - Number(f.paid_amount || 0)), 0);

        insights.push({
          id: s.id,
          name: s.full_name,
          classLabel,
          attPct,
          homeworkDone,
          homeworkTotal,
          avgMarksPct,
          pendingFees,
        });
      }
      setKids(insights);
      setLoading(false);
    })();
  }, [user]);

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

  return (
    <>
      <PageHeader title="Engagement insights" subtitle="Attendance, homework, marks, and fees at a glance" />
      {loading ? (
        <p className="text-sm text-muted-foreground text-center py-10">Loading insights…</p>
      ) : kids.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground text-center">Link a student to your account to see insights.</Card>
      ) : (
        <div className="space-y-6">
          {kids.map((k) => {
            const hwPct = k.homeworkTotal ? Math.round((k.homeworkDone / k.homeworkTotal) * 100) : 0;
            return (
              <Card key={k.id} className="p-5 shadow-card space-y-4">
                <div>
                  <div className="font-bold text-lg">{k.name}</div>
                  <div className="text-sm text-muted-foreground">{k.classLabel}</div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard icon={<ClipboardCheck className="w-5 h-5" />} label="Attendance" value={`${k.attPct}%`} />
                  <StatCard icon={<NotebookPen className="w-5 h-5" />} label="Homework done" value={`${hwPct}%`} tone="accent" />
                  <StatCard icon={<Trophy className="w-5 h-5" />} label="Avg marks" value={`${k.avgMarksPct}%`} />
                  <StatCard icon={<Wallet className="w-5 h-5" />} label="Pending fees" value={fmt(k.pendingFees)} tone={k.pendingFees > 0 ? "warning" : undefined} />
                </div>
                <div>
                  <div>
                    Homework completion ({k.homeworkDone}/{k.homeworkTotal})
                  </div>
                  <Progress value={hwPct} className="h-2" />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
