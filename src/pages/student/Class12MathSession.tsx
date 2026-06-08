import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { generateFromTemplate } from "@/engines/class12Math/generate";
import type { GeneratedQuestion, QuestionTemplateRow } from "@/engines/class12Math/types";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { toast } from "sonner";
import { ConceptRecoveryReport } from "@/components/student/ConceptRecoveryReport";
import { StudentSessionSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";

type SessionItem = {
  template: QuestionTemplateRow;
  generated: GeneratedQuestion;
};

export default function Class12MathSession() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const chapter = params.get("chapter") ?? "Matrices";
  const count = Math.min(20, Math.max(1, Number(params.get("count") ?? 10)));

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<SessionItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [correctN, setCorrectN] = useState(0);
  const [done, setDone] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  const sessionSeed = useMemo(() => Date.now() ^ chapter.length * 997, [chapter]);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const { data: sid, error: sErr } = await supabase.rpc("rpc_start_practice_session", {
        _subject: "Mathematics",
        _chapter: chapter,
        _count: count,
      });
      if (sErr) {
        setLoadError(sErr.message);
        setLoading(false);
        return;
      }
      setSessionId(sid as string);

      const { data: templates, error: tErr } = await supabase.rpc("rpc_pick_question_templates", {
        _class: 12,
        _subject: "Mathematics",
        _chapter: chapter,
        _count: count,
      });
      if (tErr) {
        setLoadError(tErr.message);
        setLoading(false);
        return;
      }
      const rows = (templates ?? []) as QuestionTemplateRow[];
      if (rows.length === 0) {
        setLoadError("No question templates for this chapter yet. Ask your admin to seed Class 12 math templates.");
        setLoading(false);
        return;
      }

      const built: SessionItem[] = rows.map((t, i) => ({
        template: t,
        generated: generateFromTemplate(t, sessionSeed + i * 7919),
      }));
      setItems(built);
      setLoading(false);
    })();
  }, [user, chapter, count, sessionSeed]);

  const current = items[idx];

  const submitAnswer = async (optionIndex: number) => {
    if (!current || !sessionId || revealed) return;
    setSelected(optionIndex);
    setRevealed(true);
    const ok = optionIndex === current.generated.correctIndex;
    if (ok) setCorrectN((n) => n + 1);

    await supabase.rpc("rpc_record_question_attempt", {
      _session_id: sessionId,
      _template_id: current.template.id,
      _generated_question: {
        question: current.generated.question,
        options: current.generated.options,
        values: current.generated.values,
        session_seed: sessionSeed + idx * 7919,
      },
      _correct_answer: { index: current.generated.correctIndex, text: current.generated.correctAnswer },
      _selected_answer: { index: optionIndex, text: current.generated.options[optionIndex] },
      _is_correct: ok,
      _score: ok ? 1 : 0,
    });
  };

  const next = async () => {
    setRevealed(false);
    setSelected(null);
    if (idx + 1 >= items.length) {
      const { data: sum, error: finErr } = await supabase.rpc("rpc_finish_practice_session", { _session_id: sessionId });
      if (finErr) toast.error(finErr.message);
      setSummary(sum ?? {
        correct_count: correctN,
        question_count: items.length,
        chapter,
        subject: "Mathematics",
      });
      setDone(true);
      return;
    }
    setIdx(idx + 1);
  };

  if (loading) {
    return <StudentSessionSkeleton label="Generating fresh questions…" />;
  }

  if (loadError) {
    return (
      <div className="max-w-md mx-auto space-y-4">
        <StudentErrorState
          title="Could not start practice"
          hint="Apply the question template migration in Supabase, then try again."
          message={loadError}
          onRetry={() => window.location.reload()}
        />
        <div className="text-center">
          <Button asChild variant="outline"><Link to="/student/practice/math12">Back to chapter picker</Link></Button>
        </div>
      </div>
    );
  }

  if (done && summary) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <Card className="p-8 text-center shadow-card">
          <CheckCircle2 className="w-12 h-12 mx-auto text-accent mb-3" />
          <h2 className="text-xl font-semibold">Session complete</h2>
          <p className="text-muted-foreground mt-2">{chapter}</p>
          <div className="text-3xl font-bold mt-4">{summary.correct_count}/{summary.question_count}</div>
          <p className="text-sm text-muted-foreground">correct answers</p>
          <div className="flex gap-2 mt-6 justify-center flex-wrap">
            <Button asChild variant="outline"><Link to="/student/practice/math12">New chapter</Link></Button>
            <Button onClick={() => nav(`/student/practice/math12/session?chapter=${encodeURIComponent(chapter)}&count=${count}`)}>Same chapter again</Button>
          </div>
          <div className="flex gap-2 mt-3 justify-center flex-wrap text-sm">
            <Button asChild size="sm" variant="ghost"><Link to="/student/mistakes">Mistake book</Link></Button>
            <Button asChild size="sm" variant="ghost"><Link to="/student/plans">Improvement plans</Link></Button>
            <Button asChild size="sm" variant="ghost"><Link to="/student">Growth dashboard</Link></Button>
          </div>
        </Card>
        {sessionId && (
          <ConceptRecoveryReport sourceType="practice_session" sourceId={sessionId} title="Practice concept recovery report" />
        )}
      </div>
    );
  }

  if (!current) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">No questions loaded.</p>
        <Button asChild className="mt-4"><Link to="/student/practice/math12">Back</Link></Button>
      </Card>
    );
  }

  const pct = ((idx + (revealed ? 1 : 0)) / items.length) * 100;

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-rise">
      <button type="button" onClick={() => nav(-1)} className="text-sm text-muted-foreground flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Exit
      </button>

      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>{chapter}</span>
          <span>Q {idx + 1} / {items.length} · {correctN} correct</span>
        </div>
        <Progress value={pct} className="h-1.5" />
      </div>

      <Card className="p-5 shadow-card">
        <p className="font-medium leading-relaxed">{current.generated.question}</p>
        <div className="grid gap-2 mt-4">
          {current.generated.options.map((opt, oi) => {
            const isCorrect = oi === current.generated.correctIndex;
            const isSel = oi === selected;
            return (
              <button
                key={oi}
                type="button"
                disabled={revealed}
                onClick={() => submitAnswer(oi)}
                className={cn(
                  "text-left px-4 py-3 rounded-lg border text-sm transition-colors",
                  !revealed && "hover:border-primary/40 hover:bg-primary/5",
                  revealed && isCorrect && "border-accent bg-accent/10",
                  revealed && isSel && !isCorrect && "border-destructive bg-destructive/10",
                )}
              >
                <span className="font-semibold mr-2">{String.fromCharCode(65 + oi)}.</span>
                {opt}
              </button>
            );
          })}
        </div>

        {revealed && (
          <div className="mt-4 space-y-3">
            <div className={cn("flex items-center gap-2 text-sm font-medium", selected === current.generated.correctIndex ? "text-accent" : "text-destructive")}>
              {selected === current.generated.correctIndex ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {selected === current.generated.correctIndex ? "Correct!" : `Answer: ${current.generated.correctAnswer}`}
            </div>
            <p className="text-sm text-muted-foreground">{current.generated.explanation}</p>
            <ExplainPanel
              question={current.generated.question}
              options={current.generated.options}
              correctIndex={current.generated.correctIndex}
              selectedIndex={selected}
              wasCorrect={selected === current.generated.correctIndex}
              subject="Mathematics"
              chapter={chapter}
            />
            <Button className="w-full" onClick={next}>
              {idx + 1 >= items.length ? "Finish session" : "Next question"}
            </Button>
          </div>
        )}
      </Card>

      <p className="text-[11px] text-center text-muted-foreground flex items-center justify-center gap-1">
        <Sparkles className="w-3 h-3" /> Generated from template · seed {sessionSeed + idx * 7919}
      </p>
    </div>
  );
}
