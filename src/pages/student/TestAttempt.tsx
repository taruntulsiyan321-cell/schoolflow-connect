import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, TestService, resolveStudentServiceContext } from "@/academic";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Send, Timer, Check } from "lucide-react";
import { QuestionRenderer, TestQuestionShape, Response } from "@/components/student/QuestionRenderer";
import { toast } from "sonner";
import { StudentSessionSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { displaySubject } from "@/lib/academicPresentation";
import { toErrorMessage } from "@/lib/presentation";
import { pluralise } from "@/lib/plural";


/**
 * A test carries no subject column: it anchors on section_subject (§10.22), so
 * its subject is the one that section teaches. testService.get() resolves the
 * join and the row arrives shaped as section_subjects.curriculum_subjects.name.
 */
function testSubject(row: Record<string, unknown> | null): string {
  const ss = row?.section_subjects as { curriculum_subjects?: { name?: string } } | undefined;
  return ss?.curriculum_subjects?.name ?? "";
}

export default function TestAttempt() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const nav = useNavigate();
  const { ctx, ready: academicReady } = useAcademicContext();
  const [test, setTest] = useState<Record<string, unknown> | null>(null);
  const [questions, setQuestions] = useState<TestQuestionShape[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, Response>>({});
  const [idx, setIdx] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const startRef = useRef<number>(Date.now());
  /** The load for a given test id — in flight or already settled.
   *
   *  This replaces a `startedForIdRef` that was CHECKED on entry to load() but
   *  only SET four awaits later, so it could not stop concurrent runs: this
   *  effect's deps are [id, user, ctx, academicReady], and user/ctx/academicReady
   *  all settle at slightly different moments during mount. Every re-run that
   *  arrived before the first load reached its assignment passed the check and
   *  started its own load. Measured 2026-09-10: SIX rpc_test_start calls for one
   *  mount, and each of those loads ended by calling setResponses() with the
   *  server's view — wiping any answer the student had clicked in between.
   *
   *  Holding the promise instead of a flag makes the guard atomic: it is set
   *  BEFORE the first await, so a second caller gets the first call's promise
   *  rather than starting a second load. Cleared on failure so a later dep
   *  change can still retry, which is what the deps were there for. */
  const loadRef = useRef<{ id: string; promise: Promise<void> } | null>(null);

  /** Questions the student has answered in this session. A load that resolves
   *  after an edit must not replace that edit with the server's older view —
   *  the save is a round trip, and the click is not. */
  const locallyEditedRef = useRef<Set<string>>(new Set());

  const [loadError, setLoadError] = useState<string | null>(null);
  /**
   * Per question: has the server got this answer yet?
   *
   * Answering is instant and saving is a round trip. Without this the screen
   * says nothing about the difference, which is how a failed save looked
   * exactly like a successful one — the student sees their choice highlighted
   * either way and finds out at marking time.
   *
   * "saved" is not tracked as a separate colour for long: it is the normal
   * state and does not need announcing. "saving" and "failed" do.
   */
  const [saveState, setSaveState] = useState<Record<string, "saving" | "saved" | "failed">>({});

  /**
   * How long this student has spent on each question, in milliseconds.
   *
   * `test_answers.time_ms` is the only source for §10.25's "average time per
   * question", which the teacher's report has always displayed and which was
   * structurally NULL for every test ever taken in this product: the column
   * existed and nothing ever wrote it. The screen that knows the answer is this
   * one, so it is measured here — accumulated per question, so flipping back
   * and forth adds up rather than overwriting.
   *
   * Refs, not state: a re-render per tick would re-run the whole paper's
   * render for a number nothing displays.
   */
  const timeSpentRef = useRef<Record<string, number>>({});
  const enteredAtRef = useRef<{ qid: string | null; at: number }>({ qid: null, at: Date.now() });

  /** Bank the time spent on the question being left, and start the next one. */
  const switchQuestionClock = (nextQid: string | null) => {
    const { qid, at } = enteredAtRef.current;
    if (qid) {
      const spent = Math.max(0, Date.now() - at);
      timeSpentRef.current[qid] = (timeSpentRef.current[qid] ?? 0) + spent;
    }
    enteredAtRef.current = { qid: nextQid, at: Date.now() };
  };

  /** The time to report for a question, including the stretch in progress. */
  const timeFor = (qid: string): number => {
    const banked = timeSpentRef.current[qid] ?? 0;
    const live = enteredAtRef.current.qid === qid ? Math.max(0, Date.now() - enteredAtRef.current.at) : 0;
    return banked + live;
  };

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
      const d = await TestService.get(serviceCtx, id);
      if (!d) {
        setLoadError("Test not found");
        setLoading(false);
        return;
      }
      setTest(d as Record<string, unknown>);
      const qs = await TestService.listQuestions(serviceCtx, id);
      setQuestions((qs ?? []) as TestQuestionShape[]);

      const existingAttempt = await TestService.getMyAttempt(serviceCtx, id);
      if (
        existingAttempt &&
        (String(existingAttempt.status ?? "") === "submitted" || existingAttempt.submitted_at != null)
      ) {
        nav(`/student/test/${id}/result`, { replace: true });
        return;
      }

      const aid = await TestService.startAttempt(serviceCtx, id);
      setAttemptId(aid as string);

      // Prefer server started_at for timed tests (survives reload)
      let startedMs = Date.now();
      try {
        const att = await TestService.getMyAttempt(serviceCtx, id);
        const startedAt = att?.started_at ? String(att.started_at) : null;
        if (startedAt) {
          const parsed = Date.parse(startedAt);
          if (!Number.isNaN(parsed)) startedMs = parsed;
        }
      } catch {
        /* keep Date.now() */
      }
      startRef.current = startedMs;
      setSeconds(Math.max(0, Math.floor((Date.now() - startedMs) / 1000)));

      const existing = await TestService.listAnswers(serviceCtx, aid as string);
      const m: Record<string, Response> = {};
      (existing ?? []).forEach((a) => {
        m[a.question_id as string] = ((a.response as Response) ?? {}) as Response;
      });
      // The student's own edits win over this read. Answering is instant and
      // saving is a round trip, so a load that started before a click can
      // easily resolve after it — and a plain setResponses(m) would then throw
      // the click away, which is exactly what KNOWN_ISSUES 43 was.
      setResponses((prev) => {
        const merged: Record<string, Response> = { ...m };
        locallyEditedRef.current.forEach((qid) => {
          if (prev[qid]) merged[qid] = prev[qid];
        });
        return merged;
      });
    } catch (e) {
      setLoadError(toErrorMessage(e, "Could not start test"));
      // Let a later dep change (or the Retry button) try again.
      loadRef.current = null;
    } finally {
      setLoading(false);
    }
  };

  /** One load per test id, guarded before the first await. */
  const loadOnce = (testId: string): Promise<void> => {
    if (loadRef.current?.id === testId) return loadRef.current.promise;
    const promise = load();
    loadRef.current = { id: testId, promise };
    return promise;
  };

  const retryLoad = () => {
    loadRef.current = null;
    if (id && user) void loadOnce(id);
  };

  useEffect(() => {
    if (!id || !user) return;
    void loadOnce(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user, ctx, academicReady]);

  /**
   * Start the clock on the question actually on screen, once the paper is
   * loaded. Without this the first question is the one question with no
   * timing — the clock would only start on the first navigation.
   */
  useEffect(() => {
    const current = questions[idx];
    if (!current) return;
    if (enteredAtRef.current.qid !== current.id) {
      switchQuestionClock(current.id);
    }
  }, [questions, idx]);

  const timedTest = ((test?.duration_sec as number | undefined) ?? 0) > 0;
  const remaining = useMemo(
    () => (timedTest ? Math.max(0, (test!.duration_sec as number) - seconds) : null),
    [test, seconds, timedTest],
  );

  useEffect(() => {
    if (!test || !timedTest) return;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [test, timedTest]);

  useEffect(() => {
    if (!timedTest || remaining === null || !test || !attemptId || submitting) return;
    if (remaining === 0) void submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, test, attemptId, timedTest]);

  /** Per-question save sequencing: the counter marks which edit is "latest" for
   *  that question, and the chain ensures saves for the same question run one
   *  at a time (never overlapping in flight) so a slower-resolving earlier
   *  save can't land in the DB after — and overwrite — a newer one. */
  const saveSeqRef = useRef<Record<string, number>>({});
  const saveChainRef = useRef<Record<string, Promise<void>>>({});

  const persist = (qid: string, r: Response) => {
    if (!attemptId) return;
    // Marked BEFORE the save is queued, so a load already in flight cannot
    // resolve into the gap and overwrite this answer.
    locallyEditedRef.current.add(qid);
    // The choice shows as chosen immediately — the round trip is reported
    // separately and never delays or reverts what the student clicked.
    setResponses((prev) => ({ ...prev, [qid]: r }));
    setSaveState((prev) => ({ ...prev, [qid]: "saving" }));
    const seq = (saveSeqRef.current[qid] ?? 0) + 1;
    saveSeqRef.current[qid] = seq;
    const prevChain = saveChainRef.current[qid] ?? Promise.resolve();
    const chained = prevChain.catch(() => {}).then(async () => {
      // A newer edit to this question has already been queued — skip this
      // now-stale save so it cannot overwrite the later answer in the DB.
      if (saveSeqRef.current[qid] !== seq) return;
      try {
        const serviceCtx = await resolveCtx();
        if (saveSeqRef.current[qid] !== seq) return;
        await TestService.saveAnswer(serviceCtx, {
          attemptId,
          questionId: qid,
          response: r as Record<string, unknown>,
          timeMs: timeFor(qid),
        });
        if (saveSeqRef.current[qid] === seq) {
          setSaveState((prev) => ({ ...prev, [qid]: "saved" }));
        }
      } catch (e) {
        // Stays visibly unsaved. The answer is NOT reverted — the student
        // chose it, and taking it back on screen would be a second failure
        // on top of the first.
        if (saveSeqRef.current[qid] === seq) {
          setSaveState((prev) => ({ ...prev, [qid]: "failed" }));
        }
        toast.error(toErrorMessage(e, "Could not save answer — it is marked unsaved"));
      }
    });
    saveChainRef.current[qid] = chained;
  };

  /**
   * Submit confirms once, naming what is unanswered — "Submit with 3
   * unanswered?" — because that is the fact the student needs and the paper
   * cannot be reopened. `auto` skips it: the timer running out is not a
   * decision anyone is making.
   */
  const confirmThenSubmit = () => {
    const blank = questions.filter(
      (qq) => !responses[qq.id] || Object.keys(responses[qq.id]).length === 0,
    ).length;
    const unsaved = questions.filter((qq) => saveState[qq.id] === "failed").length;
    const parts: string[] = [];
    if (blank > 0) parts.push(`${pluralise(blank, "question")} unanswered`);
    if (unsaved > 0) parts.push(`${pluralise(unsaved, "answer")} not saved`);
    const message = parts.length
      ? `Submit with ${parts.join(" and ")}? You cannot reopen this paper.`
      : "Submit your paper? You cannot reopen it.";
    if (!window.confirm(message)) return;
    void submit();
  };

  const submit = async () => {
    if (!attemptId || submitting) return;
    setSubmitting(true);
    // Bank the time on the question they are looking at, so the last one
    // counted is not the only one with no timing.
    switchQuestionClock(null);
    try {
      const serviceCtx = await resolveCtx();
      // Hand over what THIS SCREEN is holding as well as relying on the
      // incremental saves. It matters for exactly one case, and it is the case
      // that loses marks: an answer whose own save failed (shown as "Not
      // saved") still reaches the marking, because rpc_test_submit upserts
      // what it is given before grading.
      const payload = questions
        .map((qq) => ({
          question_id: qq.id,
          response: responses[qq.id] ?? null,
          time_ms: Math.round(timeSpentRef.current[qq.id] ?? 0),
        }))
        .filter((a) => a.response && Object.keys(a.response).length > 0);
      await TestService.submitAttempt(serviceCtx, attemptId, payload);
      nav(`/student/test/${id}/result`);
    } catch (e) {
      toast.error(toErrorMessage(e, "Could not submit test"));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <StudentSessionSkeleton label="Loading Test…" />;

  if (loadError) {
    return (
      <div className="max-w-md mx-auto space-y-4">
        <StudentErrorState title="Could not start Test" message={loadError} onRetry={retryLoad} />
        <div className="text-center">
          <Button variant="outline" size="sm" asChild><Link to="/student/tests">Back to Tests</Link></Button>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <Card className="p-8 text-center max-w-md mx-auto">
        <p className="text-muted-foreground">No questions in this test yet.</p>
        <Button variant="outline" className="mt-4" asChild><Link to="/student/tests">Back to Tests</Link></Button>
      </Card>
    );
  }

  const q = questions[idx];
  const answeredCount = Object.values(responses).filter((r) => r && Object.keys(r).length > 0).length;

  /** Move the per-question clock whenever the visible question changes. */
  const showQuestion = (next: number) => {
    const target = questions[next];
    if (!target) return;
    switchQuestionClock(target.id);
    setIdx(next);
  };
  const mins = timedTest && remaining !== null ? Math.floor(remaining / 60).toString().padStart(2, "0") : null;
  const secs = timedTest && remaining !== null ? (remaining % 60).toString().padStart(2, "0") : null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        {/*
          The one way out of a paper in progress, and it asks first. The screen
          renders without the sidebar, bottom nav, bell or avatar precisely so a
          student cannot leave by accident — but leaving with NO exit at all is
          the other failure: a student who opened the wrong test would be stuck
          with a started attempt and no way back.

          Answers already saved stay saved; this leaves the attempt open, it
          does not submit it.
        */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (window.confirm("Leave this test? Your saved answers are kept and the paper stays open.")) {
              nav("/student/tests");
            }
          }}
        >
          <ArrowLeft className="w-4 h-4" /> Leave
        </Button>
        {timedTest && mins !== null && secs !== null && (
          <div className="flex items-center gap-2 text-sm font-mono px-3 py-1 rounded-lg bg-muted">
            <Timer className="w-4 h-4" /> {mins}:{secs}
          </div>
        )}
      </div>

      <div className="mb-3">
        <div className="text-xs text-muted-foreground mb-1">
          {String(test?.title ?? "Test")}
          {testSubject(test) ? ` · ${displaySubject(testSubject(test))}` : ""}
        </div>
        <div className="flex gap-1 flex-wrap">
          {questions.map((qq, i) => {
            const ans = responses[qq.id] && Object.keys(responses[qq.id]).length > 0;
            const unsaved = saveState[qq.id] === "failed";
            return (
              <button key={qq.id} onClick={() => showQuestion(i)}
                title={unsaved ? `Question ${i + 1} — not saved` : undefined}
                // An unanswered question is OUTLINED, never red. Red means
                // wrong, and nothing is wrong until it is marked. The only
                // red here is a failed SAVE, which is a real problem now.
                className={`relative w-7 h-7 rounded-md text-xs font-medium border ${
                  i === idx
                    ? "bg-primary text-primary-foreground border-primary"
                    : unsaved
                      ? "bg-destructive/10 text-destructive border-destructive/40"
                      : ans
                        ? "bg-accent/15 text-accent border-accent/30"
                        : "bg-background"
                }`}>
                {i + 1}
                {unsaved && (
                  <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-destructive" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      <Card className="p-5 mb-4">
        <div className="text-xs text-muted-foreground mb-3">Question {idx + 1} of {questions.length}</div>
        <QuestionRenderer
          question={q}
          mode="attempt"
          value={responses[q.id] ?? {}}
          onChange={(r) => persist(q.id, r)}
        />
        {saveState[q.id] === "saving" && (
          <div className="mt-3 text-[11px] text-muted-foreground">Saving…</div>
        )}
        {saveState[q.id] === "saved" && (
          <div className="mt-3 text-[11px] text-muted-foreground flex items-center gap-1">
            <Check className="w-3 h-3" /> Saved
          </div>
        )}
        {saveState[q.id] === "failed" && (
          <div className="mt-3 flex items-center gap-2 text-[11px] text-destructive">
            <span>Not saved.</span>
            <button
              type="button"
              className="underline font-semibold"
              onClick={() => persist(q.id, responses[q.id] ?? {})}
            >
              Try again
            </button>
          </div>
        )}
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" disabled={idx === 0} onClick={() => showQuestion(idx - 1)}>
          <ArrowLeft className="w-4 h-4" /> Prev
        </Button>
        <div className="text-xs text-muted-foreground">{answeredCount}/{questions.length} answered</div>
        {idx < questions.length - 1 && !(timedTest && remaining === 0) ? (
          <Button onClick={() => showQuestion(idx + 1)}>Next <ArrowRight className="w-4 h-4" /></Button>
        ) : (
          <Button onClick={confirmThenSubmit} disabled={submitting}><Send className="w-4 h-4" /> {submitting ? "Submitting…" : "Submit"}</Button>
        )}
      </div>
    </div>
  );
}
