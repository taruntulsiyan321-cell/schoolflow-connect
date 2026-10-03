import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, ArrowRight, Check, Flag, Send, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { QuestionRenderer, type TestQuestionShape } from "@/components/student/QuestionRenderer";
import { StudentErrorState, StudentSessionSkeleton } from "@/components/student/StudentPanelStates";
import { displaySubject } from "@/lib/academicDisplay";
import { toErrorMessage } from "@/lib/presentation";
import { pluralise } from "@/lib/plural";
import { PlanLimitError } from "@/lib/premium";
import {
  MockError, PALETTE_WORDS, fetchMockPaper, formatCountdown, paletteState, remainingMs,
  saveMockAnswer, submitMock,
  type MockPaper, type MockQuestion,
} from "@/lib/mockTest";

/**
 * A CUET mock paper being sat. No app chrome — the sidebar, the bottom nav, the
 * bell and the avatar menu are four ways to leave a timed paper by accident
 * (the same reason TestAttempt renders bare).
 *
 * The mechanics are TestAttempt's, because they were paid for there:
 *
 *   ONE LOAD PER PAPER, guarded by a held promise set BEFORE the first await —
 *     a flag set four awaits later could not stop concurrent loads, and six
 *     loads each ended by replacing the student's answers with the server's
 *     older view (KNOWN_ISSUES 43).
 *   THE STUDENT'S OWN EDITS WIN over a read that resolves after them.
 *   ONE SAVE IN FLIGHT PER QUESTION, sequenced, so a slow earlier save cannot
 *     land after a newer one.
 *   A FAILED SAVE IS VISIBLE and never reverts what they chose.
 *
 * What is different, and it is the point of a mock: the clock is the SERVER'S.
 * The countdown runs to `deadline`, which the server set at start, so closing
 * the tab does not pause anything and the device's clock cannot buy time —
 * every save past the deadline is refused, and submitting past it is recorded
 * as the hour ending the paper rather than the student.
 */
