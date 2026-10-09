import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/gurukul/components/shared";
import { StudentErrorState, StudentSessionSkeleton } from "@/components/student/StudentPanelStates";
import { useAuth } from "@/hooks/useAuth";
import { displayChapter, displaySubject } from "@/lib/academicPresentation";
import { deriveSessionAccuracy, formatSessionAccuracy, formatSessionDuration } from "@/lib/practiceSessionStats";
import { paceOverAnswers } from "@/lib/studentAnalysisMetrics";
import { toErrorMessage } from "@/lib/presentation";
import { setNovaQuestionContext } from "@/gurukul/novaQuestionContext";
import { markRefFromAttempt } from "@/lib/questionMarks";
import { useQuestionMarks } from "@/components/student/questionMarks/useQuestionMarks";
import { useQuestionReports } from "@/components/student/questionReports/useQuestionReports";
import { readSessionAnalysisContext, type SessionAnalysisContext } from "@/lib/sessionAnalysisContext";
import { analyseSession } from "@/components/student/sessionResult/analyseSession";
import { QuestionsTab } from "@/components/student/sessionResult/QuestionsTab";
import { SessionQuestionCard } from "@/components/student/sessionResult/SessionQuestionCard";
import { SessionTabBar } from "@/components/student/sessionResult/SessionTabs";
import { useSessionTabs } from "@/components/student/sessionResult/useSessionTabs";
import { SummaryTab } from "@/components/student/sessionResult/SummaryTab";
import { TimeTab } from "@/components/student/sessionResult/TimeTab";
import { TopicsTab } from "@/components/student/sessionResult/TopicsTab";
import {
  MockError, fetchMockAnalysisContext, fetchMockResult, mockResultToAttemptRows,
  type MockResult as MockResultShape,
} from "@/lib/mockTest";

/**
 * A marked mock paper, read the way a practice session is (B5): the score, then
 * the same four tabs — the paper at a glance with its guesses and marks, where
 * the marks went by chapter, topic, difficulty and kind of question, how time
 * went, and every question with its answer.
 *
 * The right answers arrive here and nowhere earlier — rpc_mock_result refuses
 * until the paper is submitted, and the paper the student sits carries no
 * answer at all. The score is the server's marking; the analysis reads the
 * same answers, and its comparison and "met before" come from
 * rpc_mock_analysis_context, which has the shape a practice session's has.
 */
