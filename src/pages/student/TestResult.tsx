import { ACCURACY_BUILDING, ACCURACY_PROCEDURAL } from "@/academic/metrics/bands";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, TestService, resolveStudentServiceContext } from "@/academic";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Download, Target, Timer, Trophy } from "lucide-react";
import { ScoreRing } from "@/components/student/ScoreRing";
import { QuestionRenderer, TestQuestionShape } from "@/components/student/QuestionRenderer";
// The STUDENT panel header, not ui-bits'. Both export a `PageHeader` with the
// same props and different designs — text-3xl display face with a 0.2em eyebrow
// here, text-[28px] with a bottom rule and a primary eyebrow there — so a
// student crossing from a gurukul screen into this one saw the page title
// change size, weight and typeface. That is the two-halves split in one import.
import { PageHeader } from "@/gurukul/components/shared";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { ConceptRecoveryReport } from "@/components/student/ConceptRecoveryReport";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { displayChapter, displaySubject, displayTopic } from "@/lib/academicPresentation";
import { toDisplayText, toErrorMessage } from "@/lib/presentation";
import type { TestStudentReport } from "@/academic/services/testService";
import {
  studentReportCsvRows,
  wrongAnswersByTopic,
} from "@/academic/services/testReportSheets";
import { exportCSV } from "@/lib/exportCsv";
import { answerToText } from "@/academic/services/answerText";


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
  // §10.25's report, which is not the same thing as the question review below.
  // The review walks the paper; the report says which TOPICS the wrong answers
  // fell in, and is the half a student can act on. It is fetched through
  // `rpc_test_student_report`, the fenced path, rather than assembled here.
  const [report, setReport] = useState<TestStudentReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);

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
      // Only once there is a submitted attempt: `rpc_test_student_report`
      // refuses a test this student has not sat, which is what stops it from
      // handing out the answer key before the exam (20260916020000). Asking
      // anyway would turn that correct refusal into an error message on a page
      // that is working perfectly.
      if (a?.submitted_at && serviceCtx.studentId) {
        try {
          setReport(await TestService.studentReport(serviceCtx, id, serviceCtx.studentId));
          setReportError(null);
        } catch (e) {
          // Not fatal to the page — but not silent either. A swallowed failure
          // here would render as "no topics to revise", which is a claim.
          setReport(null);
          setReportError(toErrorMessage(e, "Could not load your topic summary"));
        }
      } else {
        setReport(null);
        setReportError(null);
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
  // Rule 27. The per-question responses live in `test_answers`, which is a
  // different table from the attempt that carries the score — so "we have a
  // score" does not imply "we have the answers". Keyed off the map this page
  // actually renders from, not off the attempt's status.
  const hasResponses = Object.keys(answers).length > 0;
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

      {/* ── §10.25 · THE REPORT, WHICH IS NOT THE QUESTION REVIEW ───────────
          "Their actual wrong answers, with the topic on each." The review
          further down walks the paper one item at a time; this collapses the
          same wrong answers onto the topics they fell in, which is the half a
          student can act on before the next test, and it is what the Download
          hands over. Both halves come from `rpc_test_student_report` — the
          client never decides who may read a report, and never assembles one
          out of table reads of its own. */}
      {reportError && (
        <Card className="p-4 mb-6 text-sm text-muted-foreground">{reportError}</Card>
      )}
      {report && report.submitted && (
        <Card className="p-4 mb-6">
          {/* The leaderboard the ruling asked for, as a position. The names and
              marks of the other children are not in this payload and are not
              meant to be — a student still never sees the class list. */}
          {report.rank != null && report.class_size != null && (
            <div className="flex items-center gap-2 mb-3 pb-3 border-b">
              <Trophy className="w-5 h-5 text-accent shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">On this test</div>
                <div className="font-bold text-lg">
                  {report.rank} of {report.class_size}
                </div>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 mb-2">
            <h3 className="font-semibold text-sm">Topics to revise</h3>
            <Button
              variant="outline"
              size="sm"
              disabled={report.wrong_answers.length === 0}
              onClick={() =>
                exportCSV(`my-test-report-${report.test_id}`, studentReportCsvRows(report))
              }
            >
              <Download className="w-4 h-4" /> Download
            </Button>
          </div>
          {report.wrong_answers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing went wrong on this test, so there is no topic to revise from it.
            </p>
          ) : (
            <ul className="space-y-1">
              {wrongAnswersByTopic(report).map((row) => (
                <li
                  key={row.topic}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="truncate">{row.topic}</span>
                  <span className="text-muted-foreground shrink-0">{row.wrong} wrong</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* ── RULE 27: A MISSING-DATA RENDER MUST NOT READ AS A DATA-BEARING ONE ──
          The attempt row records a score; the per-question responses are a
          separate table. `test_answers` is written only by `rpc_test_submit`,
          and every one of the 458 attempts in this database was written
          directly, so it holds 0 rows. This page used to render each question
          with the correct answer and a blank student response — visually
          identical to "you left it blank" — under a line promising the wrong
          ones had been saved to the Mistake Book.

          It looked functional and misrepresented. Where the responses are
          absent, say they are absent, and make no claim about the Mistake
          Book, which is fed from the same rows. */}
      {/* Not a celebration gate — see PracticeSessionResult for the full note. */}
      {correctCount < totalCount && (
        <Card className="p-4 mb-6 border-primary/20 bg-primary/5">
          <h3 className="font-semibold text-sm mb-2">Improvement focus</h3>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
            {accuracy < ACCURACY_BUILDING && hasResponses && (
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
      {!hasResponses ? (
        <Card className="p-4 text-sm text-muted-foreground">
          Your individual answers for this test were not recorded, so there is
          nothing to review question by question. Your score above is unaffected
          — it is stored on the attempt itself.
        </Card>
      ) : (
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
          // `q.correct` and the response are untyped jsonb, and for every
          // auto-marked format they hold a POSITION rather than a word. One
          // decoder handles all four shapes and is shared with the teacher's
          // report, so the two screens cannot start disagreeing about what an
          // answer payload says; it returns null rather than a guess, which is
          // why neither branch can produce "[object Object]".
          const correctText = answerToText(q.correct, opts) ?? "";
          const selectedText = answerToText(resp, opts) ?? "";
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
      )}
    </>
  );
}