export default function MockAttempt() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();

  const [paper, setPaper] = useState<MockPaper | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "failed">>({});

  const loadRef = useRef<{ id: string; promise: Promise<void> } | null>(null);
  const editedRef = useRef<Set<string>>(new Set());
  const saveSeqRef = useRef<Record<string, number>>({});
  const saveChainRef = useRef<Record<string, Promise<void>>>({});
  const submittedRef = useRef(false);

  /** Time on each question, banked as the student moves off it. */
  const timeSpentRef = useRef<Record<string, number>>({});
  const enteredAtRef = useRef<{ qid: string | null; at: number }>({ qid: null, at: Date.now() });

  const switchClock = (nextQid: string | null) => {
    const { qid, at } = enteredAtRef.current;
    if (qid) timeSpentRef.current[qid] = (timeSpentRef.current[qid] ?? 0) + Math.max(0, Date.now() - at);
    enteredAtRef.current = { qid: nextQid, at: Date.now() };
  };
  const timeFor = (qid: string) => {
    const banked = timeSpentRef.current[qid] ?? 0;
    const live = enteredAtRef.current.qid === qid ? Math.max(0, Date.now() - enteredAtRef.current.at) : 0;
    return banked + live;
  };

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const p = await fetchMockPaper(id);
      if (p.submitted_at) {
        // Already marked — including by the hour running out while the tab was
        // shut. The result is where this goes.
        nav(`/student/mock/${id}/result`, { replace: true });
        return;
      }
      // The student's own edits survive a read that lands after them.
      setPaper((prev) => {
        if (!prev) return p;
        return {
          ...p,
          questions: p.questions.map((q) => {
            const mine = prev.questions.find((x) => x.id === q.id);
            return mine && editedRef.current.has(q.id) ? { ...q, choice: mine.choice, marked: mine.marked } : q;
          }),
        };
      });
    } catch (e) {
      setLoadError(
        e instanceof MockError || e instanceof PlanLimitError
          ? e.message
          : toErrorMessage(e, "Could not open the paper"),
      );
      loadRef.current = null;
    } finally {
      setLoading(false);
    }
  };

  const loadOnce = (paperId: string): Promise<void> => {
    if (loadRef.current?.id === paperId) return loadRef.current.promise;
    const promise = load();
    loadRef.current = { id: paperId, promise };
    return promise;
  };

  useEffect(() => {
    if (!id) return;
    void loadOnce(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (!paper) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [paper]);

  /** Start the clock on the question actually on screen. */
  useEffect(() => {
    const current = paper?.questions[idx];
    if (current && enteredAtRef.current.qid !== current.id) switchClock(current.id);
  }, [paper, idx]);

  const left = paper ? remainingMs(paper.deadline, now) : null;

  const submit = async (auto: boolean) => {
    if (!paper || submittedRef.current) return;
    submittedRef.current = true;
    setSubmitting(true);
    switchClock(null);
    try {
      await submitMock(paper.id);
      nav(`/student/mock/${paper.id}/result`, { replace: true });
    } catch (e) {
      submittedRef.current = false;
      toast.error(e instanceof MockError ? e.message : toErrorMessage(e, "Could not submit the paper"));
      if (auto) setLoadError("The hour is over and this paper could not be submitted. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  /** The hour ending submits the paper. Nobody is making a decision here. */
  useEffect(() => {
    if (!paper || left === null || left > 0 || submittedRef.current) return;
    void submit(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [left, paper]);

  const persist = (q: MockQuestion, next: { choice?: number | null; marked?: boolean }) => {
    if (!paper) return;
    const choice = next.choice === undefined ? q.choice : next.choice;
    const marked = next.marked === undefined ? q.marked : next.marked;
    // Marked BEFORE the save is queued, so a load in flight cannot resolve
    // into the gap and overwrite it.
    editedRef.current.add(q.id);
    setPaper((prev) =>
      prev ? { ...prev, questions: prev.questions.map((x) => (x.id === q.id ? { ...x, choice, marked } : x)) } : prev,
    );
    setSaveState((prev) => ({ ...prev, [q.id]: "saving" }));

    const seq = (saveSeqRef.current[q.id] ?? 0) + 1;
    saveSeqRef.current[q.id] = seq;
    const prevChain = saveChainRef.current[q.id] ?? Promise.resolve();
    saveChainRef.current[q.id] = prevChain.catch(() => {}).then(async () => {
      if (saveSeqRef.current[q.id] !== seq) return;   // a newer edit is already queued
      try {
        await saveMockAnswer({
          attempt: paper.id,
          question: q.id,
          choice,
          marked,
          timeMs: timeFor(q.id),
        });
        if (saveSeqRef.current[q.id] === seq) setSaveState((prev) => ({ ...prev, [q.id]: "saved" }));
      } catch (e) {
        if (saveSeqRef.current[q.id] === seq) setSaveState((prev) => ({ ...prev, [q.id]: "failed" }));
        if (e instanceof MockError && e.refusal === "mock_time_is_up") {
          void submit(true);
          return;
        }
        // The answer is NOT taken back on screen: they chose it, and undoing
        // their click is a second failure on top of the first.
        toast.error(e instanceof MockError ? e.message : toErrorMessage(e, "Could not save your answer"));
      }
    });
  };

  const confirmThenSubmit = () => {
    if (!paper) return;
    const blank = paper.questions.filter((q) => q.choice == null && q.available).length;
    const unsaved = paper.questions.filter((q) => saveState[q.id] === "failed").length;
    const parts: string[] = [];
    if (blank > 0) parts.push(`${pluralise(blank, "question")} unanswered`);
    if (unsaved > 0) parts.push(`${pluralise(unsaved, "answer")} not saved`);
    const message = parts.length
      ? `Submit with ${parts.join(" and ")}? You cannot reopen this paper.`
      : "Submit your paper? You cannot reopen it.";
    if (!window.confirm(message)) return;
    void submit(false);
  };

  const rendererQuestion = useMemo((): TestQuestionShape | null => {
    const q = paper?.questions[idx];
    if (!q || !paper) return null;
    return {
      id: q.id,
      order_index: q.order,
      question_format: "mcq",
      question: q.question ?? "",
      options: q.options,
      marks: paper.marks_correct,
    };
  }, [paper, idx]);

  if (loading) return <StudentSessionSkeleton label="Opening your paper…" />;

  if (loadError) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <StudentErrorState
          title="Could not open the paper"
          message={loadError}
          onRetry={() => {
            loadRef.current = null;
            if (id) void loadOnce(id);
          }}
        />
        <div className="text-center">
          <Button variant="outline" size="sm" asChild>
            <Link to="/student/mocks">Back to Mock Tests</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (!paper || !rendererQuestion) return null;

  const q = paper.questions[idx];
  const answered = paper.questions.filter((x) => x.choice != null).length;
  const show = (next: number) => {
    const target = paper.questions[next];
    if (!target) return;
    switchClock(target.id);
    setIdx(next);
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-3 flex items-center justify-between gap-2">
        {/* The one way out, and it asks first. Answers already saved stay
            saved and the clock keeps running — leaving is not submitting. */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (window.confirm("Leave this paper? The clock keeps running and your saved answers are kept.")) {
              nav("/student/mocks");
            }
          }}
        >
          <ArrowLeft className="h-4 w-4" /> Leave
        </Button>
        <div
          className={`flex items-center gap-2 rounded-lg px-3 py-1 font-mono text-sm ${
            left !== null && left <= 60_000 ? "bg-destructive/10 text-destructive" : "bg-muted"
          }`}
          data-testid="mock-clock"
        >
          <Timer className="h-4 w-4" /> {formatCountdown(left ?? 0)}
        </div>
      </div>

      <div className="mb-3">
        <div className="mb-1 text-xs text-muted-foreground">
          {displaySubject(paper.subject) || paper.subject} · {paper.total} questions · {paper.max_score} marks
        </div>
        <div className="flex flex-wrap gap-1" data-testid="mock-palette">
          {paper.questions.map((qq, i) => {
            const state = paletteState(qq);
            const unsaved = saveState[qq.id] === "failed";
            return (
              <button
                key={qq.id}
                type="button"
                onClick={() => show(i)}
                data-state={state}
                title={unsaved ? `Question ${i + 1} — not saved` : undefined}
                aria-label={`Question ${i + 1}, ${PALETTE_WORDS[state]}`}
                className={`relative h-7 w-7 rounded-md border text-xs font-medium ${
                  i === idx
                    ? "border-primary bg-primary text-primary-foreground"
                    : unsaved
                      ? "border-destructive/40 bg-destructive/10 text-destructive"
                      : state === "unavailable"
                        ? "border-border bg-muted text-muted-foreground line-through"
                        : state === "answered_marked" || state === "marked"
                          ? "border-warning/40 bg-warning/15 text-warning"
                          : state === "answered"
                            ? "border-accent/30 bg-accent/15 text-accent"
                            : "bg-background"
                }`}
              >
                {i + 1}
                {unsaved && (
                  <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-destructive" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Card className="mb-4 p-5">
        {/* Wraps on a narrow phone: the two ran together as "Question 1 of 50Accounting…". */}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span>Question {idx + 1} of {paper.total}</span>
          <span>{q.chapter ?? ""}</span>
        </div>

        {q.available ? (
          <QuestionRenderer
            question={rendererQuestion}
            mode="attempt"
            value={q.choice == null ? {} : { indexes: [q.choice] }}
            onChange={(r) => persist(q, { choice: r.indexes?.[0] ?? null })}
          />
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="mock-question-withdrawn">
            This question has been withdrawn from the bank. It carries no marks either way.
          </p>
        )}

        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => persist(q, { marked: !q.marked })}
            className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-semibold ${
              q.marked ? "border-warning/40 bg-warning/15 text-warning" : "border-border text-muted-foreground"
            }`}
          >
            <Flag className="h-3.5 w-3.5" /> {q.marked ? "Marked for review" : "Mark for review"}
          </button>
          {q.choice != null && (
            <button
              type="button"
              onClick={() => persist(q, { choice: null })}
              className="text-xs font-semibold text-muted-foreground underline"
            >
              Clear answer
            </button>
          )}
        </div>

        {saveState[q.id] === "saving" && <div className="mt-3 text-[11px] text-muted-foreground">Saving…</div>}
        {saveState[q.id] === "saved" && (
          <div className="mt-3 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Check className="h-3 w-3" /> Saved
          </div>
        )}
        {saveState[q.id] === "failed" && (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-destructive">
            <span>Not saved.</span>
            <button type="button" className="font-semibold underline" onClick={() => persist(q, {})}>
              Try again
            </button>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" disabled={idx === 0} onClick={() => show(idx - 1)}>
          <ArrowLeft className="h-4 w-4" /> Prev
        </Button>
        <div className="text-xs text-muted-foreground">{answered}/{paper.total} answered</div>
        {idx < paper.questions.length - 1 ? (
          <Button onClick={() => show(idx + 1)}>
            Next <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <Button onClick={confirmThenSubmit} disabled={submitting}>
            <Send className="h-4 w-4" /> {submitting ? "Submitting…" : "Submit"}
          </Button>
        )}
      </div>

      {idx < paper.questions.length - 1 && (
        <div className="mt-3 text-center">
          <Button variant="ghost" size="sm" onClick={confirmThenSubmit} disabled={submitting}>
            {submitting ? "Submitting…" : "Submit the paper"}
          </Button>
        </div>
      )}
    </div>
  );
}
