import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui-bits";
import { FileText } from "lucide-react";

export default function MyMarksPage({ asParent = false }: { asParent?: boolean }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      if (!user) return;
      const col = asParent ? "parent_user_id" : "user_id";
      const { data: ss } = await supabase.from("students").select("id, full_name").eq(col, user.id);
      const ids = ss?.map(s => s.id) ?? [];
      if (!ids.length) return;
      const { data } = await supabase.from("marks").select("*, exams(name, subject, max_marks, exam_date), students(full_name)").in("student_id", ids).order("created_at", { ascending: false });
      setRows(data ?? []);
    })();
  }, [user, asParent]);

  return (
    <>
      <PageHeader title="Marks" subtitle="Recent test results" />
      <div className="space-y-2">
        {rows.map(r => {
          const pct = r.exams?.max_marks ? (Number(r.marks_obtained) / Number(r.exams.max_marks)) * 100 : 0;
          const tone = pct >= 75 ? "text-accent" : pct >= 40 ? "text-warning" : "text-destructive";
          return (
            <Card key={r.id} className="p-4 flex items-center justify-between gap-3 shadow-card">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0"><FileText className="w-5 h-5" /></div>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{r.exams?.name}</div>
                  <div className="text-xs text-muted-foreground">{r.exams?.subject}{asParent && <> · {r.students?.full_name}</>}</div>
                </div>
              </div>
              <div className="text-right">
                <div className={`font-bold ${tone}`}>{r.marks_obtained}/{r.exams?.max_marks}</div>
                <div className="text-xs text-muted-foreground">{pct.toFixed(0)}%</div>
              </div>
            </Card>
          );
        })}
        {rows.length === 0 && <p className="text-muted-foreground text-center py-8">No marks yet.</p>}
      </div>
    </>
  );
}
