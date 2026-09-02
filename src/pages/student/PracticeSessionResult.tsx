import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, PracticeService } from "@/academic";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, BarChart2, Check, Lightbulb, Save, Target, Timer, X } from "lucide-react";
import { ScoreRing } from "@/components/student/ScoreRing";
import { PageHeader } from "@/components/ui-bits";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { ConceptRecoveryReport } from "@/components/student/ConceptRecoveryReport";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { MathText } from "@/components/MathText";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  buildPracticeRecoveryReport,
  snapshotsToAttemptRows,
  type PracticeSessionResultState,
} from "@/lib/practiceSessionSnapshot";
import {
  buildPracticeAnalysisSnapshot,
  type PracticeAnalysisSnapshot,
} from "@/lib/practiceAnalysisSnapshot";
import { resolvePracticeSessionStats, formatSessionXp } from "@/lib/practiceSessionStats";
import { displayChapter, displaySubject } from "@/lib/academicPresentation";
import { setNovaQuestionContext } from "@/gurukul/novaQuestionContext";
import { toErrorMessage } from "@/lib/presentation";

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

type AttemptRow = {
  id: string;
  generated_question: { question?: string; options?: string[]; explanation?: string };
  correct_answer: { index?: number; text?: string };
  selected_answer: { index?: number; text?: string } | null;
  is_correct: boolean | null;
  created_at: string;
  skipped?: boolean | null;
};

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

  const [session, setSession] = useState<SessionRow | null>(null);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [dbLoading, setDbLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const snapshot = session?.analysis_snapshot ?? null;

  const localAttempts = useMemo(
    () => (localState ? snapshotsToAttemptRows(localState.attempts) : []),
    [localState],
  );

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
    }));
  }, [snapshot]);

  const displayAttempts = useMemo(() => {
    if (attempts.length > 0) return attempts;
    if (snapshotAttempts.length > 0) return snapshotAttempts;
    return localAttempts;
  }, [attempts, snapshotAttempts, localAttempts]);

  const subjectRaw = session?.subject ?? snapshot?.subject ?? localState?.subject ?? "Practice";
  const chapterRaw = session?.chapter ?? snapshot?.chapter ?? localState?.chapter ?? "";
  const subject = displaySubject(subjectRaw);
  const chapter = chapterRaw ? displayChapter(chapterRaw) : "";

  // Prefer finish-RPC payload (nav/serverStats) + DB columns. Local tallies only as last resort.
  const localCorrect = displayAttempts.filter((a) => a.is_correct).length;
  const localSkipped = displayAttempts.filter((a) => !!(a as AttemptRow).skipped).length;
  const localWrong = displayAttempts.filter(
    (a) => !a.is_correct && !(a as AttemptRow).skipped,
  ).length;
  const overlay = snapshot ?? (localState?.serverStats
    ? {
        questionCount: localState.serverStats.questionCount,
        correctCount: localState.serverStats.correctCount,
        wrongCount: localState.serverStats.wrongCount,
        skippedCount: localState.serverStats.skippedCount,
        accuracy: localState.serverStats.accuracy,
        xpEarned: localState.serverStats.xpEarned,
        totalTimeMs: localState.serverStats.totalTimeMs,
      }
    : null);
  const stats = resolvePracticeSessionStats(session, overlay);
  const hasSessionRow = Boolean(session || overlay);
  // When finish-RPC / DB row exists, never inflate totals from local attempt array length.
  const total = hasSessionRow
    ? stats.questionCount
    : Math.max(displayAttempts.length, 0);
  const correct = hasSessionRow ? stats.correctCount : localCorrect;
  const wrong = hasSessionRow ? stats.wrongCount : localWrong;
  const skipped = hasSessionRow ? stats.skippedCount : localSkipped;
  const accuracy = hasSessionRow
    ? stats.accuracy
    : total
      ? Math.round((correct / total) * 100)
      : 0;
  const xpEarned = hasSessionRow ? stats.xpEarned : 0;
  const xpLabel = formatSessionXp(xpEarned, hasSessionRow ? stats.xpFromDb : false);
  const finishedMs =
    stats.totalTimeMs ??
    (session?.finished_at && session?.created_at
      ? new Date(session.finished_at).getTime() - new Date(session.created_at).getTime()
      : localState?.startedAt
        ? Date.now() - new Date(localState.startedAt).getTime()
        : 0);
  const mins = Math.max(1, Math.round((finishedMs || 60000) / 60000));
  const avgSec =
    snapshot?.statistics?.avgSecPerQuestion ??
    (finishedMs && total ? Math.round(finishedMs / total / 1000) : null);

  const insights = snapshot?.insights;
  const recommendations =
    insights?.recommendations ??
    (accuracy < 100
      ? [
          accuracy < 60 ? "Review wrong answers below — they feed Mistake Book automatically." : null,
          accuracy < 80 ? "Revise weak topics from Analysis before your next practice session." : null,
          'Use "Explain my mistake" on each wrong question to understand the concept.',
        ].filter(Boolean) as string[]
      // §10.8. This read "Excellent accuracy — keep momentum with a short daily
      // practice." at 100%. The rule permits the NUMBER — "session totals are
      // stored so accuracy can be shown" — and forbids the praise attached to
      // it. The next step survives; the verdict on the student does not.
      : ["Keep a short daily practice going to hold this topic."]);

  const fallbackReport = useMemo(() => {
    if (!id || displayAttempts.length === 0) return null;
    const snaps =
      localState?.attempts ??
      snapshot?.attempts ??
      displayAttempts.map((a) => ({
        question: a.generated_question?.question ?? "",
        options: a.generated_question?.options ?? [],
        correctIndex: typeof a.correct_answer?.index === "number" ? a.correct_answer.index : 0,
        selectedIndex: typeof a.selected_answer?.index === "number" ? a.selected_answer.index : 0,
        isCorrect: !!a.is_correct,
        skipped: !!a.skipped,
      }));
    return buildPracticeRecoveryReport(id, subjectRaw, chapterRaw, snaps, mins);
  }, [id, subjectRaw, chapterRaw, localState, snapshot, displayAttempts, mins]);

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
      const snap = buildPracticeAnalysisSnapshot({
        subject: subjectRaw,
        chapter: chapterRaw,
        practiceMode: session?.practice_mode ?? snapshot?.practiceMode ?? null,
        practiceTypeLabel: snapshot?.practiceTypeLabel,
        difficulty: session?.difficulty ?? snapshot?.difficulty ?? null,
        questionCount: total,
        correctCount: correct,
        wrongCount: wrong,
        skippedCount: skipped,
        accuracy,
        xpEarned,
        totalTimeMs: finishedMs || null,
        finishedAt: session?.finished_at ?? snapshot?.finishedAt ?? null,
        startedAt: session?.created_at ?? snapshot?.startedAt ?? localState?.startedAt ?? null,
        attempts:
          localState?.attempts?.map((a) => ({
            question: a.question,
            options: a.options,
            correctIndex: a.correctIndex,
            selectedIndex: a.selectedIndex,
            isCorrect: a.isCorrect,
            skipped: a.skipped,
            explanation: a.explanation,
          })) ??
          displayAttempts.map((a) => ({
            question: a.generated_question?.question ?? "",
            options: a.generated_question?.options ?? [],
            correctIndex: typeof a.correct_answer?.index === "number" ? a.correct_answer.index : 0,
            selectedIndex: typeof a.selected_answer?.index === "number" ? a.selected_answer.index : -1,
            isCorrect: !!a.is_correct,
            skipped: !!a.skipped,
            explanation: a.generated_question?.explanation,
          })),
        bookmarked: snapshot?.statistics?.bookmarked ?? 0,
      });
      const res = await PracticeService.saveSession(ctx, id, snap as unknown as Record<string, unknown>);
      setSavedAt(res.saved_at);
      if (res.already_saved) toast.message("Session already saved");
      else toast.success("Session saved — find it under Saved Sessions");
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not save session"));
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

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2">
        <Link to="/student/practice"><ArrowLeft className="w-4 h-4" /> Practice</Link>
      </Button>
      <PageHeader
        title={`${subject}${chapter ? ` · ${chapter}` : ""}`}
        subtitle={`Practice analysis · ${
          session?.finished_at
            ? new Date(session.finished_at).toLocaleString()
            : snapshot?.finishedAt
              ? new Date(snapshot.finishedAt).toLocaleString()
              : "Just now"
        }`}
      />

      <div className="flex flex-wrap gap-2 mb-6">
        <Button
          size="sm"
          onClick={() => void handleSaveSession()}
          disabled={saving || Boolean(savedAt)}
          className="gap-1.5"
        >
          <Save className="w-4 h-4" />
          {savedAt ? "Saved" : saving ? "Saving…" : "Save Session"}
        </Button>
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

      {/* Performance Summary */}
      <Card className="p-6 mb-6 flex flex-col sm:flex-row items-center gap-6 transition-shadow hover:shadow-md">
        <ScoreRing value={correct} max={total || 1} size={140} label="correct" />
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
            <div className="font-bold text-lg">{correct}/{total || displayAttempts.length}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">XP earned</div>
            <div className="font-bold text-lg">{xpLabel}</div>
          </div>
        </div>
      </Card>

      {/* Statistics */}
      <Card className="p-5 mb-6">
        <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
          <BarChart2 className="w-4 h-4" /> Statistics
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Wrong</div>
            <div className="font-bold text-lg">{wrong}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Skipped</div>
            <div className="font-bold text-lg">{skipped}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Avg / question</div>
            <div className="font-bold text-lg">{avgSec != null ? `${avgSec}s` : "—"}</div>
          </div>
          <div className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">Score</div>
            <div className="font-bold text-lg">{Number(session?.score ?? correct).toFixed(0)} / {total || displayAttempts.length}</div>
          </div>
        </div>
      </Card>

      {id && fallbackReport && (
        <ConceptRecoveryReport
          sourceType="practice_session"
          sourceId={id}
          title="Practice concept recovery report"
          fallbackReport={fallbackReport}
        />
      )}

      {/* Insights */}
      {(insights?.headline || insights?.bullets?.length) && (
        <Card className="p-4 mb-6 border-primary/20 bg-primary/5">
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <Lightbulb className="w-4 h-4" /> Insights
          </h3>
          {insights?.headline && <p className="text-sm font-medium mb-2">{insights.headline}</p>}
          {insights?.bullets && insights.bullets.length > 0 && (
            <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
              {insights.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <Card className="p-4 mb-6 border-primary/20 bg-primary/5">
          <h3 className="font-semibold text-sm mb-2">Recommendations</h3>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
            {recommendations.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </Card>
      )}

      <h3 className="font-semibold mb-3">Question review</h3>
      <div className="space-y-4">
        {displayAttempts.map((a, i) => {
          const gq = a.generated_question ?? {};
          const opts: string[] = Array.isArray(gq.options) ? gq.options : [];
          const correctIdx = typeof a.correct_answer?.index === "number" ? a.correct_answer.index : null;
          const selectedIdx = typeof a.selected_answer?.index === "number" ? a.selected_answer.index : null;
          const correctText = a.correct_answer?.text ?? (correctIdx != null ? opts[correctIdx] ?? "" : "");
          const selectedText = a.selected_answer?.text ?? (selectedIdx != null ? opts[selectedIdx] ?? "" : "");
          const questionText = gq.question ?? "";

          return (
            <Card key={a.id} className="p-5 transition-shadow hover:shadow-sm">
              <div className="text-xs text-muted-foreground mb-2">Q{i + 1}</div>
              <MathText block className="text-base leading-relaxed font-medium mb-4" text={questionText} />
              <div className="space-y-2 mb-4">
                {opts.map((opt, oi) => {
                  const isSel = oi === selectedIdx;
                  const isRight = oi === correctIdx;
                  return (
                    <div
                      key={oi}
                      className={cn(
                        "w-full text-left px-4 py-3 rounded-lg border flex items-center gap-3 text-sm",
                        isRight && "border-accent bg-accent/10",
                        isSel && !isRight && "border-destructive bg-destructive/10",
                        !isSel && !isRight && "border-border",
                      )}
                    >
                      <span className="font-semibold shrink-0">{String.fromCharCode(65 + oi)}.</span>
                      <MathText className="flex-1" text={opt} />
                      {isRight && <Check className="w-4 h-4 text-accent shrink-0" />}
                      {isSel && !isRight && <X className="w-4 h-4 text-destructive shrink-0" />}
                    </div>
                  );
                })}
              </div>
              <ExplainPanel
                question={questionText}
                options={opts}
                correctIndex={correctIdx}
                selectedIndex={selectedIdx}
                correctText={correctText}
                selectedText={selectedText}
                subject={subjectRaw}
                chapter={chapterRaw}
                wasCorrect={a.is_correct}
                onAskNova={() => {
                  setNovaQuestionContext({
                    question: questionText,
                    options: opts,
                    correctIndex: correctIdx,
                    subject: subjectRaw,
                    chapter: chapterRaw,
                  });
                  navigate("/student/aicoach");
                }}
              />
            </Card>
          );
        })}
      </div>

      {displayAttempts.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No question details saved for this session. Complete a new practice session after updating the app.
        </Card>
      )}
    </>
  );
}
