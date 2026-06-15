import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Target, Timer, X } from "lucide-react";
import { ScoreRing } from "@/components/dpp/ScoreRing";
import { PageHeader } from "@/components/ui-bits";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { ConceptRecoveryReport } from "@/components/student/ConceptRecoveryReport";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { MathText } from "@/components/MathText";
import { cn } from "@/lib/utils";
import {
  buildPracticeRecoveryReport,
  snapshotsToAttemptRows,
  type PracticeSessionResultState,
} from "@/lib/practiceSessionSnapshot";

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
  generated_question: { question?: string; options?: string[] };
  correct_answer: { index?: number; text?: string };
  selected_answer: { index?: number; text?: string } | null;
  is_correct: boolean | null;
  created_at: string;
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
};

export default function PracticeSessionResult() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { user } = useAuth();

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

  const localAttempts = useMemo(
    () => (localState ? snapshotsToAttemptRows(localState.attempts) : []),
    [localState],
  );

  const displayAttempts = useMemo(
    () => (attempts.length > 0 ? attempts : localAttempts),
    [attempts, localAttempts],
  );

  const subject = session?.subject ?? localState?.subject ?? "Practice";
  const chapter = session?.chapter ?? localState?.chapter ?? "";
  const total = Math.max(session?.question_count ?? 0, displayAttempts.length);
  const correct =
    displayAttempts.length > 0
      ? displayAttempts.filter((a) => a.is_correct).length
      : (session?.correct_count ?? 0);
  const accuracy = total ? Math.round((correct / total) * 100) : 0;
  const finishedMs =
    session?.finished_at && session?.created_at
      ? new Date(session.finished_at).getTime() - new Date(session.created_at).getTime()
      : localState?.startedAt
        ? Date.now() - new Date(localState.startedAt).getTime()
        : 0;
  const mins = Math.max(1, Math.round(finishedMs / 60000));

  const fallbackReport = useMemo(() => {
    if (!id || displayAttempts.length === 0) return null;
    const snapshots =
      localState?.attempts ??
      displayAttempts.map((a) => ({
        question: a.generated_question?.question ?? "",
        options: a.generated_question?.options ?? [],
        correctIndex: typeof a.correct_answer?.index === "number" ? a.correct_answer.index : 0,
        selectedIndex: typeof a.selected_answer?.index === "number" ? a.selected_answer.index : 0,
        isCorrect: !!a.is_correct,
      }));
    return buildPracticeRecoveryReport(id, subject, chapter, snapshots, mins);
  }, [id, subject, chapter, localState, displayAttempts, mins]);

  const retryUrl = `/student/practice/ai/session?subject=${encodeURIComponent(subject)}&chapter=${encodeURIComponent(chapter)}&count=${total || 10}`;

  const hasLocalData = displayAttempts.length > 0;

  useEffect(() => {
    if (!id || !user) {
      if (hasLocalData) setDbLoading(false);
      return;
    }

    (async () => {
      setDbLoading(true);
      setLoadError(null);

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

      if (s) setSession(s as SessionRow);

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
    })();
  }, [id, user, hasLocalData]);

  if (dbLoading && !hasLocalData) return <StudentListSkeleton rows={4} />;

  if (loadError && !hasLocalData) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to="/student/practice/math12"><ArrowLeft className="w-4 h-4" /> Practice</Link>
        </Button>
        <StudentErrorState title="Could not load results" message={loadError} onRetry={() => window.location.reload()} />
      </>
    );
  }

  if (!session && !localState) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to="/student/practice/math12"><ArrowLeft className="w-4 h-4" /> Practice</Link>
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
        <Link to="/student/practice/math12"><ArrowLeft className="w-4 h-4" /> Practice</Link>
      </Button>
      <PageHeader
        title={`${subject} · ${chapter}`}
        subtitle={`Practice session · ${session?.finished_at ? new Date(session.finished_at).toLocaleString() : "Just now"}`}
      />

      {id && fallbackReport && (
        <ConceptRecoveryReport
          sourceType="practice_session"
          sourceId={id}
          title="Practice concept recovery report"
          fallbackReport={fallbackReport}
        />
      )}

      <Card className="p-6 mb-6 flex flex-col sm:flex-row items-center gap-6">
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
            <div className="text-xs text-muted-foreground">Score</div>
            <div className="font-bold text-lg">{Number(session?.score ?? correct).toFixed(1)} / {total || displayAttempts.length}</div>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2 mb-6">
        <Button asChild variant="outline" size="sm">
          <Link to="/student/practice/math12">New chapter</Link>
        </Button>
        <Button asChild size="sm">
          <Link to={retryUrl}>Same chapter again</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/student/mistakes">Mistake book</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/student/recovery">Recovery zone</Link>
        </Button>
      </div>

      {accuracy < 100 && displayAttempts.length > 0 && (
        <Card className="p-4 mb-6 border-primary/20 bg-primary/5">
          <h3 className="font-semibold text-sm mb-2">Improvement focus</h3>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
            {accuracy < 60 && <li>Review wrong answers below — they were added to your Mistake Book automatically.</li>}
            {accuracy < 80 && <li>Revise weak topics from Analysis before your next practice session.</li>}
            <li>Use &quot;Explain my mistake&quot; on each wrong question to understand the concept, not just the answer.</li>
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
            <Card key={a.id} className="p-5">
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
                subject={subject}
                chapter={chapter}
                wasCorrect={a.is_correct}
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
