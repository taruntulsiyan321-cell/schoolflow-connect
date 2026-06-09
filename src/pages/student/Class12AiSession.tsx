import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, Sparkles, XCircle } from "lucide-react";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { toast } from "sonner";
import { StudentSessionSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { MathText } from "@/components/MathText";

type AiQuestion = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
};

export default function Class12AiSession() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const subject = params.get("subject") ?? "Physics";
  const chapter = params.get("chapter") ?? "Electric Charges and Fields";
  const count = Math.min(20, Math.max(1, Number(params.get("count") ?? 10)));

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<AiQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [correctN, setCorrectN] = useState(0);
  const [done, setDone] = useState(false);
  const [summary, setSummary] = useState<any>(null);

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      setLoadError(null);

      const { data: sid, error: sErr } = await supabase.rpc("rpc_start_practice_session", {
        _subject: subject,
        _chapter: chapter,
        _count: count,
      });
      if (sErr) { setLoadError(sErr.message); setLoading(false); return; }
      setSessionId(sid as string);

      // Track which question ids the student has already seen (no-repeat within session)
      const seenIds = new Set<string>(
        JSON.parse(sessionStorage.getItem(`seen-${subject}-${chapter}`) ?? "[]"),
      );

      const fetchPool = async () => {
        const { data, error } = await supabase
          .from("question_templates")
          .select("id, template_data, explanation_template")
          .eq("class", 12)
          .eq("subject", subject)
          .eq("chapter", chapter)
          .eq("template_type", "ai_mcq")
          .eq("is_active", true)
          .limit(200);
        if (error) throw error;
        return (data ?? []).filter((r) => !seenIds.has(r.id));
      };

      try {
        let pool = await fetchPool();

        if (pool.length < count) {
          // Ask AI to expand the bank
          toast.message("Generating fresh questions with AI…");
          const { error: fnErr } = await supabase.functions.invoke("ai-expand-questions", {
            body: { class: 12, subject, chapter, count: Math.max(8, count), ensure_total: 30 },
          });
          if (fnErr) throw new Error(fnErr.message);
          pool = await fetchPool();
        }

        if (pool.length === 0) {
          setLoadError("No questions available yet. Please try again in a moment.");
          setLoading(false);
          return;
        }

        // Shuffle & take
        const shuffled = pool.sort(() => Math.random() - 0.5).slice(0, count);
        const built: AiQuestion[] = shuffled.map((r) => {
          const td: any = r.template_data ?? {};
          return {
            id: r.id,
            question: String(td.question ?? ""),
            options: Array.isArray(td.options) ? td.options.map(String) : [],
            correctIndex: Number(td.correct_index ?? 0),
            explanation: String(r.explanation_template ?? ""),
          };
        });
        // Persist seen ids
        const next = new Set(seenIds);
        built.forEach((b) => next.add(b.id));
        sessionStorage.setItem(`seen-${subject}-${chapter}`, JSON.stringify([...next]));

        setItems(built);
        setLoading(false);
      } catch (e: any) {
        setLoadError(e.message ?? "Failed to load questions");
        setLoading(false);
      }
    })();
  }, [user, subject, chapter, count]);

  const current = items[idx];

  const submitAnswer = async (optionIndex: number) => {
    if (!current || !sessionId || revealed) return;
    setSelected(optionIndex);
    setRevealed(true);
    const ok = optionIndex === current.correctIndex;
    if (ok) setCorrectN((n) => n + 1);

    await supabase.rpc("rpc_record_question_attempt", {
      _session_id: sessionId,
      _template_id: current.id,
      _generated_question: {
        question: current.question,
        options: current.options,
      },
      _correct_answer: { index: current.correctIndex, text: current.options[current.correctIndex] },
      _selected_answer: { index: optionIndex, text: current.options[optionIndex] },
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
      setSummary(sum ?? { correct_count: correctN, question_count: items.length, chapter, subject });
      setDone(true);
      return;
    }
    setIdx(idx + 1);
  };

  if (loading) return <StudentSessionSkeleton label="Generating fresh AI questions…" />;

  if (loadError) {
    return (
      <div className="max-w-md mx-auto space-y-4">
        <StudentErrorState title="Could not start practice" message={loadError} onRetry={() => window.location.reload()} />
        <div className="text-center">
          <Button asChild variant="outline"><Link to="/student/practice/math12">Back to picker</Link></Button>
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
          <p className="text-muted-foreground mt-2">{subject} · {chapter}</p>
          <div className="text-3xl font-bold mt-4">{summary.correct_count}/{summary.question_count}</div>
          <div className="flex gap-2 mt-6 justify-center flex-wrap">
            <Button asChild variant="outline"><Link to="/student/practice/math12">New chapter</Link></Button>
            <Button onClick={() => window.location.reload()}>Same chapter again</Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!current) return null;
  const pct = ((idx + (revealed ? 1 : 0)) / items.length) * 100;

  return (
    <div className="max-w-2xl mx-auto space-y-4 animate-rise">
      <button type="button" onClick={() => nav(-1)} className="text-sm text-muted-foreground flex items-center gap-1">
        <ArrowLeft className="w-4 h-4" /> Exit
      </button>

      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1">
          <span>{subject} · {chapter}</span>
          <span>Q {idx + 1} / {items.length} · {correctN} correct</span>
        </div>
        <Progress value={pct} className="h-1.5" />
      </div>

      <Card className="p-5 shadow-card">
        <MathText className="font-medium leading-relaxed block" text={current.question} />
        <div className="grid gap-2 mt-4">
          {current.options.map((opt, oi) => {
            const isCorrect = oi === current.correctIndex;
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
                <MathText text={opt} />
              </button>
            );
          })}
        </div>

        {revealed && (
          <div className="mt-4 space-y-3">
            <div className={cn("flex items-center gap-2 text-sm font-medium", selected === current.correctIndex ? "text-accent" : "text-destructive")}>
              {selected === current.correctIndex ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {selected === current.correctIndex ? "Correct!" : <>Answer: <MathText className="ml-1" text={current.options[current.correctIndex]} /></>}
            </div>
            {current.explanation && <MathText className="text-sm text-muted-foreground block" text={current.explanation} />}
            <ExplainPanel
              question={current.question}
              options={current.options}
              correctIndex={current.correctIndex}
              selectedIndex={selected}
              wasCorrect={selected === current.correctIndex}
              subject={subject}
              chapter={chapter}
            />
            <Button className="w-full" onClick={next}>
              {idx + 1 >= items.length ? "Finish session" : "Next question"}
            </Button>
          </div>
        )}
      </Card>

      <p className="text-[11px] text-center text-muted-foreground flex items-center justify-center gap-1">
        <Sparkles className="w-3 h-3" /> AI-generated · cached · no repeats this session
      </p>
    </div>
  );
}
