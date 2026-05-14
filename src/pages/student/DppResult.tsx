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

export default function DppResult() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [dpp, setDpp] = useState<any>(null);
  const [attempt, setAttempt] = useState<any>(null);
  const [questions, setQuestions] = useState<DppQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, any>>({});

  useEffect(() => {
    (async () => {
      if (!id || !user) return;
      const { data: d } = await supabase.from("dpps").select("*").eq("id", id).maybeSingle();
      setDpp(d);
      const { data: a } = await supabase.from("dpp_attempts").select("*").eq("dpp_id", id).eq("user_id", user.id).maybeSingle();
      setAttempt(a);
      const { data: qs } = await supabase.from("dpp_questions").select("*").eq("dpp_id", id).order("order_index");
      setQuestions((qs ?? []) as any);
      if (a) {
        const { data: ans } = await supabase.from("dpp_answers").select("*").eq("attempt_id", a.id);
        const m: Record<string, any> = {};
        (ans ?? []).forEach(x => m[x.question_id] = x);
        setAnswers(m);
      }
    })();
  }, [id, user]);

  if (!dpp || !attempt) return <p className="text-muted-foreground">Loading…</p>;

  const accuracy = attempt.total_count ? Math.round((attempt.correct_count / attempt.total_count) * 100) : 0;
  const mins = Math.round(attempt.time_spent_sec / 60);

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/student/dpp"><ArrowLeft className="w-4 h-4" /> All DPPs</Link></Button>
      <PageHeader title={dpp.title} subtitle={`${dpp.subject} · Submitted ${attempt.submitted_at ? new Date(attempt.submitted_at).toLocaleString() : "—"}`} />

      <Card className="p-6 mb-6 flex flex-col sm:flex-row items-center gap-6">
        <ScoreRing value={Number(attempt.score)} max={Number(attempt.max_score)} size={140} />
        <div className="grid grid-cols-2 gap-4 flex-1 w-full">
          <div className="flex items-center gap-3"><Target className="w-5 h-5 text-accent" /><div><div className="text-xs text-muted-foreground">Accuracy</div><div className="font-bold text-lg">{accuracy}%</div></div></div>
          <div className="flex items-center gap-3"><Timer className="w-5 h-5 text-primary" /><div><div className="text-xs text-muted-foreground">Time</div><div className="font-bold text-lg">{mins}m</div></div></div>
          <div><div className="text-xs text-muted-foreground">Correct</div><div className="font-bold text-lg">{attempt.correct_count}/{attempt.total_count}</div></div>
          <div><div className="text-xs text-muted-foreground">Score</div><div className="font-bold text-lg">{Number(attempt.score).toFixed(1)} / {Number(attempt.max_score).toFixed(0)}</div></div>
        </div>
      </Card>

      <h3 className="font-semibold mb-3">Question review</h3>
      <div className="space-y-4">
        {questions.map((q, i) => {
          const a = answers[q.id];
          return (
            <Card key={q.id} className="p-5">
              <div className="text-xs text-muted-foreground mb-2">Q{i + 1}</div>
              <QuestionRenderer
                question={q}
                mode="review"
                value={(a?.response as any) ?? {}}
                isCorrect={a?.is_correct ?? null}
              />
            </Card>
          );
        })}
      </div>
    </>
  );
}
