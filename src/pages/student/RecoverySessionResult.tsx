import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Target, Timer, Wrench, X } from "lucide-react";
import { ScoreRing } from "@/components/dpp/ScoreRing";
import { PageHeader } from "@/components/ui-bits";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { ConceptRecoveryReport } from "@/components/student/ConceptRecoveryReport";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { MathText } from "@/components/MathText";
import { cn } from "@/lib/utils";
import {
  buildRecoveryAssignmentReport,
  mergeRecoveryAttemptRows,
  readRecoveryResultState,
  recoverySnapshotsToAttemptRows,
  type RecoverySessionResultState,
} from "@/lib/recoverySessionSnapshot";

type AttemptRow = {
  id: string;
  generated_question: { question?: string; options?: string[] };
  correct_answer: { index?: number; text?: string };
  selected_answer: { index?: number; text?: string } | null;
  is_correct: boolean | null;
  explanation?: string;
  created_at: string;
};

type AssignmentRow = {
  id: string;
  subject: string;
  chapter?: string;
  concept: string;
  severity?: string;
  question_count: number;
  questions_correct?: number;
  completed_at?: string;
  created_at?: string;
};

export default function RecoverySessionResult() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { user } = useAuth();

  const localState = useMemo(() => {
    const fromNav = location.state as RecoverySessionResultState | null;
    if (fromNav?.attempts?.length) return fromNav;
    if (id) return readRecoveryResultState(id);
    return null;
  }, [location.state, id]);

  const [assignment, setAssignment] = useState<AssignmentRow | null>(null);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const localAttempts = useMemo(
    () => (localState ? recoverySnapshotsToAttemptRows(localState.attempts) : []),
    [localState],
  );

  const displayAttempts = useMemo(
    () => mergeRecoveryAttemptRows(attempts, localAttempts),
    [attempts, localAttempts],
  );

  const subject = assignment?.subject ?? localState?.subject ?? "Mathematics";
  const chapter = assignment?.chapter ?? localState?.chapter ?? "";
  const concept = assignment?.concept ?? localState?.concept ?? "Recovery";
  const total = Math.max(assignment?.question_count ?? 0, displayAttempts.length);
  const correct =
    displayAttempts.length > 0
      ? displayAttempts.filter((a) => a.is_correct).length
      : (assignment?.questions_correct ?? 0);
  const accuracy = total ? Math.round((correct / total) * 100) : 0;

  const startedAt = localState?.startedAt ?? assignment?.created_at;
  const finishedAt = assignment?.completed_at;
  const finishedMs =
    finishedAt && startedAt
      ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
      : startedAt
        ? Date.now() - new Date(startedAt).getTime()
        : 0;
  const mins = Math.max(1, Math.round(finishedMs / 60000));

  const fallbackReport = useMemo(() => {
    if (!id || displayAttempts.length === 0) return null;
    const snapshots =
      localState?.attempts ??
      displayAttempts.map((a) => ({
        questionId: a.id,
        question: a.generated_question?.question ?? "",
        options: a.generated_question?.options ?? [],
        correctIndex: typeof a.correct_answer?.index === "number" ? a.correct_answer.index : 0,
        selectedIndex: typeof a.selected_answer?.index === "number" ? a.selected_answer.index : 0,
        isCorrect: !!a.is_correct,
        explanation: a.explanation,
      }));
    return buildRecoveryAssignmentReport(id, subject, chapter, concept, snapshots, mins);
  }, [id, subject, chapter, concept, localState, displayAttempts, mins]);

  const hasLocalData = displayAttempts.length > 0;

  useEffect(() => {
    if (!id || !user) {
      if (hasLocalData) setLoading(false);
      return;
    }

    (async () => {
      setLoading(true);
      setLoadError(null);

      const { data, error } = await (supabase as any).rpc("rpc_get_recovery_assignment", {
        _assignment_id: id,
      });

      if (error) {
        if (!hasLocalData) setLoadError(error.message);
        setLoading(false);
        return;
      }

      const a = data?.assignment as AssignmentRow | undefined;
      if (a) setAssignment(a);

      const { data: rows, error: qErr } = await supabase
        .from("recovery_assignment_questions")
        .select("id, question_text, options, correct_answer, explanation, answered, is_correct, student_answer, order_index")
        .eq("assignment_id", id)
        .order("order_index");

      if (qErr && !hasLocalData) {
        setLoadError(qErr.message);
        setLoading(false);
        return;
      }

      if (rows?.length) {
        const mapped: AttemptRow[] = rows
          .filter((q) => q.answered)
          .map((q) => {
            const opts = Array.isArray(q.options) ? (q.options as string[]) : [];
            const correctIdx =
              typeof (q.correct_answer as { correct_index?: number })?.correct_index === "number"
                ? (q.correct_answer as { correct_index: number }).correct_index
                : 0;
            const sel = q.student_answer as { selected_index?: number; text?: string } | null;
            const selectedIdx = typeof sel?.selected_index === "number" ? sel.selected_index : 0;
            return {
              id: q.id,
              generated_question: { question: q.question_text, options: opts },
              correct_answer: { index: correctIdx, text: opts[correctIdx] ?? "" },
              selected_answer: { index: selectedIdx, text: sel?.text ?? opts[selectedIdx] ?? "" },
              is_correct: q.is_correct,
              explanation: q.explanation ?? undefined,
              created_at: new Date().toISOString(),
            };
          });
        if (mapped.length) setAttempts(mapped);
      }

      setLoading(false);
    })();
  }, [id, user, hasLocalData]);

  if (loading && !hasLocalData) return <StudentListSkeleton rows={4} />;

  if (loadError && !hasLocalData) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to="/student/recovery"><ArrowLeft className="w-4 h-4" /> Recovery</Link>
        </Button>
        <StudentErrorState title="Could not load recovery report" message={loadError} onRetry={() => window.location.reload()} />
      </>
    );
  }

  if (!assignment && !localState) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to="/student/recovery"><ArrowLeft className="w-4 h-4" /> Recovery</Link>
        </Button>
        <Card className="p-8 text-center">
          <p className="text-muted-foreground">This recovery session could not be found.</p>
        </Card>
      </>
    );
  }

  return (
    <div className="max-w-3xl mx-auto pb-8">
      <Button variant="ghost" size="sm" asChild className="mb-2">
        <Link to="/student/recovery"><ArrowLeft className="w-4 h-4" /> Recovery Center</Link>
      </Button>

      <PageHeader
        title={`Recovery complete: ${concept}`}
        subtitle={`${subject}${chapter ? ` · ${chapter}` : ""}${assignment?.severity ? ` · ${assignment.severity} priority` : ""}`}
      />

      {id && fallbackReport && (
        <ConceptRecoveryReport
          sourceType="recovery_assignment"
          sourceId={id}
          title="Recovery concept report"
          fallbackReport={fallbackReport}
        />
      )}

      <Card className="p-6 mb-6 flex flex-col sm:flex-row items-center gap-6 shadow-card">
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
            <div className="text-xs text-muted-foreground">Concept</div>
            <div className="font-bold text-lg truncate">{concept}</div>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2 mb-6">
        <Button asChild size="sm">
          <Link to="/student/recovery"><Wrench className="w-3.5 h-3.5 mr-1" /> Recovery Center</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link to="/student/practice/math12">Practice more</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/student/mistakes">Mistake book</Link>
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link to="/student/analytics">View analysis</Link>
        </Button>
      </div>

      {accuracy < 100 && displayAttempts.length > 0 && (
        <Card className="p-4 mb-6 border-primary/20 bg-primary/5">
          <h3 className="font-semibold text-sm mb-2">Improvement focus</h3>
          <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-4">
            {accuracy < 60 && <li>Review wrong answers below — they stay in your Mistake Book until mastered.</li>}
            {accuracy < 80 && <li>Schedule another recovery round for {concept} within 48 hours.</li>}
            <li>Use &quot;Explain my mistake&quot; on each wrong question to fix the concept, not just the answer.</li>
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
            <Card key={a.id} className="p-5 shadow-card">
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
              {a.explanation && (
                <MathText block className="text-sm text-muted-foreground mb-3" text={a.explanation} />
              )}
              <ExplainPanel
                question={questionText}
                options={opts}
                correctIndex={correctIdx}
                selectedIndex={selectedIdx}
                correctText={correctText}
                selectedText={selectedText}
                subject={subject}
                chapter={chapter}
                topic={concept}
                wasCorrect={a.is_correct}
              />
            </Card>
          );
        })}
      </div>

      {displayAttempts.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No question details saved for this recovery session.
        </Card>
      )}
    </div>
  );
}