export default function MockResult() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { user } = useAuth();
  const [result, setResult] = useState<MockResultShape | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<SessionAnalysisContext | null>(null);
  const { tab, setTab, filter, setFilter, showQuestions, showQuestion } = useSessionTabs();
  // Every question here can be marked — wrong, left, or right by a guess.
  const { tags: markTags, marks, setMark } = useQuestionMarks(user?.id);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void (async () => {
      try {
        const r = await fetchMockResult(id);
        if (alive) setResult(r);
      } catch (e) {
        if (!alive) return;
        if (e instanceof MockError && e.refusal === "mock_not_submitted") {
          // Still open: the paper is where they should be, not here.
          nav(`/student/mock/${id}`, { replace: true });
          return;
        }
        setError(e instanceof MockError ? e.message : toErrorMessage(e, "Could not load the result"));
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, nav]);

  // Only once the paper is marked: before that the context is refused too.
  // Without it the paper is read alone — no comparison, no "met before".
  useEffect(() => {
    if (!result) return;
    let alive = true;
    fetchMockAnalysisContext(result.id)
      .then((raw) => { if (alive) setContext(readSessionAnalysisContext(raw)); })
      .catch(() => { if (alive) setContext(null); });
    return () => {
      alive = false;
    };
  }, [result]);

  const rows = useMemo(() => (result ? mockResultToAttemptRows(result) : []), [result]);
  const analysis = useMemo(() => analyseSession(rows, context), [rows, context]);
  const bankIds = useMemo(() => (result ? result.questions.map((q) => q.id) : []), [result]);
  const { reports, setReport } = useQuestionReports(user?.id, bankIds);

  if (error) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <StudentErrorState title="Could not load the result" message={error} />
        <div className="text-center">
          <Button variant="outline" size="sm" asChild>
            <Link to="/student/mocks">Back to Mock Tests</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!result) return <StudentSessionSkeleton label="Loading your result…" />;

  const subjectRaw = result.subject;
  const chapterRaw = result.chapter ?? "";
  const subject = displaySubject(subjectRaw) || subjectRaw;
  const chapter = chapterRaw ? displayChapter(chapterRaw) || chapterRaw : "";
  const { avgSec } = paceOverAnswers(rows.map((r) => ({ timeMs: r.time_taken_ms, skipped: Boolean(r.skipped) })));

  const cards = result.questions.map((q, i) => {
    const row = rows[i];
    if (!q.available) {
      return {
        order: i,
        card: (
          <Card id={`question-${i + 1}`} className="scroll-mt-24 p-5" data-testid="session-question">
            <div className="mb-2 text-xs text-muted-foreground">Q{i + 1}</div>
            <p className="text-sm text-muted-foreground">
              This question was withdrawn from the bank after your paper was made, so it cannot be reviewed. It carried no marks either way.
            </p>
          </Card>
        ),
      };
    }
    const markRef = markRefFromAttempt(row);
    return {
      order: i,
      card: (
        <SessionQuestionCard
          attempt={row}
          order={i}
          notes={analysis.notes.get(i) ?? []}
          subjectRaw={subjectRaw}
          chapterRaw={q.chapter ?? chapterRaw}
          // A report names a practice session (question_reports.session_id);
          // a mock paper is not one, so its reports name none.
          sessionId={null}
          userId={user?.id ?? null}
          mark={markRef ? marks.get(markRef.id) ?? null : null}
          markTags={markTags}
          onMark={setMark}
          report={reports.get(q.id) ?? null}
          onReport={setReport}
          onAskNova={(c) => {
            setNovaQuestionContext({
              question: c.question,
              options: c.options,
              correctIndex: c.correctIndex,
              subject: subjectRaw,
              chapter: q.chapter ?? chapterRaw,
              studentAnswer: c.selectedText,
              studentAnswerIndex: c.selectedIndex,
            });
            nav("/student/aicoach");
          }}
        />
      ),
    };
  });

  return (
    <div className="mx-auto max-w-3xl">
      <Button variant="ghost" size="sm" asChild className="mb-2">
        <Link to="/student/mocks"><ArrowLeft className="h-4 w-4" /> Mock Tests</Link>
      </Button>
      <PageHeader
        eyebrow={chapter ? "Chapter mock test" : "Mock test"}
        title={[subject, chapter].filter(Boolean).join(" · ")}
        subtitle={`${new Date(result.submitted_at).toLocaleString()} · ${
          result.auto_submitted ? "submitted when the hour ran out" : "submitted by you"
        }`}
      />

      <p className="mb-4 text-3xl font-black leading-tight text-foreground" data-testid="mock-score" style={{ fontFamily: "var(--font-display)" }}>
        {result.score} <span className="text-lg font-bold text-muted-foreground">of {result.max_score} marks</span>
      </p>

      {result.voided > 0 && (
        <p className="mb-4 flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground" data-testid="mock-voided-note">
          <Ban className="h-4 w-4 shrink-0" />
          {result.voided === 1
            ? "One question was withdrawn from the bank after your paper was made. It carried no marks either way."
            : `${result.voided} questions were withdrawn from the bank after your paper was made. They carried no marks either way.`}
        </p>
      )}

      <SessionTabBar tab={tab} onTab={setTab} label="Paper analysis" />

      {tab === "summary" && (
        <SummaryTab
          analysis={analysis}
          stats={{
            total: result.total,
            correct: result.correct,
            wrong: result.wrong,
            skipped: result.unanswered,
            accuracyLabel: formatSessionAccuracy(deriveSessionAccuracy(result.correct, result.wrong)),
            durationLabel: formatSessionDuration(result.seconds_taken * 1000),
            avgSec,
          }}
          subjectRaw={subjectRaw}
          chapterRaw={chapterRaw}
          // A paper is compared with the last one of the same kind: the same
          // subject's whole paper, or the same chapter's.
          compare={{
            title: `your last ${chapter || subject} paper`,
            first: `This is your first ${chapter || subject} paper. Your next one will be compared with it.`,
          }}
          recommendations={[]}
          insights={null}
          onShowQuestions={showQuestions}
        />
      )}
      {tab === "topics" && (
        <TopicsTab analysis={analysis} subjectRaw={subjectRaw} chapterRaw={chapterRaw} conceptReport={null} />
      )}
      {tab === "time" && <TimeTab analysis={analysis} onShowQuestion={showQuestion} />}
      {tab === "questions" && (
        <QuestionsTab
          filters={analysis.filters}
          active={filter}
          onFilter={setFilter}
          cards={cards}
          empty="This paper has no questions to review."
        />
      )}
    </div>
  );
}
