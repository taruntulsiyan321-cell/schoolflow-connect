import { ACCURACY_BUILDING, ACCURACY_PROCEDURAL } from "@/academic/metrics/bands";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, PracticeService } from "@/academic";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Save } from "lucide-react";
// The STUDENT panel header, not ui-bits'. Both export a `PageHeader` with the
// same props and different designs — text-3xl display face with a 0.2em eyebrow
// here, text-[28px] with a bottom rule and a primary eyebrow there — so a
// student crossing from a gurukul screen into this one saw the page title
// change size, weight and typeface. That is the two-halves split in one import.
import { PageHeader } from "@/gurukul/components/shared";
import { ConceptRecoveryReport } from "@/components/student/ConceptRecoveryReport";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { toast } from "sonner";
import {
  buildPracticeRecoveryReport,
  snapshotsToAttemptRows,
  type PracticeSessionResultState,
} from "@/lib/practiceSessionSnapshot";
import type { PracticeAnalysisSnapshot } from "@/lib/practiceAnalysisSnapshot";
import {
  deriveSessionAccuracy,
  formatSessionAccuracy,
  formatSessionDuration,
  formatSessionXp,
  resolvePracticeSessionStats,
} from "@/lib/practiceSessionStats";
import { displayChapter, displaySubject } from "@/lib/academicPresentation";
import { paceOverAnswers } from "@/lib/studentAnalysisMetrics";
import { practiceModeLabel } from "@/lib/practiceModeLabel";
import { setNovaQuestionContext } from "@/gurukul/novaQuestionContext";
import { isUuid, toErrorMessage } from "@/lib/presentation";
import { markRefFromAttempt } from "@/lib/questionMarks";
import { useQuestionMarks } from "@/components/student/questionMarks/useQuestionMarks";
import { useQuestionReports } from "@/components/student/questionReports/useQuestionReports";
import { fetchSessionAnalysisContext, type SessionAnalysisContext } from "@/lib/sessionAnalysisContext";
import { analyseSession } from "@/components/student/sessionResult/analyseSession";
import { QuestionsTab } from "@/components/student/sessionResult/QuestionsTab";
import { SessionQuestionCard } from "@/components/student/sessionResult/SessionQuestionCard";
import { SessionTabBar } from "@/components/student/sessionResult/SessionTabs";
import { useSessionTabs } from "@/components/student/sessionResult/useSessionTabs";
import { SessionVerdicts } from "@/components/student/sessionResult/SessionVerdicts";
import { SummaryTab } from "@/components/student/sessionResult/SummaryTab";
import { TimeTab } from "@/components/student/sessionResult/TimeTab";
import { TopicsTab } from "@/components/student/sessionResult/TopicsTab";
import type { AttemptRow } from "@/components/student/sessionResult/types";

