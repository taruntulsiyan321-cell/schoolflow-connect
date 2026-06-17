import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Target, Timer } from "lucide-react";
import { ScoreRing } from "@/components/dpp/ScoreRing";
import { QuestionRenderer, DppQuestion } from "@/components/dpp/QuestionRenderer";
import { PageHeader } from "@/components/ui-bits";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { ConceptRecoveryReport } from "@/components/student/ConceptRecoveryReport";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";

export default function DppResult() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [dpp, setDpp] = useState<any>(null);
  const [attempt, setAttempt] = useState<any>(null);
  const [questions, setQuestions] = useState<DppQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    if (!id || !user) return;
    setLoading(true);
    setLoadError(null);
    const { data: d, error: dErr } = await supabase.from("dpps").select("*").eq("id", id).maybeSingle();
    if (dErr) {
      setLoadError(dErr.message);
      setLoading(false);
      return;
    }
    setDpp(d);
    const { data: a, error: aErr } = await supabase.from("dpp_attempts").select("*").eq("dpp_id", id).eq("user_id", user.id).maybeSingle();
    if (aErr) {
      setLoadError(aErr.message);
      setLoading(false);
      return;
    }
    setAttempt(a);
    const { data: qs, error: qErr } = await supabase.from("dpp_questions").select("*").eq("dpp_id", id).order("order_index");
    if (qErr) {
      setLoadError(qErr.message);
      setLoading(false);
      return;
    }
    setQuestions((qs ?? []) as DppQuestion[]);
    if (a) {
      const { data: ans } = await supabase.from("dpp_answers").select("*").eq("attempt_id", a.id);
      const m: Record<string, any> = {};
      (ans ?? []).forEach((x) => { m[x.question_id] = x; });
      setAnswers(m);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [id, user]);

  if (loading) return <StudentListSkeleton rows={4} />;

  if (loadError) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/student"><ArrowLeft className="w-4 h-4" /> Dashboard</Link></Button>
        <StudentErrorState title="Could not load results" message={loadError} onRetry={load} />
      </>
    );
  }

  if (!dpp) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/student"><ArrowLeft className="w-4 h-4" /> Dashboard</Link></Button>
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">This DPP could not be found.</p>
        </Card>
      </>
    );
  }

  if (!attempt) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/student"><ArrowLeft className="w-4 h-4" /> Dashboard</Link></Button>
        <Card className="p-8 text-center">
          <Target className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">You haven't submitted this DPP yet.</p>
          <Button asChild className="mt-4"><Link to={`/student/dpp/${id}/attempt`}>Start attempt</Link></Button>
        </Card>
      </>
    );
  }

  const accuracy = attempt.total_count ? Math.round((attempt.correct_count / attempt.total_count) * 100) : 0;
  const mins = Math.round((attempt.time_spent_sec ?? 0) / 60);

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/student"><ArrowLeft className="w-4 h-4" /> Dashboard</Link></Button>
      <PageHeader title={dpp.title} subtitle={`${dpp.subject} · Submitted ${attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString() : "—"}`} />

      {attempt?.id && (
        <ConceptRecoveryReport sourceType="dpp_attempt" sourceId={attempt.id} title="DPP concept recovery report" />
      )}

      <Card className="p-6 mb-6 flex flex-col sm:flex-row items-center gap-6">
        <ScoreRing value={Number(attempt.score)} max={Number(attempt.max_score)} size={140} />
        <div className="grid grid-cols-2 gap-4 flex-1 w-full">
          <div className="flex items-center gap-3"><Target className="w-5 h-5 text-accent" /><div><div className="text-xs text-muted-foreground">Accuracy</div><div className="font-bold text-lg">{accuracy}%</div></div></div>
          <div className="flex items-center gap-3"><Timer className="w-5 h-5 text-primary" /><div><div className="text-xs text-muted-foreground">Time</div><div className="font-bold text-lg">{mins}m</div></div></div>
          <div><div className="text-xs text-muted-foreground">Correct</div><div className="font-bold text-lg">{attempt.correct_count}/{attempt.total_count}</div></div>
          <div><div className="text-xs text-muted-foreground">Score</div><div className="font-bold text-lg">{Number(attempt.score).toFixed(1)} / {Number(attempt.max_score).toFixed(0)}</div></div>
        </div>
      </Card>

      {accuracy < 100 && (
        <Card className="p-4 mb-6 border-primary/20 bg-primary/5">
          <h3 className="font-semibold text-sm mb-2">Improvement focus</h3>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
            {accuracy < 60 && <li>Review wrong answers below — they were added to your Mistake Book automatically.</li>}
            {accuracy < 80 && <li>Revise weak topics from your Dashboard before the next DPP.</li>}
            <li>Use &quot;Explain my mistake&quot; on each wrong question to understand the concept, not just the answer.</li>
          </ul>
        </Card>
      )}

      <h3 className="font-semibold mb-3">Question review</h3>
      <div className="space-y-4">
        {questions.map((q, i) => {
          const a = answers[q.id];
          const resp = (a?.response as any) ?? {};
          const opts: string[] = Array.isArray(q.options) ? q.options : [];
          const correctIdx =
            Array.isArray(q.correct?.indexes) ? q.correct.indexes[0] ?? null
            : typeof (q.correct as { correct_index?: number })?.correct_index === "number"
              ? (q.correct as { correct_index: number }).correct_index
              : null;
          const selectedIdx = Array.isArray(resp.indexes) ? resp.indexes[0] ?? null : null;
          const correctText = q.correct?.text ?? (q.correct?.value !== undefined ? String(q.correct.value) : "");
          const selectedText = resp.text ?? (resp.value !== undefined ? String(resp.value) : "");
          return (
            <Card key={q.id} className="p-5">
              <div className="text-xs text-muted-foreground mb-2">Q{i + 1}</div>
              <QuestionRenderer
                question={q}
                mode="review"
                value={resp}
                isCorrect={a?.is_correct ?? null}
              />
              <ExplainPanel
                question={q.question}
                options={opts}
                correctIndex={correctIdx}
                selectedIndex={selectedIdx}
                correctText={correctText}
                selectedText={selectedText}
                subject={dpp?.subject}
                topic={(q as any).topic ?? ""}
                wasCorrect={a?.is_correct ?? null}
              />
            </Card>
          );
        })}
      </div>
    </>
  );
}
