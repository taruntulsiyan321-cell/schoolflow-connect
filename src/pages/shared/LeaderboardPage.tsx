import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui-bits";
import { Trophy, Medal, Award } from "lucide-react";

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [classLabel, setClassLabel] = useState("");

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: me } = await supabase.from("students").select("class_id, classes(name,section)").eq("user_id", user.id).maybeSingle();
      if (!me?.class_id) return;
      setClassLabel(`Class ${me.classes?.name}-${me.classes?.section}`);

      // exams in my class
      const { data: exams } = await supabase.from("exams").select("id, max_marks").eq("class_id", me.class_id);
      const examIds = exams?.map(e => e.id) ?? [];
      if (!examIds.length) return;
      const maxByExam: Record<string, number> = {};
      exams!.forEach(e => { maxByExam[e.id] = Number(e.max_marks); });

      const { data: marks } = await supabase.from("marks").select("student_id, exam_id, marks_obtained").in("exam_id", examIds);
      const { data: classmates } = await supabase.from("students").select("id, full_name, roll_number").eq("class_id", me.class_id);

      const totals: Record<string, { total: number; max: number }> = {};
      marks?.forEach(m => {
        if (!totals[m.student_id]) totals[m.student_id] = { total: 0, max: 0 };
        totals[m.student_id].total += Number(m.marks_obtained);
        totals[m.student_id].max += maxByExam[m.exam_id] ?? 0;
      });

      const ranked = (classmates ?? [])
        .map(s => {
          const t = totals[s.id] ?? { total: 0, max: 0 };
          const pct = t.max ? (t.total / t.max) * 100 : 0;
          return { ...s, total: t.total, max: t.max, pct };
        })
        .sort((a, b) => b.pct - a.pct);
      setRows(ranked);
    })();
  }, [user]);

  return (
    <>
      <PageHeader title="Class Leaderboard" subtitle={classLabel} />
      <div className="space-y-2">
        {rows.map((r, i) => {
          const Icon = i === 0 ? Trophy : i === 1 ? Medal : i === 2 ? Award : null;
          const tone = i === 0 ? "bg-warning/15 text-warning" : i === 1 ? "bg-muted text-muted-foreground" : i === 2 ? "bg-accent/10 text-accent" : "bg-primary/10 text-primary";
          return (
            <Card key={r.id} className="p-4 flex items-center gap-3 shadow-card">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold ${tone}`}>
                {Icon ? <Icon className="w-5 h-5" /> : i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{r.full_name}</div>
                <div className="text-xs text-muted-foreground">Roll {r.roll_number || "-"}</div>
              </div>
              <div className="text-right">
                <div className="font-bold">{r.pct.toFixed(1)}%</div>
                <div className="text-xs text-muted-foreground">{r.total}/{r.max}</div>
              </div>
            </Card>
          );
        })}
        {rows.length === 0 && <p className="text-muted-foreground text-center py-8">No results yet.</p>}
      </div>
    </>
  );
}