function readLocalState(id: string): PracticeSessionResultState | null {
  try {
    const raw = sessionStorage.getItem(`practice-session-result-${id}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PracticeSessionResultState;
    return parsed?.attempts?.length ? parsed : null;
  } catch {
    return null;
  }
}

type SessionRow = {
  id: string;
  subject: string;
  chapter: string;
  question_count: number;
  correct_count: number;
  score: number;
  created_at: string;
  finished_at: string | null;
  practice_mode?: string | null;
  skipped_count?: number | null;
  wrong_count?: number | null;
  total_time_ms?: number | null;
  accuracy?: number | null;
  saved_at?: string | null;
  analysis_snapshot?: PracticeAnalysisSnapshot | null;
  xp_earned?: number | null;
  difficulty?: string | null;
};

export default function PracticeSessionResult() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { ctx, ready: academicReady } = useAcademicContext();

  const localState = useMemo(() => {
    const fromNav = location.state as PracticeSessionResultState | null;
    if (fromNav?.attempts?.length) return fromNav;
    if (id) return readLocalState(id);
    return null;
  }, [location.state, id]);

  // Only ever present on a recovery session, and only from this navigation:
  // it is the engine's verdict on the session that just finished, not a fact
  // about the practice_sessions row, so it is never re-read from the database.
  const recovery = localState?.recovery ?? null;

  // Same rule, same reason: §5.5 decided pass or fail and §5.3 scheduled the
  // next date, both server-side. This screen quotes them.
  const revision = localState?.revision ?? null;

  const [session, setSession] = useState<SessionRow | null>(null);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [dbLoading, setDbLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Every question here can be marked — wrong, skipped, or right by a guess.
  const { tags: markTags, marks, setMark } = useQuestionMarks(user?.id);

  const snapshot = session?.analysis_snapshot ?? null;

  const localAttempts = useMemo(
    () => (localState ? snapshotsToAttemptRows(localState.attempts) : []),
    [localState],
  );

  // A saved session's questions, as its snapshot froze them. Versions 2 and 4
  // hold every question; version 3 (2026-09-23 to 09-25) held the wrong and
  // the skipped only, under a rule the owner has since withdrawn.
  const snapshotAttempts = useMemo(() => {
    if (!snapshot?.attempts?.length) return [];
    return snapshot.attempts.map((a, i) => ({
      id: `snap-${i}`,
      generated_question: { question: a.question, options: a.options, explanation: a.explanation },
      correct_answer: { index: a.correctIndex, text: a.options[a.correctIndex] ?? "" },
      selected_answer: { index: a.selectedIndex, text: a.options[a.selectedIndex] ?? "" },
      is_correct: a.isCorrect,
      created_at: snapshot.finishedAt ?? new Date().toISOString(),
      skipped: a.skipped ?? false,
      // Absent on snapshots saved before version 5: no time, not zero.
      time_taken_ms: a.timeTakenMs ?? null,
    }));
  }, [snapshot]);

  /**
   * The session that just finished on this device is reviewed from the
   * navigation's own state; opened again later, or on another device, from
   * the database or a saved snapshot. Every question either way (ruled
   * 2026-09-25: a finished session keeps its right answers too).
   */
  const displayAttempts = useMemo(() => {
    if (localAttempts.length > 0) return localAttempts;
    if (attempts.length > 0) return attempts;
    return snapshotAttempts;
  }, [attempts, snapshotAttempts, localAttempts]);

  // A bank question can be reported (§10.21); the student's own uploaded or
  // captured questions are disputed instead, not reported.
  const bankIds = useMemo(
    () => displayAttempts.map((a) => markRefFromAttempt(a)).filter((r) => r?.kind === "bank").map((r) => r!.id),
    [displayAttempts],
  );
  const { reports, setReport } = useQuestionReports(user?.id, bankIds);

  // The comparison, the exam marks and the questions met before need what the
  // session's own rows do not hold (20261143000000). Without it — offline, or
  // a session that is not this student's to read — the session is read alone.
  const [context, setContext] = useState<SessionAnalysisContext | null>(null);
  useEffect(() => {
    if (!user || !id || !isUuid(id)) return;
    let cancelled = false;
    fetchSessionAnalysisContext(id)
      .then((c) => { if (!cancelled) setContext(c); })
      .catch(() => { if (!cancelled) setContext(null); });
    return () => { cancelled = true; };
  }, [user, id]);
  const analysis = useMemo(() => analyseSession(displayAttempts, context), [displayAttempts, context]);

  const { tab, setTab, filter, setFilter, showQuestions, showQuestion } = useSessionTabs();

  // `||`, not `??`: a session with no single subject stores "" — an empty
  // string is an absent subject, not one to print.
  const subjectRaw = session?.subject || snapshot?.subject || localState?.subject || "";
  const chapterRaw = session?.chapter || snapshot?.chapter || localState?.chapter || "";
  const subject = subjectRaw ? displaySubject(subjectRaw) : "";
  const chapter = chapterRaw ? displayChapter(chapterRaw) : "";
  const typeLabel = practiceModeLabel(session?.practice_mode ?? snapshot?.practiceMode ?? localState?.practiceMode ?? null);
  // A session that spans chapters is titled by what it was — "Weak Areas
  // Practice" — not by the chapter its first question happened to come from.
  const heading = [subject, chapter].filter(Boolean).join(" · ") || typeLabel;

  // ONE reading of this session, from the best source there is: the finished
  // row, else the finish RPC's own reply or a saved snapshot, else — offline,
  // before either arrives — this device's own attempt log. Each of those used
  // to be read with its own arithmetic here, and the local one counted a skip
  // as a wrong answer.
  const localOverlay = useMemo(() => {
    if (!localState?.attempts?.length) return null;
    const answered = localState.attempts.filter((x) => !x.skipped && !x.timedOut);
    const correctCount = answered.filter((x) => x.isCorrect).length;
    const ms = localState.attempts.reduce((sum, x) => sum + (x.timeTakenMs ?? 0), 0);
    return {
      questionCount: localState.attempts.length,
      correctCount,
      wrongCount: answered.length - correctCount,
      skippedCount: localState.attempts.length - answered.length,
      accuracy: deriveSessionAccuracy(correctCount, answered.length - correctCount),
      totalTimeMs: ms > 0 ? ms : null,
    };
  }, [localState]);
  const overlay = snapshot ?? localState?.serverStats ?? localOverlay;
  const stats = resolvePracticeSessionStats(session, overlay);
  const total = stats.questionCount;
  const correct = stats.correctCount;
  const wrong = stats.wrongCount;
  const skipped = stats.skippedCount;
  const accuracy = stats.accuracy;
  const xpLabel = formatSessionXp(stats.xpEarned, stats.xpFromDb);
  // A session is as long as its questions took (20261030000000) — never the
  // wall clock from opening to finishing, and never a floor of one minute.
  const durationLabel = formatSessionDuration(stats.totalTimeMs);
  // Seconds per ANSWER, off the questions below — the rule Analysis uses
  // (paceOverAnswers / avg_sec). It was total ÷ question count, and saved
  // sessions froze that figure: skips, taken in a second or two, pulled the
  // average down, and the list of times beside it could not reproduce it.
  const { avgSec } = paceOverAnswers(
    displayAttempts.map((a) => ({ timeMs: a.time_taken_ms, skipped: Boolean(a.skipped) })),
  );

  const insights = snapshot?.insights;
  const recommendations: string[] =
    insights?.recommendations ??
    // RULING 2, and the finding it produced. This was reported as one of three
    // "perfect-score celebrations"; it is not one. `accuracy < 100` GATES
    // corrective advice — at 100 the advice is hidden, not a trophy shown. The
    // celebration that did live here was removed earlier (see the §10.8 note
    // below), leaving only the gate.
    //
    // It is now written as what it means: "did anything go wrong". The old form
    // asked it through a ROUNDED percentage, and Math.round(99.6) is 100 — a
    // long session with one wrong answer could round to a clean sheet and lose
    // the advice. Rare, but it fails in the direction that hides the fix.
    (wrong > 0
      ? [
          accuracy != null && accuracy < ACCURACY_BUILDING ? "Go through your wrong answers under Questions — each one is already in your Mistake Book." : null,
          accuracy != null && accuracy < ACCURACY_PROCEDURAL ? "Revise weak topics from Analysis before your next practice session." : null,
          'Under Questions, use "Explain my mistake" on each wrong answer to understand the concept.',
        ].filter(Boolean) as string[]
      // §10.8. This read "Excellent accuracy — keep momentum with a short daily
      // practice." at 100%. The rule permits the NUMBER — "session totals are
      // stored so accuracy can be shown" — and forbids the praise attached to
      // it. The next step survives; the verdict on the student does not.
      : skipped > 0 && correct === 0
        ? ["Every question was skipped — try the ones you skipped when you have more time."]
        : ["Keep a short daily practice going to hold this topic."]);

  // The report reads the session's totals — the same figures this page prints
  // above — so the two cannot disagree.
  const fallbackReport = useMemo(() => {
    if (!id || total === 0) return null;
    // null, not a floor of one minute: a session with no timing has no duration.
    const minutes = stats.totalTimeMs ? Math.round(stats.totalTimeMs / 60000) : null;
    return buildPracticeRecoveryReport(id, subjectRaw, chapterRaw, { correct, answered: correct + wrong }, minutes);
  }, [id, subjectRaw, chapterRaw, correct, wrong, total, stats.totalTimeMs]);

  const retryUrl = `/student/practice`;
  const hasLocalData = displayAttempts.length > 0 || !!snapshot;

  useEffect(() => {
    if (!id || !user) {
      if (hasLocalData) setDbLoading(false);
      return;
    }

    (async () => {
      setDbLoading(true);
      setLoadError(null);

      try {
        if (ctx && academicReady) {
          const row = await PracticeService.getSession(ctx, id);
          if (row) {
            setSession(row as unknown as SessionRow);
            setSavedAt(row.saved_at ?? null);
          }
          const rows = await PracticeService.listSessionAttempts(ctx, id);
          if (rows?.length) setAttempts(rows as AttemptRow[]);
          setDbLoading(false);
          return;
        }

        const { data: s, error: sErr } = await supabase
          .from("practice_sessions")
          .select("*")
          .eq("id", id)
          .eq("user_id", user.id)
          .maybeSingle();

        if (sErr) {
          setLoadError(sErr.message);
          setDbLoading(false);
          return;
        }

        if (s) {
          const row = s as unknown as SessionRow;
          setSession(row);
          setSavedAt(row.saved_at ?? null);
        }

        const { data: rows, error: aErr } = await supabase
          .from("question_attempts")
          .select("*")
          .eq("session_id", id)
          .order("created_at");

        if (aErr) {
          setLoadError(aErr.message);
          setDbLoading(false);
          return;
        }

        if (rows?.length) setAttempts(rows as AttemptRow[]);
        setDbLoading(false);
      } catch (e) {
        setLoadError(toErrorMessage(e, "Could not load session"));
        setDbLoading(false);
      }
    })();
  }, [id, user, hasLocalData, ctx, academicReady]);

  async function handleSaveSession() {
    if (!id || !ctx || !academicReady) {
      toast.error("Sign in to save this session");
      return;
    }
    if (savedAt) {
      toast.message("Session already saved");
      return;
    }
    setSaving(true);
    try {
      // The snapshot is built by PracticeService.saveSession, from the session
      // row and its recorded attempts. This screen used to build its own from
      // whatever it happened to hold, and the hub built a different one.
      const res = await PracticeService.saveSession(ctx, id);
      setSavedAt(res.saved_at);
      if (res.already_saved) toast.message("Session already saved");
      else toast.success("Session saved — find it under Saved Sessions");
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not save this session"));
    } finally {
      setSaving(false);
    }
  }

  if (dbLoading && !hasLocalData) return <StudentListSkeleton rows={4} />;

  if (loadError && !hasLocalData) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to="/student/practice"><ArrowLeft className="w-4 h-4" /> Practice</Link>
        </Button>
        <StudentErrorState title="Could not load results" message={loadError} onRetry={() => window.location.reload()} />
      </>
    );
  }

  if (!session && !localState && !snapshot) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to="/student/practice"><ArrowLeft className="w-4 h-4" /> Practice</Link>
        </Button>
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">This practice session could not be found.</p>
        </Card>
      </>
    );
  }

  const cards = displayAttempts.map((a, i) => {
    const markRef = markRefFromAttempt(a);
    return {
      order: i,
      card: (
        <SessionQuestionCard
          attempt={a}
          order={i}
          notes={analysis.notes.get(i) ?? []}
          subjectRaw={subjectRaw}
          chapterRaw={chapterRaw}
          sessionId={id ?? null}
          userId={user?.id ?? null}
          mark={markRef ? marks.get(markRef.id) ?? null : null}
          markTags={markTags}
          onMark={setMark}
          report={markRef?.kind === "bank" ? reports.get(markRef.id) ?? null : null}
          onReport={setReport}
          onAskNova={(q) => {
            setNovaQuestionContext({
              question: q.question,
              options: q.options,
              correctIndex: q.correctIndex,
              subject: subjectRaw,
              chapter: chapterRaw,
              studentAnswer: q.selectedText,
              studentAnswerIndex: q.selectedIndex,
            });
            navigate("/student/aicoach");
          }}
        />
      ),
    };
  });

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2">
        <Link to="/student/practice"><ArrowLeft className="w-4 h-4" /> Practice</Link>
      </Button>
      <PageHeader
        title={heading}
        subtitle={`${typeLabel} · ${
          session?.finished_at
            ? new Date(session.finished_at).toLocaleString()
            : snapshot?.finishedAt
              ? new Date(snapshot.finishedAt).toLocaleString()
              : "Just now"
        }`}
      />

      <SessionVerdicts recovery={recovery} revision={revision} />

      <div className="flex flex-wrap gap-2 mb-6">
        {/* Nothing was answered — there is no analysis to freeze. */}
        {total > 0 && (
          <Button
            size="sm"
            onClick={() => void handleSaveSession()}
            disabled={saving || Boolean(savedAt)}
            className="gap-1.5"
          >
            <Save className="w-4 h-4" />
            {savedAt ? "Saved" : saving ? "Saving…" : "Save Session"}
          </Button>
        )}
        <Button asChild variant="outline" size="sm">
          <Link to={retryUrl}>Back to Practice</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/student/mistakes">Mistake book</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/student/recovery">Recovery zone</Link>
        </Button>
      </div>

      <SessionTabBar tab={tab} onTab={setTab} label="Session analysis" />

      {tab === "summary" && (
        <SummaryTab
          analysis={analysis}
          stats={{
            total,
            correct,
            wrong,
            skipped,
            accuracyLabel: formatSessionAccuracy(accuracy),
            durationLabel,
            xpLabel,
            avgSec,
          }}
          subjectRaw={subjectRaw}
          chapterRaw={chapterRaw}
          // A session is compared with the last one on its chapter; one that
          // spanned chapters has no single last time.
          compare={chapter ? {
            title: `your last session on ${chapter}`,
            first: "This is your first session on this chapter. Your next one will be compared with it.",
          } : null}
          recommendations={recommendations}
          insights={insights}
          onShowQuestions={showQuestions}
        />
      )}
      {tab === "topics" && (
        <TopicsTab
          analysis={analysis}
          subjectRaw={subjectRaw}
          chapterRaw={chapterRaw}
          conceptReport={id && fallbackReport ? (
            <ConceptRecoveryReport
              sourceType="practice_session"
              sourceId={id}
              title="Practice concept recovery report"
              fallbackReport={fallbackReport}
            />
          ) : null}
        />
      )}
      {tab === "time" && <TimeTab analysis={analysis} onShowQuestion={showQuestion} />}
      {tab === "questions" && (
        <QuestionsTab
          filters={analysis.filters}
          active={filter}
          onFilter={setFilter}
          cards={cards}
          empty={total === 0
            ? "No question was answered in this session, so there is nothing to review."
            : "The questions from this session are no longer available to review."}
        />
      )}
    </>
  );
}
