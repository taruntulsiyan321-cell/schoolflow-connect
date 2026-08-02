import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-bits";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { Link } from "react-router-dom";
import { BookMarked, CheckCircle2, Wrench } from "lucide-react";
import { toast } from "sonner";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { displayChapter, displayConcept, displayTopic } from "@/lib/academicDisplay";

export default function MistakeBank() {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [masteringId, setMasteringId] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("student_mistakes")
      .select("*")
      .eq("user_id", user.id)
      .eq("mastered", false)
      .order("last_wrong_at", { ascending: false });
    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }
    setRows(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user]);

  const markMastered = async (id: string) => {
    if (masteringId) return;
    setMasteringId(id);
    const { error } = await supabase.from("student_mistakes").update({ mastered: true }).eq("id", id);
    if (error) {
      toast.error(error.message);
      setMasteringId(null);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast.success("Marked as mastered");
    setMasteringId(null);
  };

  return (
    <>
      <PageHeader
        title="My Mistake Book"
        subtitle="Every wrong answer is saved so you can learn from it — not forget it"
        action={
          <Button size="sm" asChild>
            <Link to="/student/recovery"><Wrench className="w-4 h-4 mr-1" /> Recovery zone</Link>
          </Button>
        }
      />
      {loading && <StudentListSkeleton rows={4} />}
      {!loading && loadError && (
        <StudentErrorState title="Could not load mistakes" message={loadError} onRetry={load} />
      )}
      {!loading && !loadError && rows.length === 0 && (
        <Card className="p-8 text-center">
          <BookMarked className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No mistakes saved yet. Wrong answers from DPPs, battles, and self-practice appear here automatically.</p>
        </Card>
      )}
      {!loading && !loadError && rows.length > 0 && (
      <div className="space-y-4">
        {rows.map((m) => (
          <Card key={m.id} className="p-4 shadow-card">
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge>{m.subject}</Badge>
              {m.assessment_type && <Badge variant="secondary">{m.assessment_type}</Badge>}
              {m.chapter && <Badge variant="outline">{displayChapter(m.chapter)}</Badge>}
              {(m.concept || m.topic) && <Badge variant="outline">{displayConcept(m.concept ?? m.topic)}</Badge>}
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
              <Button
                size="sm"
                variant="outline"
                disabled={masteringId === m.id}
                onClick={() => markMastered(m.id)}
              >
                <CheckCircle2 className="w-4 h-4 mr-1" /> {masteringId === m.id ? "Saving…" : "Mastered"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
      )}
    </>
  );
}
