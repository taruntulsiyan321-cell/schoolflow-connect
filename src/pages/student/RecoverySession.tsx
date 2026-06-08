import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PageHeader } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { StudentSessionSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";

type RecoveryQuestion = {
  id: string;
  order_index: number;
  question_text: string;
  options: string[];
  answered: boolean;
  is_correct?: boolean;
  explanation?: string;
};

export default function RecoverySession() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<any>(null);
  const [questions, setQuestions] = useState<RecoveryQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const { data, error } = await (supabase as any).rpc("rpc_get_recovery_assignment", {
        _assignment_id: id,
      });
      if (error) {
        setLoadError(error.message);
        setLoading(false);
        return;
      }
      setAssignment(data?.assignment);
      const qs = (data?.questions ?? []).map((q: any) => ({
        ...q,
        options: Array.isArray(q.options) ? q.options : [],
      }));
      setQuestions(qs);
      const firstUnanswered = qs.findIndex((q: RecoveryQuestion) => !q.answered);
      setIdx(firstUnanswered >= 0 ? firstUnanswered : 0);
      setLoading(false);
    })();
  }, [id]);

  const current = questions[idx];

  const submit = async (optionIndex: number) => {
    if (!current || revealed) return;
    setSelected(optionIndex);
    setRevealed(true);

    const correctIdx = (current as any).correct_answer?.correct_index ?? 0;
    const ok = optionIndex === correctIdx;

    const { data, error } = await (supabase as any).rpc("rpc_submit_recovery_answer", {
      _question_id: current.id,
      _student_answer: { selected_index: optionIndex, text: current.options[optionIndex] },
      _is_correct: ok,
    });
    if (error) toast.error(error.message);
    else if (data?.completed) setDone(true);
  };

  const next = () => {
    setRevealed(false);
    setSelected(null);
    if (idx + 1 >= questions.length) {
      setDone(true);
      return;
    }
    setIdx(idx + 1);
  };

  if (loading) {
    return <StudentSessionSkeleton label="Loading recovery session…" />;
  }

  if (loadError) {
    return (
      <div className="max-w-md mx-auto space-y-4">
        <StudentErrorState title="Could not load recovery session" message={loadError} onRetry={() => window.location.reload()} />
        <div className="text-center">
          <Button asChild variant="outline"><Link to="/student/recovery">Back to Recovery Zone</Link></Button>
        </div>
      </div>
    );
  }

  if (!assignment || questions.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">No recovery questions found.</p>
        <Button asChild className="mt-4"><Link to="/student/recovery">Back to Recovery Zone</Link></Button>
      </Card>
    );
  }

  if (done) {
    return (
      <Card className="p-8 max-w-md mx-auto text-center shadow-card">
        <CheckCircle2 className="w-12 h-12 mx-auto text-accent mb-3" />
        <h2 className="text-xl font-semibold">Recovery complete</h2>
        <p className="text-muted-foreground mt-2">{assignment.concept} — {assignment.subject}</p>
        <div className="flex gap-2 mt-6 justify-center">
          <Button asChild variant="outline"><Link to="/student/recovery">Recovery Zone</Link></Button>
          <Button asChild><Link to="/student/mistakes">Mistake book</Link></Button>
        </div>
      </Card>
    );
  }

  const pct = ((idx + (revealed ? 1 : 0)) / questions.length) * 100;
  const correctIdx = (current as any).correct_answer?.correct_index ?? 0;

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2">
        <Link to="/student/recovery"><ArrowLeft className="w-4 h-4" /> Recovery Zone</Link>
      </Button>

      <PageHeader
        title={`Recovery: ${assignment.concept}`}
        subtitle={`${assignment.subject}${assignment.chapter ? ` · ${assignment.chapter}` : ""} · ${assignment.severity} priority`}
      />

      <Progress value={pct} className="h-1.5 mb-4" />
      <p className="text-xs text-muted-foreground mb-4">Question {idx + 1} of {questions.length}</p>

      <Card className="p-5 shadow-card">
        <p className="font-medium leading-relaxed">{current.question_text}</p>
        <div className="grid gap-2 mt-4">
          {current.options.map((opt, oi) => (
            <button
              key={oi}
              type="button"
              disabled={revealed}
              onClick={() => submit(oi)}
              className={cn(
                "text-left px-4 py-3 rounded-lg border text-sm transition-colors",
                !revealed && "hover:border-primary/40 hover:bg-primary/5",
                revealed && oi === correctIdx && "border-accent bg-accent/10",
                revealed && oi === selected && oi !== correctIdx && "border-destructive bg-destructive/10",
              )}
            >
              <span className="font-semibold mr-2">{String.fromCharCode(65 + oi)}.</span>
              {opt}
            </button>
          ))}
        </div>

        {revealed && (
          <div className="mt-4 space-y-3">
            <div className={cn("flex items-center gap-2 text-sm font-medium", selected === correctIdx ? "text-accent" : "text-destructive")}>
              {selected === correctIdx ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {selected === correctIdx ? "Correct — concept reinforced!" : "Review the explanation and try similar questions."}
            </div>
            {current.explanation && <p className="text-sm text-muted-foreground">{current.explanation}</p>}
            <Button className="w-full" onClick={next}>
              {idx + 1 >= questions.length ? "Finish recovery" : "Next question"}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
