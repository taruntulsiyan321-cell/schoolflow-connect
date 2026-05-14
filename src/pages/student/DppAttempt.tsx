import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, Send, Timer } from "lucide-react";
import { QuestionRenderer, DppQuestion, Response } from "@/components/dpp/QuestionRenderer";
import { toast } from "sonner";

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
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    (async () => {
      if (!id || !user) return;
      const { data: d } = await supabase.from("dpps").select("*").eq("id", id).maybeSingle();
      if (!d) return;
      setDpp(d);
      const { data: qs } = await supabase.from("dpp_questions").select("id, order_index, kind, question, options, marks").eq("dpp_id", id).order("order_index");
      setQuestions((qs ?? []) as any);

      const { data: aid, error } = await supabase.rpc("rpc_dpp_start", { _dpp_id: id });
      if (error) { toast.error(error.message); return; }
      setAttemptId(aid as any);

      const { data: existing } = await supabase.from("dpp_answers").select("*").eq("attempt_id", aid as any);
      const m: Record<string, Response> = {};
      (existing ?? []).forEach(a => m[a.question_id] = (a.response as any) ?? {});
      setResponses(m);
    })();
  }, [id, user]);

  useEffect(() => {
    if (!dpp) return;
    const t = setInterval(() => setSeconds(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, [dpp]);

  const remaining = useMemo(() => Math.max(0, (dpp?.duration_sec ?? 0) - seconds), [dpp, seconds]);
  useEffect(() => {
    if (dpp && remaining === 0 && attemptId && !submitting) submit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remaining, dpp, attemptId]);

  const persist = async (qid: string, r: Response) => {
    if (!attemptId) return;
    setResponses(prev => ({ ...prev, [qid]: r }));
    await supabase.from("dpp_answers").upsert({
      attempt_id: attemptId, question_id: qid, response: r as any,
    }, { onConflict: "attempt_id,question_id" });
  };

  const submit = async () => {
    if (!attemptId) return;
    setSubmitting(true);
    const { error } = await supabase.rpc("rpc_dpp_submit", { _attempt_id: attemptId });
    setSubmitting(false);
    if (error) return toast.error(error.message);
    nav(`/student/dpp/${id}/result`);
  };

  if (!dpp) return <p className="text-muted-foreground p-4">Loading…</p>;
  if (questions.length === 0) return <p className="text-muted-foreground p-4">No questions in this DPP.</p>;

  const q = questions[idx];
  const answeredCount = Object.values(responses).filter(r => r && Object.keys(r).length > 0).length;
  const mins = Math.floor(remaining / 60).toString().padStart(2, "0");
  const secs = (remaining % 60).toString().padStart(2, "0");

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-3">
        <Button variant="ghost" size="sm" asChild><Link to="/student/dpp"><ArrowLeft className="w-4 h-4" /> Back</Link></Button>
        <div className="flex items-center gap-2 text-sm font-mono px-3 py-1 rounded-lg bg-muted">
          <Timer className="w-4 h-4" /> {mins}:{secs}
        </div>
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
        <Button variant="outline" disabled={idx === 0} onClick={() => setIdx(i => i - 1)}>
          <ArrowLeft className="w-4 h-4" /> Prev
        </Button>
        <div className="text-xs text-muted-foreground">{answeredCount}/{questions.length} answered</div>
        {idx < questions.length - 1 ? (
          <Button onClick={() => setIdx(i => i + 1)}>Next <ArrowRight className="w-4 h-4" /></Button>
        ) : (
          <Button onClick={submit} disabled={submitting}><Send className="w-4 h-4" /> {submitting ? "Submitting…" : "Submit"}</Button>
        )}
      </div>
    </div>
  );
}
