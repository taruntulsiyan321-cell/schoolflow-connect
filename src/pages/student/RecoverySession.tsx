import { useEffect, useRef, useState } from "react";

import { Link, useNavigate, useParams } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";

import { Card } from "@/components/ui/card";

import { Button } from "@/components/ui/button";

import { Progress } from "@/components/ui/progress";

import { Badge } from "@/components/ui/badge";

import { PageHeader } from "@/components/ui-bits";

import { cn } from "@/lib/utils";

import { ArrowLeft, CheckCircle2, XCircle, Sparkles, Loader2 } from "lucide-react";

import { toast } from "sonner";

import { StudentSessionSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";

import { MathText } from "@/components/MathText";

import { generateFromTemplate } from "@/engines/class12Math/generate";

import type { GeneratedQuestion } from "@/engines/class12Math/types";

import { freshSessionSeed, SEED_STRIDE } from "@/lib/practiceDiversity";

import { ExplainPanel } from "@/components/learn/ExplainPanel";

import { mcqOptionsInvalid } from "@/lib/mcqOptions";

import {

  fetchMistakesForRecovery,

  generateRecoveryQuestionsFromMistakes,

} from "@/lib/mistakeRecovery";

import {

  persistRecoveryResult,

  writeRecoveryResultState,

  type RecoveryAttemptSnapshot,

} from "@/lib/recoverySessionSnapshot";

import { loadMath12TemplatePractice } from "@/lib/templatePracticeLoader";

const RECOVERY_Q_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecoveryQuestionUuid(id: string | undefined | null): boolean {
  return !!id && RECOVERY_Q_UUID_RE.test(id);
}


import { displayChapter, displayConcept, displaySubject, isPlaceholderAcademicLabel } from "@/lib/academicDisplay";



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



function processAssignmentQuestions(

  raw: RecoveryQuestion[],

  sessionSeed: number,

): RecoveryQuestion[] {

  const seenQuestions = new Set<string>();

  return raw

    .map((q, i) => {

      const needsGen =

        q.client_generate ||

        (!q.question_text?.trim() && q.template_type) ||

        (Array.isArray(q.options) && q.options.length === 0 && q.template_type) ||

        (q.options?.length === 4 && q.options[0] === "Option A") ||

        mcqOptionsInvalid(q.options);



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

    })

    .filter((q) => q.question_text?.trim() && q.options?.length >= 2);

}



async function loadRecoveryFromTemplates(

  assign: { chapter?: string; concept?: string; question_count?: number },

  sessionSeed: number,

): Promise<RecoveryQuestion[]> {

  const chapter = assign.chapter ?? assign.concept;

  if (!chapter) return [];



  const count = Math.min(10, Math.max(1, assign.question_count ?? 8));

  const { items } = await loadMath12TemplatePractice({ chapter, count, sessionSeed });

  return items.map(({ generated }, i) => ({

    id: `recovery-tpl-${i}`,

    order_index: i,

    question_text: generated.question,

    options: generated.options,

    explanation: generated.explanation,

    answered: false,

    generated,

  }));

}



export default function RecoverySession() {

  const { id } = useParams<{ id: string }>();

  const nav = useNavigate();

  const [loading, setLoading] = useState(true);

  const [aiLoading, setAiLoading] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);

  const [assignment, setAssignment] = useState<any>(null);

  const [questions, setQuestions] = useState<RecoveryQuestion[]>([]);

  const [idx, setIdx] = useState(0);

  const [selected, setSelected] = useState<number | null>(null);

  const [revealed, setRevealed] = useState(false);

  const [score, setScore] = useState({ correct: 0, total: 0 });

  const [attemptSnapshots, setAttemptSnapshots] = useState<RecoveryAttemptSnapshot[]>([]);

  const attemptSnapshotsRef = useRef<RecoveryAttemptSnapshot[]>([]);

  const startedAtRef = useRef(new Date().toISOString());

  const recoveryPracticeSessionRef = useRef<string | null>(null);



  useEffect(() => {

    if (!id) return;

    (async () => {

      setLoading(true);

      setAiLoading(false);

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

      const sessionSeed = freshSessionSeed(assign?.chapter ?? assign?.concept ?? "recovery");



      const raw = (data?.questions ?? []) as RecoveryQuestion[];

      const fromAssignment = processAssignmentQuestions(raw, sessionSeed);

      if (fromAssignment.length > 0) {

        setQuestions(fromAssignment);

        const firstUnanswered = fromAssignment.findIndex((q) => !q.answered);

        setIdx(firstUnanswered >= 0 ? firstUnanswered : 0);

        setLoading(false);

        return;

      }



      const assignSubject = assign?.subject && !isPlaceholderAcademicLabel(assign.subject) ? assign.subject : null;
      const isMath = (assignSubject ?? "").toLowerCase().includes("math");

      if (isMath && assign) {

        const fromTemplates = await loadRecoveryFromTemplates(assign, sessionSeed);

        if (fromTemplates.length > 0) {

          setQuestions(fromTemplates);

          setIdx(0);

          setLoading(false);

          return;

        }

      }



      setAiLoading(true);

      if (!assignSubject) {
        setLoadError("Recovery assignment is missing a real subject.");
        setLoading(false);
        return;
      }

      const mistakes = await fetchMistakesForRecovery({
        subject: assignSubject,
        chapter: assign?.chapter && !isPlaceholderAcademicLabel(assign.chapter) ? assign.chapter : undefined,
        concept: assign?.concept && !isPlaceholderAcademicLabel(assign.concept) ? assign.concept : undefined,
      });



      if (mistakes.length > 0 && assign) {

        const { questions: recoveryQs, error: genError } =

          await generateRecoveryQuestionsFromMistakes(assign, mistakes);

        setAiLoading(false);



        if (recoveryQs.length > 0) {

          setQuestions(recoveryQs);

          setIdx(0);

          setLoading(false);

          return;

        }



        if (genError) console.warn("Recovery question generation failed:", genError);

      } else {

        setAiLoading(false);

      }



      setLoadError(

        "Practice first to build your mistake book — wrong answers from Practice are saved here for targeted recovery.",

      );

      setLoading(false);

    })();

  }, [id]);



  const current = questions[idx];



  const correctIdx = current?.ai_generated

    ? (current.correct_index ?? 0)

    : (current?.generated?.correctIndex ?? (current as any)?.correct_answer?.correct_index ?? 0);



  const finishSession = async (snapshots: RecoveryAttemptSnapshot[]) => {
    if (!id || !assignment) return;
    const correct = snapshots.filter((s) => s.isCorrect).length;
    const subject =
      assignment.subject && !isPlaceholderAcademicLabel(assignment.subject)
        ? assignment.subject
        : null;
    const concept =
      (assignment.concept && !isPlaceholderAcademicLabel(assignment.concept) && assignment.concept) ||
      (assignment.chapter && !isPlaceholderAcademicLabel(assignment.chapter) && assignment.chapter) ||
      null;
    if (!subject || !concept) {
      toast.error("Recovery assignment is missing a real subject or concept — cannot complete.");
      return;
    }
    try {
      const { PracticeService, resolveStudentServiceContext } = await import("@/academic");
      const ctx = await resolveStudentServiceContext();
      await PracticeService.completeRecoveryAssignment(ctx, {
        assignmentId: id,
        questionsCompleted: snapshots.length,
        questionsCorrect: correct,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not complete recovery — try again");
      return;
    }
    persistRecoveryResult(nav, {
      assignmentId: id,
      subject,
      chapter:
        assignment.chapter && !isPlaceholderAcademicLabel(assignment.chapter)
          ? assignment.chapter
          : undefined,
      concept,
      severity: assignment.severity,
      attempts: snapshots,
      startedAt: startedAtRef.current,
    });
  };

  const submit = async (optionIndex: number) => {

    if (!current || revealed) return;

    setSelected(optionIndex);

    setRevealed(true);



    const ok = optionIndex === correctIdx;

    const nextScore = { correct: score.correct + (ok ? 1 : 0), total: score.total + 1 };

    setScore(nextScore);



    const snapshot: RecoveryAttemptSnapshot = {

      questionId: current.id,

      question: current.question_text,

      options: current.options,

      correctIndex: correctIdx,

      selectedIndex: optionIndex,

      isCorrect: ok,

      explanation: current.explanation,

    };

    const snapshots = [...attemptSnapshotsRef.current, snapshot];

    attemptSnapshotsRef.current = snapshots;

    setAttemptSnapshots(snapshots);

    if (id && assignment) {
      const subject =
        assignment.subject && !isPlaceholderAcademicLabel(assignment.subject)
          ? assignment.subject
          : null;
      const concept =
        (assignment.concept && !isPlaceholderAcademicLabel(assignment.concept) && assignment.concept) ||
        (assignment.chapter && !isPlaceholderAcademicLabel(assignment.chapter) && assignment.chapter) ||
        null;
      if (subject && concept) {
        writeRecoveryResultState({
          assignmentId: id,
          subject,
          chapter:
            assignment.chapter && !isPlaceholderAcademicLabel(assignment.chapter)
              ? assignment.chapter
              : undefined,
          concept,
          severity: assignment.severity,
          attempts: snapshots,
          startedAt: startedAtRef.current,
        });
      }
    }

    try {
      const { PracticeService, resolveStudentServiceContext } = await import("@/academic");
      const ctx = await resolveStudentServiceContext();
      if (isRecoveryQuestionUuid(current.id)) {
        await PracticeService.submitRecoveryAnswer(ctx, {
          questionId: current.id,
          studentAnswer: { selected_index: optionIndex, text: current.options[optionIndex] },
          isCorrect: ok,
        });
      } else {
        // Template / AI synthetic ids are not recovery_assignment_questions UUIDs —
        // persist via a recovery practice session so attempts stay in SSOT.
        if (!recoveryPracticeSessionRef.current) {
          const subject =
            assignment?.subject && !isPlaceholderAcademicLabel(assignment.subject)
              ? assignment.subject
              : "";
          const chapter =
            (assignment?.chapter && !isPlaceholderAcademicLabel(assignment.chapter) && assignment.chapter) ||
            (assignment?.concept && !isPlaceholderAcademicLabel(assignment.concept) && assignment.concept) ||
            null;
          if (!subject || !chapter) {
            toast.error("Cannot save answer — assignment missing subject/chapter");
          } else {
            recoveryPracticeSessionRef.current = (await PracticeService.start(ctx, {
              _subject: subject,
              _chapter: String(chapter),
              _count: Math.max(questions.length, snapshots.length),
              _practice_mode: "recovery",
            })) as string;
          }
        }
        const sid = recoveryPracticeSessionRef.current;
        if (sid) {
          await PracticeService.recordAttempt(ctx, {
            sessionId: sid,
            bankQuestionId: null,
            generatedQuestion: {
              question: current.question_text,
              options: current.options,
              explanation: current.explanation ?? "",
              recovery_synthetic_id: current.id,
              subject: assignment?.subject,
              chapter: assignment?.chapter,
              concept: assignment?.concept,
            },
            selectedAnswer: { selected_index: optionIndex, text: current.options[optionIndex] },
            correctAnswer: { correct_index: correctIdx },
            isCorrect: ok,
            score: ok ? 1 : 0,
            subject: assignment?.subject,
            chapter: assignment?.chapter ?? undefined,
            concept: assignment?.concept ?? undefined,
            practiceMode: "recovery",
            source: "recovery",
            sourceId: id,
          });
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save recovery answer");
    }

  };


  const next = async () => {

    setRevealed(false);

    setSelected(null);

    if (idx + 1 >= questions.length) {

      await finishSession(attemptSnapshotsRef.current);

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

                Practice {displayChapter(assignment.chapter)}

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



  const isAiSession = questions.some((q) => q.ai_generated);

  const pct = ((idx + (revealed ? 1 : 0)) / questions.length) * 100;



  return (

    <>

      <Button variant="ghost" size="sm" asChild className="mb-2">

        <Link to="/student/recovery"><ArrowLeft className="w-4 h-4" /> Recovery Zone</Link>

      </Button>



      <PageHeader

        title={`Recovery: ${displayConcept(assignment.concept)}`}

        subtitle={`${displaySubject(assignment.subject)}${assignment.chapter ? ` · ${displayChapter(assignment.chapter)}` : ""} · ${assignment.severity} priority`}

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

