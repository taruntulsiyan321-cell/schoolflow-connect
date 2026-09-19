import { ACCURACY_BUILDING, ACCURACY_PROCEDURAL } from "@/academic/metrics/bands";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, PracticeService } from "@/academic";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, ArrowLeft, BarChart2, Check, CheckCircle2, Lightbulb, Save, Target, Timer, X } from "lucide-react";
import { ScoreRing } from "@/components/student/ScoreRing";
// The STUDENT panel header, not ui-bits'. Both export a `PageHeader` with the
// same props and different designs — text-3xl display face with a 0.2em eyebrow
// here, text-[28px] with a bottom rule and a primary eyebrow there — so a
// student crossing from a gurukul screen into this one saw the page title
// change size, weight and typeface. That is the two-halves split in one import.
import { GlassCard, PageHeader } from "@/gurukul/components/shared";
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
import type { PracticeAnalysisSnapshot } from "@/lib/practiceAnalysisSnapshot";
import {
  deriveSessionAccuracy,
  formatSessionAccuracy,
  formatSessionDuration,
  formatSessionXp,
  resolvePracticeSessionStats,
} from "@/lib/practiceSessionStats";
import { displayChapter, displaySubject } from "@/lib/academicPresentation";
import { practiceModeLabel } from "@/lib/practiceModeLabel";
import { setNovaQuestionContext } from "@/gurukul/novaQuestionContext";
import { toErrorMessage } from "@/lib/presentation";
import { recoveryVerdictLine } from "@/lib/recoveryVerdict";
import { revisionSplitLine, revisionVerdictLine } from "@/lib/revisionVerdict";

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
  const avgSec =
    snapshot?.statistics?.avgSecPerQuestion ??
    (stats.totalTimeMs && total ? Math.round(stats.totalTimeMs / total / 1000) : null);

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
          accuracy != null && accuracy < ACCURACY_BUILDING ? "Review wrong answers below — they feed Mistake Book automatically." : null,
          accuracy != null && accuracy < ACCURACY_PROCEDURAL ? "Revise weak topics from Analysis before your next practice session." : null,
          'Use "Explain my mistake" on each wrong question to understand the concept.',
        ].filter(Boolean) as string[]
      // §10.8. This read "Excellent accuracy — keep momentum with a short daily
      // practice." at 100%. The rule permits the NUMBER — "session totals are
      // stored so accuracy can be shown" — and forbids the praise attached to
      // it. The next step survives; the verdict on the student does not.
      : skipped > 0 && correct === 0
        ? ["Every question was skipped — try the ones you skipped when you have more time."]
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
    const minutes = stats.totalTimeMs ? Math.max(1, Math.round(stats.totalTimeMs / 60000)) : 1;
    return buildPracticeRecoveryReport(id, subjectRaw, chapterRaw, snaps, minutes);
  }, [id, subjectRaw, chapterRaw, localState, snapshot, displayAttempts, stats.totalTimeMs]);

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

      {/* §4.2b — the recovery verdict, and it is deliberately TWO figures.
          "You can do the steps but the idea isn't solid yet" is actionable;
          a single blended 74% is not, and the spec calls that out by name.
          Rendered from the engine's own answer, never recomputed here. */}
      {recovery && (
        <GlassCard className="p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div
              className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center",
                recovery.outcome === "ready" ? "bg-emerald-500/15" : "bg-amber-500/15",
              )}
            >
              {recovery.outcome === "ready"
                ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                : <AlertCircle className="w-4 h-4 text-amber-400" />}
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">
                {recovery.outcome === "ready" ? "Chapter recovered" : "Not solid yet"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {recoveryVerdictLine(recovery)}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {[
              {
                label: "Running the steps",
                sub: "the questions and their variants",
                rate: recovery.procedural_rate,
                passed: recovery.procedural_passed,
              },
              {
                label: "Understanding it",
                sub: "the idea reframed and applied",
                rate: recovery.conceptual_rate,
                passed: recovery.conceptual_passed,
              },
            ].map((r) => (
              <div
                key={r.label}
                className="p-3 rounded-xl border border-border/70 bg-surface/60"
              >
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                  {r.label}
                </div>
                <div
                  className={cn(
                    "text-xl font-black tabular-nums",
                    r.passed ? "text-emerald-400" : "text-amber-400",
                  )}
                >
                  {/* A rate over zero questions is absent, not 0% — the tier
                      had nothing in it, which is a different statement. */}
                  {r.rate == null ? "—" : `${Math.round(r.rate * 100)}%`}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{r.sub}</div>
              </div>
            ))}
          </div>

          {recovery.outcome === "ready" && recovery.next_revision_at && (
            <p className="text-[11px] text-muted-foreground mt-3">
              Next revision check on{" "}
              {new Date(recovery.next_revision_at).toLocaleDateString(undefined, {
                day: "numeric", month: "short",
              })}
              .
            </p>
          )}
        </GlassCard>
      )}

      {/* §5.3/§5.5 — the revision verdict. A session is a recovery session or
          a revision check, never both, so this and the card above cannot
          stack. Every figure here is the engine's: the threshold it passed,
          the rung it was for, the streak it is on, and the date it wrote. */}
      {revision && (
        <GlassCard className="p-5 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <div
              className={cn(
                "w-7 h-7 rounded-lg flex items-center justify-center",
                revision.passed ? "bg-emerald-500/15" : "bg-amber-500/15",
              )}
            >
              {revision.passed
                ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                : <AlertCircle className="w-4 h-4 text-amber-400" />}
            </div>
            <div>
              <div className="text-sm font-bold text-foreground">
                {revision.solid
                  ? "Chapter solid"
                  : revision.passed
                    ? "Revision check passed"
                    : "Revision check not passed"}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {revisionVerdictLine(revision)}
              </div>
              {/* §5.4's two halves. The percentage above blends them; this
                  line is the only place the student is told WHICH half went,
                  and "you fixed the old ones, the new material faded" is a
                  different instruction from "you still miss the same two". */}
              {revisionSplitLine(revision) && (
                <div className="text-[11px] text-muted-foreground mt-1">
                  {revisionSplitLine(revision)}
                </div>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 rounded-xl border border-border/70 bg-surface/60">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                This check
              </div>
              <div
                className={cn(
                  "text-xl font-black tabular-nums",
                  revision.passed ? "text-emerald-400" : "text-amber-400",
                )}
              >
                {Math.round(revision.rate * 100)}%
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                check {revision.stage} of the {revision.stages_to_solid}-step ladder
              </div>
              {(revision.mistake_total > 0 || revision.fresh_total > 0) && (
                <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                  {revision.mistake_correct}/{revision.mistake_total} old ·{" "}
                  {revision.fresh_correct}/{revision.fresh_total} new
                </div>
              )}
            </div>
            <div className="p-3 rounded-xl border border-border/70 bg-surface/60">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                In a row
              </div>
              <div className="text-xl font-black tabular-nums text-foreground">
                {revision.consecutive_passes}
                <span className="text-sm text-muted-foreground">/{revision.stages_to_solid}</span>
              </div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                consecutive passes needed
              </div>
            </div>
          </div>

          {/* A solid chapter still has a date, at the long interval. Missing
              is now genuinely missing, and saying "off the list" for it would
              promise something the engine no longer does. */}
          <p className="text-[11px] text-muted-foreground mt-3">
            {revision.next_revision_at
              ? `Next check on ${new Date(revision.next_revision_at).toLocaleDateString(undefined, {
                  day: "numeric", month: "short",
                })}.`
              : "No next check scheduled for this chapter."}
          </p>
        </GlassCard>
      )}

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

      {/* Performance Summary */}
      <Card className="p-6 mb-6 flex flex-col sm:flex-row items-center gap-6 transition-shadow hover:shadow-md">
        <ScoreRing value={correct} max={total || 1} size={140} label="correct" />
        <div className="grid grid-cols-2 gap-4 flex-1 w-full">
          <div className="flex items-center gap-3">
            <Target className="w-5 h-5 text-accent" />
            <div>
              <div className="text-xs text-muted-foreground">Accuracy</div>
              {/* Over ANSWERED questions; an em dash when none was answered —
                  "0%" would be a verdict the data does not carry. */}
              <div className="font-bold text-lg">{formatSessionAccuracy(accuracy)}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Timer className="w-5 h-5 text-primary" />
            <div>
              <div className="text-xs text-muted-foreground">Time</div>
              <div className="font-bold text-lg">{durationLabel}</div>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Correct</div>
            <div className="font-bold text-lg">{correct}/{total}</div>
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
            <div className="font-bold text-lg">{correct} / {total}</div>
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
                    studentAnswer: selectedText,
                    studentAnswerIndex: selectedIdx,
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
          {total > 0
            ? "The questions from this session are no longer available to review."
            : "No question was answered in this session, so there is nothing to review."}
        </Card>
      )}
    </>
  );
}
