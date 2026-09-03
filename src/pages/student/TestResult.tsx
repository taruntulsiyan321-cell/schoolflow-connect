import { ACCURACY_BUILDING, ACCURACY_PROCEDURAL } from "@/academic/metrics/bands";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, TestService, resolveStudentServiceContext } from "@/academic";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Target, Timer } from "lucide-react";
import { ScoreRing } from "@/components/student/ScoreRing";
import { QuestionRenderer, TestQuestionShape } from "@/components/student/QuestionRenderer";
import { PageHeader } from "@/components/ui-bits";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { ConceptRecoveryReport } from "@/components/student/ConceptRecoveryReport";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { displayChapter, displaySubject, displayTopic } from "@/lib/academicPresentation";
import { toDisplayText, toErrorMessage } from "@/lib/presentation";


/**
 * A test carries no subject column: it anchors on section_subject (§10.22), so
 * its subject is the one that section teaches. testService.get() resolves the
 * join and the row arrives shaped as section_subjects.curriculum_subjects.name.
 */
function testSubject(row: Record<string, unknown> | null): string {
  const ss = row?.section_subjects as { curriculum_subjects?: { name?: string } } | undefined;
  return ss?.curriculum_subjects?.name ?? "";
}

export default function TestResult() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { ctx, ready: academicReady } = useAcademicContext();
  const [test, setTest] = useState<Record<string, unknown> | null>(null);
  const [attempt, setAttempt] = useState<Record<string, unknown> | null>(null);
  const [questions, setQuestions] = useState<TestQuestionShape[]>([]);
  const [answers, setAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const resolveCtx = async () => {
    if (ctx && academicReady) return ctx;
    return resolveStudentServiceContext();
  };

  const load = async () => {
    if (!id || !user) return;
    setLoading(true);
    setLoadError(null);
    try {
      const serviceCtx = await resolveCtx();
      const d = (await TestService.get(serviceCtx, id)) as Record<string, unknown>;
      setTest(d);
      const qs = await TestService.listQuestions(serviceCtx, id);
      setQuestions((qs ?? []) as TestQuestionShape[]);
      const a = await TestService.getMyAttempt(serviceCtx, id);
      setAttempt(a);
      if (a?.id) {
        const ans = await TestService.listAnswers(serviceCtx, String(a.id));
        const m: Record<string, Record<string, unknown>> = {};
        (ans ?? []).forEach((x) => {
          m[String((x as { question_id: string }).question_id)] = x as Record<string, unknown>;
        });
        setAnswers(m);
      } else {
        setAnswers({});
      }
    } catch (e) {
      setLoadError(toErrorMessage(e, "Could not load results"));
      setTest(null);
      setAttempt(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, ctx, academicReady]);

  if (loading) return <StudentListSkeleton rows={4} />;

  if (loadError) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to="/student/tests">
            <ArrowLeft className="w-4 h-4" /> Tests
          </Link>
        </Button>
        <StudentErrorState title="Could not load results" message={loadError} onRetry={load} />
      </>
    );
  }

  if (!test) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to="/student/tests">
            <ArrowLeft className="w-4 h-4" /> Tests
          </Link>
        </Button>
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">This test could not be found.</p>
        </Card>
      </>
    );
  }

  if (!attempt || !attempt.submitted_at) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to="/student/tests">
            <ArrowLeft className="w-4 h-4" /> Tests
          </Link>
        </Button>
        <Card className="p-8 text-center">
          <Target className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">You haven&apos;t submitted this test yet.</p>
          <Button asChild className="mt-4">
            <Link to={`/student/test/${id}/attempt`}>Start attempt</Link>
          </Button>
        </Card>
      </>
    );
  }

  const totalCount = Number(attempt.total_count ?? 0);
  const correctCount = Number(attempt.correct_count ?? 0);
  const accuracy = totalCount ? Math.round((correctCount / totalCount) * 100) : 0;
  const mins = Math.round(Number(attempt.time_spent_sec ?? 0) / 60);
  const subjectLabel = displaySubject(testSubject(test)) || "—";
  const chapterRaw = test.chapter ? String(test.chapter) : "";
  const topicRaw = test.topic ? String(test.topic) : "";
  const subtitleParts = [
    subjectLabel,
    chapterRaw ? displayChapter(chapterRaw) : null,
    topicRaw ? displayTopic(topicRaw) : null,
    `Submitted ${
      attempt.submitted_at
        ? new Date(String(attempt.submitted_at)).toLocaleString()
        : "—"
    }`,
  ].filter(Boolean);

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2">
        <Link to="/student/tests">
          <ArrowLeft className="w-4 h-4" /> Tests
        </Link>
      </Button>
      <PageHeader title={toDisplayText(test.title, { kind: "label", fallback: "Test" })} subtitle={subtitleParts.join(" · ")} />

      {attempt.id && (
        <ConceptRecoveryReport
          sourceType="test_attempt"
          sourceId={String(attempt.id)}
          title="Test concept recovery report"
        />
      )}

      <Card className="p-6 mb-6 flex flex-col sm:flex-row items-center gap-6">
        <ScoreRing value={Number(attempt.score)} max={Number(attempt.max_score)} size={140} />
        <div className="grid grid-cols-2 gap-4 flex-1 w-full">
          <div className="flex items-center gap-3">
            <Target className="w-5 h-5 text-accent" />
            <div>
              <div className="text-xs text-muted-foreground">Accuracy</div>
              <div className="font-bold text-lg">{accuracy}%</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Timer className="w-5 h-5 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground">Time</div>
              <div className="font-bold text-lg">{mins}m</div>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Correct</div>
            <div className="font-bold text-lg">
              {correctCount}/{totalCount}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Score</div>
            <div className="font-bold text-lg">
              {Number(attempt.score).toFixed(1)} / {Number(attempt.max_score).toFixed(0)}
            </div>
          </div>
        </div>
      </Card>

      {/* Not a celebration gate — see PracticeSessionResult for the full note. */}
      {correctCount < totalCount && (
        <Card className="p-4 mb-6 border-primary/20 bg-primary/5">
          <h3 className="font-semibold text-sm mb-2">Improvement focus</h3>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
            {accuracy < ACCURACY_BUILDING && (
              <li>Review wrong answers below — they were added to your Mistake Book automatically.</li>
            )}
            {accuracy < ACCURACY_PROCEDURAL && (
              <li>Revise weak topics from your Dashboard before the next test.</li>
            )}
            <li>
              Use &quot;Explain my mistake&quot; on each wrong question to understand the concept, not
              just the answer.
            </li>
          </ul>
        </Card>
      )}

      <h3 className="font-semibold mb-3">Question review</h3>
      <div className="space-y-4">
        {questions.map((q, i) => {
          const a = answers[q.id];
          const resp = ((a?.response as Record<string, unknown>) ?? {}) as {
            indexes?: number[];
            text?: string;
            value?: number;
          };
          const opts: string[] = Array.isArray(q.options) ? q.options : [];
          const correctIdx = Array.isArray(q.correct?.indexes)
            ? q.correct.indexes[0] ?? null
            : typeof (q.correct as { correct_index?: number })?.correct_index === "number"
              ? (q.correct as { correct_index: number }).correct_index
              : null;
          const selectedIdx = Array.isArray(resp.indexes) ? resp.indexes[0] ?? null : null;
          // `q.correct` is untyped jsonb, so both branches go through the
          // presentation boundary rather than String(), which would render an
          // unexpected object shape as "[object Object]".
          const correctText =
            toDisplayText(q.correct?.text, { fallback: "", allowEmpty: true }) ||
            toDisplayText(q.correct?.value, { fallback: "", allowEmpty: true });
          const selectedText =
            resp.text ?? (resp.value !== undefined ? String(resp.value) : "");
          const qTopic = displayTopic(String((q as { topic?: string }).topic ?? "")) || "";
          return (
            <Card key={q.id} className="p-5">
              <div className="text-xs text-muted-foreground mb-2">Q{i + 1}</div>
              <QuestionRenderer
                question={q}
                mode="review"
                value={resp}
                isCorrect={(a?.is_correct as boolean | null | undefined) ?? null}
              />
              <ExplainPanel
                question={q.question}
                options={opts}
                correctIndex={correctIdx}
                selectedIndex={selectedIdx}
                correctText={correctText}
                selectedText={selectedText}
                subject={testSubject(test)}
                topic={qTopic}
                wasCorrect={(a?.is_correct as boolean | null | undefined) ?? null}
              />
            </Card>
          );
        })}
      </div>
    </>
  );
}
