import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, TestService, resolveStudentServiceContext } from "@/academic";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Send, Timer } from "lucide-react";
import { QuestionRenderer, TestQuestionShape, Response } from "@/components/student/QuestionRenderer";
import { toast } from "sonner";
import { StudentSessionSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { displaySubject } from "@/lib/academicPresentation";
import { toErrorMessage } from "@/lib/presentation";


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
  /** Which test id we've already successfully started an attempt for in this
   *  component's lifetime. This effect's deps include ctx/academicReady so it
   *  can retry once a fallback-context load resolves to the real one — but
   *  rpc_test_start is idempotent (upserts on (test_id, user_id)), so a second
   *  full re-run after the first already succeeded isn't fixing anything; it
   *  only re-flashes the loading skeleton and re-fetches responses, which can
   *  clobber answers the student has changed locally since the first load
   *  finished but before that edit's save round-trip lands. */
  const startedForIdRef = useRef<string | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);

  const resolveCtx = async () => {
    if (ctx && academicReady) return ctx;
    return resolveStudentServiceContext();
  };

  const load = async () => {
    if (!id || !user) return;
    if (startedForIdRef.current === id) return;
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
      startedForIdRef.current = id;

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
      setResponses(m);
    } catch (e) {
      setLoadError(toErrorMessage(e, "Could not start test"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [id, user, ctx, academicReady]);

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
    setResponses((prev) => ({ ...prev, [qid]: r }));
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
        });
      } catch (e) {
        toast.error(toErrorMessage(e, "Could not save answer"));
      }
    });
    saveChainRef.current[qid] = chained;
  };

  const submit = async () => {
    if (!attemptId || submitting) return;
    setSubmitting(true);
    try {
      const serviceCtx = await resolveCtx();
      await TestService.submitAttempt(serviceCtx, attemptId);
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
        <StudentErrorState title="Could not start Test" message={loadError} onRetry={load} />
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
  const mins = timedTest && remaining !== null ? Math.floor(remaining / 60).toString().padStart(2, "0") : null;
  const secs = timedTest && remaining !== null ? (remaining % 60).toString().padStart(2, "0") : null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <Button variant="ghost" size="sm" asChild><Link to="/student/tests"><ArrowLeft className="w-4 h-4" /> Tests</Link></Button>
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
            return (
              <button key={qq.id} onClick={() => setIdx(i)}
                className={`w-7 h-7 rounded-md text-xs font-medium border ${i === idx ? "bg-primary text-primary-foreground border-primary" : ans ? "bg-accent/15 text-accent border-accent/30" : "bg-background"}`}>
                {i + 1}
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
      </Card>

      <div className="flex items-center justify-between gap-2">
        <Button variant="outline" disabled={idx === 0} onClick={() => setIdx((i) => i - 1)}>
          <ArrowLeft className="w-4 h-4" /> Prev
        </Button>
        <div className="text-xs text-muted-foreground">{answeredCount}/{questions.length} answered</div>
        {idx < questions.length - 1 && !(timedTest && remaining === 0) ? (
          <Button onClick={() => setIdx((i) => i + 1)}>Next <ArrowRight className="w-4 h-4" /></Button>
        ) : (
          <Button onClick={() => void submit()} disabled={submitting}><Send className="w-4 h-4" /> {submitting ? "Submitting…" : "Submit"}</Button>
        )}
      </div>
    </div>
  );
}
