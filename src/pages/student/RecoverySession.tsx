import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui-bits";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, XCircle, Sparkles, Loader2, Brain } from "lucide-react";
import { toast } from "sonner";
import { StudentSessionSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { MathText } from "@/components/MathText";
import { generateFromTemplate } from "@/engines/class12Math/generate";
import type { GeneratedQuestion } from "@/engines/class12Math/types";
import { freshSessionSeed, SEED_STRIDE } from "@/lib/practiceDiversity";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { fetchRecentMistakeContext, generateAiPracticeQuestions } from "@/lib/aiPracticeQuestions";

type RecoveryQuestion = {
  id: string;
  order_index: number;
  question_text: string;
  options: string[];
  answered: boolean;
  is_correct?: boolean;
  explanation?: string;
  client_generate?: boolean;
  template_type?: string;
  template_data?: Record<string, unknown>;
  explanation_template?: string;
  chapter?: string;
  generated?: GeneratedQuestion;
  correct_index?: number;
  ai_generated?: boolean;
};

export default function RecoverySession() {
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [assignment, setAssignment] = useState<any>(null);
  const [questions, setQuestions] = useState<RecoveryQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [score, setScore] = useState({ correct: 0, total: 0 });

  const sessionSeed = useMemo(
    () => freshSessionSeed(assignment?.chapter ?? assignment?.concept ?? "recovery"),
    [assignment?.chapter, assignment?.concept],
  );

  // ── Generate AI recovery questions when DB has none ────────────────
  const generateAiQuestions = async (assign: any): Promise<RecoveryQuestion[]> => {
    setAiLoading(true);
    try {
      const concept = assign.concept ?? assign.chapter ?? "";
      const { text: mistakeContext, concepts } = await fetchRecentMistakeContext({
        subject: assign.subject ?? "Mathematics",
        chapter: assign.chapter,
        concept,
      });

      const count =
        assign.severity === "severe" ? 8 : assign.severity === "moderate" ? 6 : 5;

      const { questions, error } = await generateAiPracticeQuestions({
        subject: assign.subject ?? "Mathematics",
        chapter: assign.chapter ?? "",
        topic: concept,
        difficulty: assign.severity === "severe" ? "easy" : "medium",
        count,
        mistakeContext,
        weakConcepts: concepts.length ? concepts : concept ? [concept] : [],
      });

      if (questions.length > 0) {
        return questions.map((q, i) => ({
          id: `ai-${Date.now()}-${i}`,
          order_index: i,
          question_text: q.question,
          options: q.options,
          correct_index: q.correct_index,
          explanation: q.explanation,
          answered: false,
          ai_generated: true,
        }));
      }

      if (error) console.warn("AI question generation failed:", error);
      return [];
    } catch (e) {
      console.warn("AI question generation error:", e);
      return [];
    } finally {
      setAiLoading(false);
    }
  };

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
      const assign = data?.assignment;
      setAssignment(assign);

      const raw = (data?.questions ?? []) as RecoveryQuestion[];
      const enriched: RecoveryQuestion[] = [];
      for (const q of raw) {
        if ((q.client_generate || !q.question_text?.trim()) && (q as any).template_id && !q.template_type) {
          const { data: tpl } = await supabase
            .from("question_templates")
            .select("template_type, template_data, explanation_template, chapter")
            .eq("id", (q as any).template_id)
            .maybeSingle();
          if (tpl) {
            enriched.push({
              ...q,
              template_type: tpl.template_type,
              template_data: tpl.template_data as Record<string, unknown>,
              explanation_template: tpl.explanation_template ?? q.explanation,
              chapter: tpl.chapter,
            });
            continue;
          }
        }
        enriched.push(q);
      }

      const seenQuestions = new Set<string>();
      const qs = enriched.map((q, i) => {
        const needsGen =
          q.client_generate ||
          (!q.question_text?.trim() && q.template_type) ||
          (Array.isArray(q.options) && q.options.length === 0 && q.template_type) ||
          (q.options?.length === 4 && q.options[0] === "Option A");

        if (needsGen && q.template_type) {
          try {
            let attempt = 0;
            let generated = generateFromTemplate(
              {
                template_type: q.template_type,
                template_data: q.template_data ?? {},
                explanation_template: q.explanation ?? "",
              },
              sessionSeed + i * SEED_STRIDE,
            );
            while (seenQuestions.has(generated.question) && attempt < 8) {
              attempt++;
              generated = generateFromTemplate(
                {
                  template_type: q.template_type,
                  template_data: q.template_data ?? {},
                  explanation_template: q.explanation ?? "",
                },
                sessionSeed + i * SEED_STRIDE + attempt * 131 + attempt * attempt * 17,
              );
            }
            seenQuestions.add(generated.question);
            return {
              ...q,
              options: generated.options,
              question_text: generated.question,
              explanation: generated.explanation,
              generated,
            };
          } catch {
            return q;
          }
        }
        return {
          ...q,
          options: Array.isArray(q.options) ? q.options : [],
        };
      }).filter((q) => q.question_text?.trim() && q.options?.length >= 2);

      // ── If no DB questions, generate AI questions on-the-fly ──────
      if (qs.length === 0 && assign) {
        const aiQuestions = await generateAiQuestions(assign);
        if (aiQuestions.length > 0) {
          setQuestions(aiQuestions);
          setIdx(0);
          setLoading(false);
          return;
        }
        // AI also failed — show error with helpful actions
        setLoadError("No practice questions could be loaded right now — please try again later.");
        setLoading(false);
        return;
      }

      if (qs.length === 0) {
        setLoadError("No practice questions could be loaded for this recovery topic.");
        setLoading(false);
        return;
      }

      setQuestions(qs);
      const firstUnanswered = qs.findIndex((q) => !q.answered);
      setIdx(firstUnanswered >= 0 ? firstUnanswered : 0);
      setLoading(false);
    })();
  }, [id, sessionSeed]);

  const current = questions[idx];

  const correctIdx = current?.ai_generated
    ? (current.correct_index ?? 0)
    : (current?.generated?.correctIndex ?? (current as any)?.correct_answer?.correct_index ?? 0);

  const submit = async (optionIndex: number) => {
    if (!current || revealed) return;
    setSelected(optionIndex);
    setRevealed(true);

    const ok = optionIndex === correctIdx;
    setScore((prev) => ({ correct: prev.correct + (ok ? 1 : 0), total: prev.total + 1 }));

    // For AI-generated questions, we still try to record via RPC if possible
    if (current.ai_generated) {
      // Try recording the answer — the RPC may fail if the question_id is a client-generated ID
      try {
        await (supabase as any).rpc("rpc_submit_recovery_answer", {
          _question_id: current.id,
          _student_answer: { selected_index: optionIndex, text: current.options[optionIndex] },
          _is_correct: ok,
        });
      } catch {
        // Non-fatal for AI questions — answer tracking is best-effort
      }
    } else {
      const { data, error } = await (supabase as any).rpc("rpc_submit_recovery_answer", {
        _question_id: current.id,
        _student_answer: { selected_index: optionIndex, text: current.options[optionIndex] },
        _is_correct: ok,
      });
      if (error) toast.error(error.message);
      else if (data?.completed) setDone(true);
    }
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

  // ── Loading states ─────────────────────────────────────────────────

  if (loading && !aiLoading) {
    return <StudentSessionSkeleton label="Loading recovery session…" />;
  }

  if (aiLoading) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
          <Sparkles className="w-8 h-8 text-primary animate-pulse" />
        </div>
        <h2 className="text-xl font-semibold">Preparing your practice questions</h2>
        <p className="text-muted-foreground text-sm">
          Creating personalized questions based on your weak concepts…
        </p>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          One moment…
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-md mx-auto space-y-4">
        <StudentErrorState title="Could not load recovery session" message={loadError} onRetry={() => window.location.reload()} />
        <div className="flex gap-2 justify-center flex-wrap">
          <Button asChild variant="outline"><Link to="/student/recovery">Back to Recovery Zone</Link></Button>
          {assignment?.chapter && (
            <Button asChild>
              <Link to={`/student/practice/math12/session?chapter=${encodeURIComponent(assignment.chapter)}&count=10`}>
                Practice {assignment.chapter}
              </Link>
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!assignment || questions.length === 0) {
    return (
      <Card className="p-8 text-center space-y-4">
        <p className="text-muted-foreground">No recovery questions found for this topic.</p>
        <div className="flex gap-2 justify-center flex-wrap">
          <Button asChild variant="outline"><Link to="/student/recovery">Back to Recovery Zone</Link></Button>
          <Button asChild><Link to="/student/practice/math12">Class 12 Math practice</Link></Button>
        </div>
      </Card>
    );
  }

  // ── Completion screen ──────────────────────────────────────────────

  if (done) {
    const isAiSession = questions.some((q) => q.ai_generated);
    const accuracy = score.total > 0 ? Math.round((score.correct / score.total) * 100) : 0;
    return (
      <Card className="p-8 max-w-md mx-auto text-center shadow-card">
        <CheckCircle2 className="w-12 h-12 mx-auto text-accent mb-3" />
        <h2 className="text-xl font-semibold">Recovery complete</h2>
        <p className="text-muted-foreground mt-2">{assignment.concept} — {assignment.subject}</p>

        {isAiSession && (
          <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">Practice results</span>
            </div>
            <div className="text-2xl font-bold">{score.correct}/{score.total}</div>
            <div className="text-sm text-muted-foreground">{accuracy}% accuracy</div>
            {accuracy < 60 && (
              <p className="text-xs text-warning mt-2">
                Consider reviewing the chapter notes and trying again.
              </p>
            )}
            {accuracy >= 80 && (
              <p className="text-xs text-accent mt-2">
                Excellent! You're mastering this concept.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2 mt-6 justify-center flex-wrap">
          <Button asChild variant="outline"><Link to="/student/recovery">Recovery Zone</Link></Button>
          <Button asChild><Link to="/student/mistakes">Mistake book</Link></Button>
        </div>
      </Card>
    );
  }

  // ── Quiz UI ────────────────────────────────────────────────────────

  const isAiSession = questions.some((q) => q.ai_generated);
  const pct = ((idx + (revealed ? 1 : 0)) / questions.length) * 100;

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2">
        <Link to="/student/recovery"><ArrowLeft className="w-4 h-4" /> Recovery Zone</Link>
      </Button>

      <PageHeader
        title={`Recovery: ${assignment.concept}`}
        subtitle={`${assignment.subject}${assignment.chapter ? ` · ${assignment.chapter}` : ""} · ${assignment.severity} priority`}
      />

      {isAiSession && (
        <div className="flex items-center gap-2 text-xs font-medium text-primary bg-primary/5 border border-primary/15 rounded-lg px-3 py-2 mb-3">
          <Sparkles className="w-3.5 h-3.5 shrink-0" />
          Personalized practice targeting your weak concepts
        </div>
      )}

      <Progress value={pct} className="h-1.5 mb-4" />
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground">Question {idx + 1} of {questions.length}</p>
        {isAiSession && (
          <p className="text-xs text-muted-foreground">{score.correct}/{score.total} correct</p>
        )}
      </div>

      <Card className="p-5 shadow-card">
        <MathText block className="font-medium leading-relaxed" text={current.question_text} />
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
              <MathText text={opt} />
            </button>
          ))}
        </div>

        {revealed && (
          <div className="mt-4 space-y-3">
            <div className={cn("flex items-center gap-2 text-sm font-medium", selected === correctIdx ? "text-accent" : "text-destructive")}>
              {selected === correctIdx ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {selected === correctIdx ? "Correct — concept reinforced!" : "Review the explanation and try similar questions."}
            </div>
            {current.explanation && <MathText block className="text-sm text-muted-foreground" text={current.explanation} />}
            {selected !== correctIdx && (
              <ExplainPanel
                question={current.question_text}
                options={current.options}
                correctIndex={correctIdx}
                selectedIndex={selected}
                wasCorrect={false}
                subject={assignment.subject}
                chapter={assignment.chapter ?? current.chapter}
                autoLoad
              />
            )}
            <Button className="w-full" onClick={next}>
              {idx + 1 >= questions.length ? "Finish recovery" : "Next question"}
            </Button>
          </div>
        )}
      </Card>
    </>
  );
}
