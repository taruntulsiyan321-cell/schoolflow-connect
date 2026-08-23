import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { ArrowLeft, CheckCircle2, Sparkles, XCircle, Loader2 } from "lucide-react";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { StudentErrorState, StudentSessionSkeleton } from "@/components/student/StudentPanelStates";
import { MathText } from "@/components/MathText";
import { generateAiPracticeQuestions } from "@/lib/aiPracticeQuestions";
import { assignRecoveryOnMistake } from "@/lib/assignRecoveryOnMistake";
import {
  completePracticeSession,
  recordPracticeAttemptBestEffort,
  type PracticeAttemptSnapshot,
} from "@/lib/practiceSessionPersistence";
import { loadMath12TemplatePractice } from "@/lib/templatePracticeLoader";
import { toErrorMessage } from "@/lib/presentation";

type AiQuestion = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  explanation: string;
  templateId?: string;
};

export default function Class12AiSession() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [params] = useSearchParams();
  const subjectParam = params.get("subject")?.trim() || "";
  const chapterParam = params.get("chapter")?.trim() || "";
  const subject = subjectParam;
  const chapter = chapterParam;
  const rawCountParam = params.get("count");
  const parsedCountParam = rawCountParam === null ? NaN : Number(rawCountParam);
  const count = Number.isFinite(parsedCountParam) && parsedCountParam > 0
    ? Math.min(20, Math.max(1, Math.floor(parsedCountParam)))
    : 10;
  const isMath = subject.toLowerCase().includes("math");
  const paramsMissing = !subjectParam || !chapterParam;

  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(
    paramsMissing ? "Choose a real subject and chapter before starting AI practice." : null,
  );
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [items, setItems] = useState<AiQuestion[]>([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [correctN, setCorrectN] = useState(0);
  const [fromTemplates, setFromTemplates] = useState(false);
  const startedAt = useRef(new Date().toISOString());
  const attemptLog = useRef<PracticeAttemptSnapshot[]>([]);

  useEffect(() => {
    if (!user) return;
    if (paramsMissing) {
      setLoading(false);
      setLoadError("Choose a real subject and chapter before starting AI practice.");
      return;
    }
    (async () => {
      setLoading(true);
      setAiLoading(false);
      setLoadError(null);
      setFromTemplates(false);

      const { PracticeService, resolveStudentServiceContext } = await import("@/academic");
      let sid: string;
      try {
        const pCtx = await resolveStudentServiceContext();
        sid = (await PracticeService.start(pCtx, {
          _subject: subject,
          _chapter: chapter,
          _count: count,
        })) as string;
      } catch (startErr) {
        const { data: sidRpc, error: sErr } = await supabase.rpc("rpc_start_practice_session", {
          _subject: subject,
          _chapter: chapter,
          _count: count,
        });
        if (sErr) {
          setLoadError(sErr.message || (toErrorMessage(startErr, "Could not start session")));
          setLoading(false);
          return;
        }
        sid = sidRpc as string;
      }
      setSessionId(sid);

      if (isMath) {
        const { items: built, error: tplErr } = await loadMath12TemplatePractice({ chapter, count });
        if (built.length > 0) {
          setFromTemplates(true);
          setItems(
            built.map(({ generated }, i) => ({
              id: `tpl-${i}`,
              question: generated.question,
              options: generated.options,
              correctIndex: generated.correctIndex,
              explanation: generated.explanation,
              templateId: built[i].template.id,
            })),
          );
          setLoading(false);
          return;
        }
        if (tplErr) console.warn("Template practice fallback:", tplErr);
      }

      setAiLoading(true);
      const { questions, error } = await generateAiPracticeQuestions({
        subject,
        chapter,
        topic: chapter,
        count,
        difficulty: "medium",
      });
      setAiLoading(false);

      if (error || questions.length === 0) {
        setLoadError(error ?? "Could not load questions. Try again in a moment.");
        setLoading(false);
        return;
      }

      setItems(
        questions.map((q, i) => ({
          id: `ai-${Date.now()}-${i}`,
          question: q.question,
          options: q.options.slice(0, 4),
          correctIndex: Math.max(0, Math.min(3, q.correct_index ?? 0)),
          explanation: q.explanation ?? "",
        })),
      );
      setLoading(false);
    })();
  }, [user, subject, chapter, count, isMath, paramsMissing]);

  const current = items[idx];

  const submitAnswer = async (optionIndex: number) => {
    if (!current || !sessionId || revealed) return;
    setSelected(optionIndex);
    setRevealed(true);
    const ok = optionIndex === current.correctIndex;
    if (ok) setCorrectN((n) => n + 1);

    attemptLog.current.push({
      question: current.question,
      options: current.options,
      correctIndex: current.correctIndex,
      selectedIndex: optionIndex,
      isCorrect: ok,
      explanation: current.explanation,
      subject,
      chapter,
      concept: chapter,
      source: "practice",
      practiceMode: "ai",
      sourceId: sessionId,
      solutionViewed: true,
      templateId: current.templateId ?? null,
    });

    if (!ok) {
      void assignRecoveryOnMistake({
        subject,
        chapter,
        concept: chapter,
        sourceType: "practice_session",
        sourceId: sessionId,
      });
    }

    const saved = await recordPracticeAttemptBestEffort({
      sessionId,
      templateId: current.templateId ?? null,
      subject,
      chapter,
      concept: chapter,
      topic: chapter,
      generatedQuestion: {
        question: current.question,
        options: current.options,
        explanation: current.explanation,
      },
      correctIndex: current.correctIndex,
      selectedIndex: optionIndex,
      isCorrect: ok,
      score: ok ? 1 : 0,
      solutionViewed: true,
      practiceMode: "ai",
      source: "practice",
      sourceId: sessionId,
    });
    if (!saved.ok) {
      console.warn("record attempt:", saved.error?.message);
    }
  };

  const next = async () => {
    setRevealed(false);
    setSelected(null);
    if (idx + 1 >= items.length) {
      if (!sessionId) return;
      completePracticeSession(nav, sessionId, {
        subject,
        chapter,
        attempts: [...attemptLog.current],
        startedAt: startedAt.current,
      });
      return;
    }
    setIdx(idx + 1);
  };

  if (loading && !aiLoading) {
    return <StudentSessionSkeleton label="Loading session…" />;
  }

  if (aiLoading) {
    return (
      <div className="max-w-md mx-auto py-16 text-center space-y-4">
        <div className="w-16 h-16 mx-auto rounded-2xl bg-primary/10 flex items-center justify-center">
          <Sparkles className="w-8 h-8 text-primary animate-pulse" />
        </div>
        <h2 className="text-xl font-semibold">Preparing your practice questions</h2>
        <p className="text-muted-foreground text-sm">
          Fresh {subject} questions for {chapter}…
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
        <StudentErrorState title="Could not start practice" message={loadError} onRetry={() => window.location.reload()} />
        <div className="text-center">
          <Button asChild variant="outline"><Link to="/student/practice/math12">Back to picker</Link></Button>
        </div>
      </div>
    );
  }

  if (!current) return null;
  const pct = ((idx + (revealed ? 1 : 0)) / items.length) * 100;

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2">
        <Link to="/student/practice/math12"><ArrowLeft className="w-4 h-4" /> Practice</Link>
      </Button>

      <div className="flex items-center gap-2 text-xs font-medium text-primary bg-primary/5 border border-primary/15 rounded-lg px-3 py-2 mb-3">
        <Sparkles className="w-3.5 h-3.5 shrink-0" />
        {fromTemplates ? "Template practice" : "Fresh questions · varied concepts"} · {subject}
      </div>

      <Progress value={pct} className="h-1.5 mb-4" />
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs text-muted-foreground">Question {idx + 1} of {items.length}</p>
        <p className="text-xs text-muted-foreground">{correctN} correct</p>
      </div>

      <Card className="p-5 shadow-card">
        <MathText block className="font-medium leading-relaxed" text={current.question} />
        <div className="grid gap-2 mt-4">
          {current.options.map((opt, oi) => (
            <button
              key={oi}
              type="button"
              disabled={revealed}
              onClick={() => submitAnswer(oi)}
              className={cn(
                "text-left px-4 py-3 rounded-lg border text-sm transition-colors",
                !revealed && "hover:border-primary/40 hover:bg-primary/5",
                revealed && oi === current.correctIndex && "border-accent bg-accent/10",
                revealed && oi === selected && oi !== current.correctIndex && "border-destructive bg-destructive/10",
              )}
            >
              <span className="font-semibold mr-2">{String.fromCharCode(65 + oi)}.</span>
              <MathText text={opt} />
            </button>
          ))}
        </div>

        {revealed && (
          <div className="mt-4 space-y-3">
            <div className={cn("flex items-center gap-2 text-sm font-medium", selected === current.correctIndex ? "text-accent" : "text-destructive")}>
              {selected === current.correctIndex ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {selected === current.correctIndex ? "Correct!" : "Review the explanation below."}
            </div>
            {current.explanation && <MathText block className="text-sm text-muted-foreground" text={current.explanation} />}
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
    </>
  );
}
