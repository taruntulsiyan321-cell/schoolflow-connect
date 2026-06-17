import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Send, Timer } from "lucide-react";
import { QuestionRenderer, DppQuestion, Response } from "@/components/dpp/QuestionRenderer";
import { toast } from "sonner";
import { StudentSessionSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";

export default function DppAttempt() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const nav = useNavigate();
  const [dpp, setDpp] = useState<any>(null);
  const [questions, setQuestions] = useState<DppQuestion[]>([]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [responses, setResponses] = useState<Record<string, Response>>({});
  const [idx, setIdx] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const startRef = useRef<number>(Date.now());

  const [loadError, setLoadError] = useState<string | null>(null);

  const load = async () => {
    if (!id || !user) return;
    setLoading(true);
    setLoadError(null);
    const { data: d, error: dErr } = await supabase.from("dpps").select("*").eq("id", id).maybeSingle();
    if (dErr) {
      setLoadError(dErr.message);
      setLoading(false);
      return;
    }
    if (!d) {
      setLoadError("DPP not found");
      setLoading(false);
      return;
    }
    setDpp(d);
    const { data: qs, error: qErr } = await supabase.from("dpp_questions").select("id, order_index, kind, question, options, marks").eq("dpp_id", id).order("order_index");
    if (qErr) {
      setLoadError(qErr.message);
      setLoading(false);
      return;
    }
    setQuestions((qs ?? []) as DppQuestion[]);

    const { data: aid, error } = await supabase.rpc("rpc_dpp_start", { _dpp_id: id });
    if (error) {
      setLoadError(error.message);
      setLoading(false);
      return;
    }
    setAttemptId(aid as string);
    startRef.current = Date.now();

    const { data: existing } = await supabase.from("dpp_answers").select("*").eq("attempt_id", aid as string);
    const m: Record<string, Response> = {};
    (existing ?? []).forEach((a) => { m[a.question_id] = (a.response as Response) ?? {}; });
    setResponses(m);
    setLoading(false);
  };

  useEffect(() => { load(); }, [id, user]);

  const timedDpp = (dpp?.duration_sec ?? 0) > 0;
  const remaining = useMemo(
    () => (timedDpp ? Math.max(0, dpp.duration_sec - seconds) : null),
    [dpp, seconds, timedDpp],
  );

  useEffect(() => {
    if (!dpp || !timedDpp) return;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [dpp, timedDpp]);

  useEffect(() => {
    if (!timedDpp || remaining === null || !dpp || !attemptId || submitting) return;
    if (remaining === 0) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, dpp, attemptId, timedDpp]);

  const persist = async (qid: string, r: Response) => {
    if (!attemptId) return;
    setResponses((prev) => ({ ...prev, [qid]: r }));
    await supabase.from("dpp_answers").upsert({
      attempt_id: attemptId, question_id: qid, response: r as any,
    }, { onConflict: "attempt_id,question_id" });
  };

  const submit = async () => {
    if (!attemptId || submitting) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("rpc_dpp_submit", { _attempt_id: attemptId });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    nav(`/student/dpp/${id}/result`);
  };

  if (loading) return <StudentSessionSkeleton label="Loading DPP…" />;

  if (loadError) {
    return (
      <div className="max-w-md mx-auto space-y-4">
        <StudentErrorState title="Could not start DPP" message={loadError} onRetry={load} />
        <div className="text-center">
          <Button variant="outline" size="sm" asChild><Link to="/student">Back to Dashboard</Link></Button>
        </div>
      </div>
    );
  }

  if (questions.length === 0) {
    return (
      <Card className="p-8 text-center max-w-md mx-auto">
        <p className="text-muted-foreground">No questions in this DPP yet.</p>
        <Button variant="outline" className="mt-4" asChild><Link to="/student">Back to Dashboard</Link></Button>
      </Card>
    );
  }

  const q = questions[idx];
  const answeredCount = Object.values(responses).filter((r) => r && Object.keys(r).length > 0).length;
  const mins = timedDpp && remaining !== null ? Math.floor(remaining / 60).toString().padStart(2, "0") : null;
  const secs = timedDpp && remaining !== null ? (remaining % 60).toString().padStart(2, "0") : null;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <Button variant="ghost" size="sm" asChild><Link to="/student"><ArrowLeft className="w-4 h-4" /> Dashboard</Link></Button>
        {timedDpp && mins !== null && secs !== null && (
          <div className="flex items-center gap-2 text-sm font-mono px-3 py-1 rounded-lg bg-muted">
            <Timer className="w-4 h-4" /> {mins}:{secs}
          </div>
        )}
      </div>

      <div className="mb-3">
        <div className="text-xs text-muted-foreground mb-1">{dpp.title}</div>
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
        {idx < questions.length - 1 ? (
          <Button onClick={() => setIdx((i) => i + 1)}>Next <ArrowRight className="w-4 h-4" /></Button>
        ) : (
          <Button onClick={submit} disabled={submitting}><Send className="w-4 h-4" /> {submitting ? "Submitting…" : "Submit"}</Button>
        )}
      </div>
    </div>
  );
}
