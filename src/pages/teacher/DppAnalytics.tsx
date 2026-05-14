import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Trophy, Users, Target, Timer } from "lucide-react";

export default function DppAnalytics() {
  const { id } = useParams<{ id: string }>();
  const [dpp, setDpp] = useState<any>(null);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [questions, setQuestions] = useState<any[]>([]);
  const [answers, setAnswers] = useState<any[]>([]);
  const [classmates, setClassmates] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data: d } = await supabase.from("dpps").select("*").eq("id", id).maybeSingle();
      setDpp(d);
      const { data: qs } = await supabase.from("dpp_questions").select("id, order_index, question, marks").eq("dpp_id", id).order("order_index");
      setQuestions(qs ?? []);
      const { data: att } = await supabase.from("dpp_attempts").select("*, students(full_name, roll_number)").eq("dpp_id", id);
      setAttempts(att ?? []);
      const ids = (att ?? []).map(a => a.id);
      if (ids.length) {
        const { data: ans } = await supabase.from("dpp_answers").select("*").in("attempt_id", ids);
        setAnswers(ans ?? []);
      }
      if (d?.class_id) {
        const { data: cm } = await supabase.from("students").select("id").eq("class_id", d.class_id);
        setClassmates(cm ?? []);
      }
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

  if (!dpp) return <p className="text-muted-foreground">Loading…</p>;

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/teacher/dpp"><ArrowLeft className="w-4 h-4" /> All DPPs</Link></Button>
      <PageHeader title={`Analytics · ${dpp.title}`} subtitle={`${dpp.subject} · ${dpp.question_count} questions`} />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<Users className="w-5 h-5" />} label="Participation" value={`${participation}%`} />
        <StatCard icon={<Trophy className="w-5 h-5" />} label="Avg score" value={avg.toFixed(1)} tone="accent" />
        <StatCard icon={<Target className="w-5 h-5" />} label="Submitted" value={submitted.length} />
        <StatCard icon={<Timer className="w-5 h-5" />} label="Avg time" value={`${Math.round(avgTime / 60)}m`} tone="secondary" />
      </div>

      <Card className="p-5 mb-4">
        <h3 className="font-semibold mb-3">Toppers</h3>
        {toppers.length === 0 ? <p className="text-sm text-muted-foreground">No submissions yet.</p> : (
          <div className="space-y-2">
            {toppers.map((t, i) => (
              <div key={t.id} className="flex items-center justify-between">
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

      <Card className="p-5 mb-4">
        <h3 className="font-semibold mb-3">Question-wise accuracy</h3>
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

      <Card className="p-5 mb-4">
        <h3 className="font-semibold mb-3">Hardest questions</h3>
        {hardest.length === 0 ? <p className="text-sm text-muted-foreground">No data yet.</p> : (
          <div className="space-y-2">
            {hardest.map(q => (
              <div key={q.id} className="text-sm flex items-center justify-between border-b pb-2 last:border-0">
                <span className="truncate flex-1">{q.question}</span>
                <span className="text-xs text-destructive font-semibold ml-2">{q.accuracy}%</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-5">
        <h3 className="font-semibold mb-3">All submissions</h3>
        <div className="space-y-1">
          {attempts.map(a => (
            <div key={a.id} className="flex items-center justify-between py-2 border-b last:border-0 text-sm">
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
    </>
  );
}
