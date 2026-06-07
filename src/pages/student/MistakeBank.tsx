import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-bits";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { BookMarked, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function MistakeBank() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from("student_mistakes")
      .select("*")
      .eq("user_id", user.id)
      .eq("mastered", false)
      .order("last_wrong_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const markMastered = async (id: string) => {
    const { error } = await supabase.from("student_mistakes").update({ mastered: true }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Marked as mastered");
    load();
  };

  return (
    <>
      <PageHeader
        title="My Mistake Book"
        subtitle="Every wrong answer is saved so you can learn from it — not forget it"
      />
      {loading && <p className="text-muted-foreground text-center py-8">Loading…</p>}
      {!loading && rows.length === 0 && (
        <Card className="p-8 text-center">
          <BookMarked className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No mistakes saved yet. Wrong DPP answers appear here automatically.</p>
        </Card>
      )}
      {!loading && (
      <div className="space-y-4">
        {rows.map((m) => (
          <Card key={m.id} className="p-4 shadow-card">
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge>{m.subject}</Badge>
              {m.chapter && <Badge variant="outline">{m.chapter}</Badge>}
              <Badge variant="outline" className="text-warning">×{m.times_wrong}</Badge>
            </div>
            <p className="font-medium">{m.question_text}</p>
            {m.explanation && <p className="text-sm text-muted-foreground mt-2">{m.explanation}</p>}
            <div className="flex flex-wrap gap-2 mt-3">
              <ExplainPanel
                question={m.question_text}
                options={Array.isArray(m.options) ? m.options : (m.options as string[] | undefined) ?? []}
                correctIndex={
                  m.correct_answer?.correct_index ??
                  (Array.isArray(m.correct_answer?.indexes) ? m.correct_answer.indexes[0] : null)
                }
                selectedIndex={
                  m.student_answer?.selected_index ??
                  (Array.isArray(m.student_answer?.indexes) ? m.student_answer.indexes[0] : null)
                }
                wasCorrect={false}
                subject={m.subject}
                chapter={m.chapter}
              />
              <Button size="sm" variant="outline" onClick={() => markMastered(m.id)}>
                <CheckCircle2 className="w-4 h-4 mr-1" /> Mastered
              </Button>
            </div>
          </Card>
        ))}
      </div>
      )}
    </>
  );
}
