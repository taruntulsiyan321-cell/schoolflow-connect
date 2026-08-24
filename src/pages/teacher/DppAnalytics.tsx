import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Trophy, Users, Target, Timer } from "lucide-react";
import "./teacher-premium.css";

export default function DppAnalytics() {
  const { id } = useParams<{ id: string }>();
  const [dpp, setDpp] = useState<any>(null);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<any[]>([]);
  const [classmates, setClassmates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      setError(null);
      const { data: d, error: dErr } = await supabase.from("dpps").select("*").eq("id", id).maybeSingle();
      if (dErr) {
        setError(dErr.message);
        setDpp(null);
        setQuestions([]);
        setAttempts([]);
        setAnswers([]);
        setClassmates([]);
        setLoading(false);
        return;
      }
      if (!d) {
        setError("This DPP was not found or you don't have access to it.");
        setDpp(null);
        setQuestions([]);
        setAttempts([]);
        setAnswers([]);
        setClassmates([]);
        setLoading(false);
        return;
      }
      setDpp(d);
      const { data: qs, error: qsErr } = await supabase.from("dpp_questions").select("id, order_index, question, marks").eq("dpp_id", id).order("order_index");
      if (qsErr) setError(qsErr.message);
      setQuestions(qs ?? []);
      const { data: att, error: attErr } = await supabase.from("dpp_attempts").select("*, students(full_name, roll_number)").eq("dpp_id", id);
      if (attErr) setError(attErr.message);
      setAttempts(att ?? []);
      const ids = (att ?? []).map(a => a.id);
      if (ids.length) {
        const { data: ans, error: ansErr } = await supabase.from("dpp_answers").select("*").in("attempt_id", ids);
        if (ansErr) setError(ansErr.message);
        setAnswers(ans ?? []);
      } else {
        setAnswers([]);
      }
      if (d.class_id) {
        const { data: cm, error: cmErr } = await supabase.from("students").select("id").eq("class_id", d.class_id);
        if (cmErr) setError(cmErr.message);
        setClassmates(cm ?? []);
      } else {
        setClassmates([]);
      }
      setLoading(false);
    })();
  }, [id]);

  const submitted = attempts.filter(a => a.status === "submitted");
  const avg = submitted.length ? submitted.reduce((s, a) => s + Number(a.score), 0) / submitted.length : 0;
  const avgTime = submitted.length ? submitted.reduce((s, a) => s + a.time_spent_sec, 0) / submitted.length : 0;
  const participation = classmates.length ? Math.round((submitted.length / classmates.length) * 100) : 0;

  const toppers = useMemo(() =>
    [...submitted].sort((a, b) => Number(b.score) - Number(a.score)).slice(0, 5),
  [submitted]);

  const qStats = useMemo(() => questions.map(q => {
    const a = answers.filter(x => x.question_id === q.id);
    const correct = a.filter(x => x.is_correct).length;
    return { ...q, attempted: a.length, correct, accuracy: a.length ? Math.round((correct / a.length) * 100) : 0 };
  }), [questions, answers]);

  const hardest = [...qStats].sort((a, b) => a.accuracy - b.accuracy).slice(0, 3);

  if (loading) {
    return <p className="text-muted-foreground">Loading DPP analytics…</p>;
  }

  if (error) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to="/teacher/classes"><ArrowLeft className="w-4 h-4" /> All tests</Link>
        </Button>
        <Card className="tp-card p-6">
          <p className="text-sm text-destructive font-medium">Unable to load analytics.</p>
          <p className="text-sm text-muted-foreground mt-1">{error}</p>
        </Card>
      </div>
    );
  }

  if (!dpp) {
    return (
      <div className="space-y-3">
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to="/teacher/classes"><ArrowLeft className="w-4 h-4" /> All tests</Link>
        </Button>
        <Card className="tp-card p-6">
          <p className="text-sm text-muted-foreground">This DPP is not available.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="teacher-premium tp-shell space-y-5">
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/teacher/classes"><ArrowLeft className="w-4 h-4" /> All tests</Link></Button>
      <section className="tp-hero">
        <div className="relative z-10 grid lg:grid-cols-[1.1fr_0.9fr] gap-5">
          <div>
            <div className="tp-kicker mb-4">Practice Intelligence</div>
            <h1 className="tp-display text-3xl sm:text-4xl">Analytics · {dpp.title}</h1>
            <p className="text-sm text-foreground/75 mt-2">{dpp.subject} · {dpp.question_count} questions · DPP mastery snapshot</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white/12 border border-border p-3 text-center">
              <p className="text-2xl font-bold">{participation}%</p>
              <p className="text-[10px] uppercase tracking-wider text-foreground/60">Participation</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-border p-3 text-center">
              <p className="text-2xl font-bold">{avg.toFixed(0)}</p>
              <p className="text-[10px] uppercase tracking-wider text-foreground/60">Avg score</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-border p-3 text-center">
              <p className="text-2xl font-bold">{hardest.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-foreground/60">Hard flags</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <DppMetric icon={<Users className="w-5 h-5" />} label="Participation" value={`${participation}%`} sub={`${submitted.length}/${classmates.length || 0} submitted`} />
        <DppMetric icon={<Trophy className="w-5 h-5" />} label="Avg score" value={avg.toFixed(1)} sub="class score mean" />
        <DppMetric icon={<Target className="w-5 h-5" />} label="Submitted" value={submitted.length} sub="completed attempts" />
        <DppMetric icon={<Timer className="w-5 h-5" />} label="Avg time" value={`${Math.round(avgTime / 60)}m`} sub="per submission" />
      </div>

      <Card className="tp-card tp-gold-card p-5">
        <h3 className="tp-display text-xl mb-3">Toppers</h3>
        {toppers.length === 0 ? <p className="text-sm text-muted-foreground">No submissions yet.</p> : (
          <div className="space-y-2">
            {toppers.map((t, i) => (
              <div key={t.id} className="tp-row flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-bold">{i + 1}</span>
                  <span className="text-sm font-medium">{t.students?.full_name ?? "Student"}</span>
                  {t.students?.roll_number && <span className="text-xs text-muted-foreground">Roll {t.students.roll_number}</span>}
                </div>
                <div className="text-sm font-semibold">{Number(t.score).toFixed(1)} / {Number(t.max_score).toFixed(0)}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="tp-card p-5">
        <h3 className="tp-display text-xl mb-3">Question-wise accuracy</h3>
        <div className="space-y-3">
          {qStats.map((q, i) => (
            <div key={q.id}>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="truncate flex-1">Q{i + 1}. {q.question}</span>
                <span className="text-xs text-muted-foreground ml-2">{q.correct}/{q.attempted}</span>
              </div>
              <Progress value={q.accuracy} className="h-2" />
            </div>
          ))}
          {qStats.length === 0 && <p className="text-sm text-muted-foreground">No questions.</p>}
        </div>
      </Card>

      <Card className="tp-card p-5">
        <h3 className="tp-display text-xl mb-3">Hardest questions</h3>
        {hardest.length === 0 ? <p className="text-sm text-muted-foreground">No data yet.</p> : (
          <div className="space-y-2">
            {hardest.map(q => (
              <div key={q.id} className="tp-row text-sm flex items-center justify-between">
                <span className="truncate flex-1">{q.question}</span>
                <span className="text-xs text-destructive font-semibold ml-2">{q.accuracy}%</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="tp-card p-5">
        <h3 className="tp-display text-xl mb-3">All submissions</h3>
        <div className="space-y-1">
          {attempts.map(a => (
            <div key={a.id} className="tp-row flex items-center justify-between text-sm mb-2">
              <span>{a.students?.full_name ?? "Student"}</span>
              <span className="text-xs text-muted-foreground">
                {a.status === "submitted"
                  ? `${Number(a.score).toFixed(1)} / ${Number(a.max_score).toFixed(0)} · ${Math.round(a.time_spent_sec / 60)}m`
                  : "In progress"}
              </span>
            </div>
          ))}
          {attempts.length === 0 && <p className="text-sm text-muted-foreground">No attempts yet.</p>}
        </div>
      </Card>
    </div>
  );
}

function DppMetric({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub: string }) {
  return (
    <Card className="tp-metric">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="tp-label">{label}</p>
          <p className="text-2xl font-bold mt-2">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        </div>
        <div className="tp-icon">{icon}</div>
      </div>
    </Card>
  );
}
