import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  ArrowLeft, Users, Trophy, Clock, Target, AlertTriangle, Activity,
  Zap, CheckCircle2, Radio, Flag, BarChart3, Loader2, FileBarChart, Sparkles,
} from "lucide-react";
import { useAcademicContext, BattleExperienceService } from "@/academic";
import { toErrorMessage } from "@/lib/presentation";

type Participant = {
  user_id: string; display_name: string; score: number;
  correct_count: number; answered_count: number; total_time_ms: number;
  rank: number | null; finished: boolean; joined_at: string;
  progress_pct: number; accuracy: number | null; avg_ms: number | null; struggling: boolean;
};
type QuestionStat = {
  order_index: number; question: string; attempts: number; correct: number; accuracy: number | null;
};
type Monitor = {
  battle: {
    id: string; title: string; subject: string; topic: string | null; status: string;
    question_count: number; per_question_sec: number; duration_sec: number; starts_at: string;
  };
  participants: Participant[];
  questions: QuestionStat[];
};

type ReportRow = {
  participant_id: string;
  user_id: string;
  display_name: string;
  expires_at: string;
  expired: boolean;
  summary: { score?: number; rank?: number; accuracy_pct?: number };
  has_ai: boolean;
};

export default function BattleMonitor() {
  const { id } = useParams<{ id: string }>();
  const { ctx, ready: academicReady } = useAcademicContext();
  const [data, setData] = useState<Monitor | null>(null);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [ending, setEnding] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    if (!id || !academicReady || !ctx) return;
    try {
      const res = await BattleExperienceService.getMonitor(ctx, id);
      setData(res as Monitor);
      setError(null);
      setLoading(false);
      try {
        const reps = await BattleExperienceService.listTeacherReports(ctx, id);
        setReports((reps ?? []) as ReportRow[]);
      } catch {
        /* reports optional while monitor is live */
      }
    } catch (e) {
      setError(toErrorMessage(e, "Failed to load monitor"));
      setLoading(false);
    }
  }, [id, academicReady, ctx]);

  // Initial + poll every 3s
  useEffect(() => {
    if (!academicReady || !ctx || !id) return;
    void refresh();
    const poll = setInterval(() => void refresh(), 3000);
    return () => clearInterval(poll);
  }, [refresh, academicReady, ctx, id]);

  // Realtime nudge on participant changes for snappier updates
  useEffect(() => {
    if (!id) return;
    const ch = supabase
      .channel(`monitor-${id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "battle_participants", filter: `battle_id=eq.${id}` },
        refresh)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [id, refresh]);

  // Clock tick for "time remaining"
  useEffect(() => {
    timer.current = setInterval(() => setNow(Date.now()), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, []);

  const endBattle = async () => {
    if (!id) return;
    if (!confirm("End this battle for everyone? Students mid-question can still submit their current answer.")) return;
    if (!academicReady || !ctx) {
      toast({ title: "Academic context not ready", variant: "destructive" });
      return;
    }
    setEnding(true);
    try {
      await BattleExperienceService.forceFinish(ctx, id);
      toast({ title: "Battle ended" });
      refresh();
    } catch (e) {
      toast({
        title: toErrorMessage(e, "Failed to end battle"),
        variant: "destructive",
      });
    } finally {
      setEnding(false);
    }
  };

  if (loading) {
    return (
      <div className="p-10 text-center text-muted-foreground flex flex-col items-center gap-2">
        <Loader2 className="w-6 h-6 animate-spin" /> Loading live monitor…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-lg mx-auto">
        <Button variant="ghost" size="sm" asChild className="mb-2"><Link to="/teacher/battleground"><ArrowLeft className="w-4 h-4" /> Battleground</Link></Button>
        <Card className="p-8 text-center">
          <AlertTriangle className="w-10 h-10 mx-auto text-warning mb-2" />
          <p className="font-semibold">Can't load this battle</p>
          <p className="text-sm text-muted-foreground mt-1">{error ?? "It may have been removed or you don't host it."}</p>
        </Card>
      </div>
    );
  }

  const b = data.battle;
  const parts = data.participants;
  const active = parts.filter((p) => !p.finished).length;
  const done = parts.filter((p) => p.finished).length;
  const struggling = parts.filter((p) => p.struggling && !p.finished);
  const avgAccuracy = parts.length
    ? Math.round(parts.reduce((a, p) => a + (p.accuracy ?? 0), 0) / parts.filter(p => p.accuracy != null).length || 0)
    : 0;

  const endsAt = new Date(b.starts_at).getTime() + b.duration_sec * 1000;
  const remainingSec = Math.max(0, Math.round((endsAt - now) / 1000));
  const mm = String(Math.floor(remainingSec / 60)).padStart(2, "0");
  const ss = String(remainingSec % 60).padStart(2, "0");
  const isFinished = b.status === "finished";

  const hardestQ = [...data.questions]
    .filter((q) => q.attempts > 0 && q.accuracy != null)
    .sort((a, c) => (a.accuracy! - c.accuracy!))[0];

  return (
    <div className="space-y-5 animate-rise">
      <Button variant="ghost" size="sm" asChild className="mb-1"><Link to="/teacher/battleground"><ArrowLeft className="w-4 h-4" /> Battleground</Link></Button>

      {/* Hero */}
      <Card className="hero-panel p-5">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[220px]">
            <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-foreground/70">
              {isFinished ? <Flag className="w-3.5 h-3.5" /> : <span className="live-dot" />}
              {isFinished ? "Battle ended" : "Live monitoring"}
            </div>
            <h1 className="text-xl font-semibold mt-1 text-foreground">{b.title}</h1>
            <p className="text-sm text-foreground/75">{b.subject}{b.topic ? ` · ${b.topic}` : ""} · {b.question_count} questions</p>
          </div>
          {!isFinished && (
            <div className="text-center">
              <div className="text-2xl font-semibold font-mono tabular-nums text-foreground">{mm}:{ss}</div>
              <div className="text-[11px] uppercase tracking-wide text-foreground/70">Window left</div>
            </div>
          )}
          {!isFinished && (
            <Button onClick={endBattle} disabled={ending} className="bg-destructive hover:bg-destructive/90 text-white font-bold">
              <Flag className="w-4 h-4 mr-1" /> {ending ? "Ending…" : "End battle"}
            </Button>
          )}
        </div>
      </Card>

      {/* Live stat tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<Users className="w-4 h-4" />} label="Active now" value={active} tone="primary" />
        <Stat icon={<CheckCircle2 className="w-4 h-4" />} label="Finished" value={done} tone="accent" />
        <Stat icon={<Target className="w-4 h-4" />} label="Avg accuracy" value={`${isNaN(avgAccuracy) ? 0 : avgAccuracy}%`} tone="warning" />
        <Stat icon={<AlertTriangle className="w-4 h-4" />} label="Struggling" value={struggling.length} tone="destructive" />
      </div>

      {/* Struggling spotlight */}
      {struggling.length > 0 && !isFinished && (
        <Card className="p-4 border-l-4 border-destructive bg-destructive/5">
          <div className="flex items-center gap-2 mb-2">
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <h3 className="font-bold text-sm">Needs attention right now</h3>
          </div>
          <div className="flex flex-wrap gap-2">
            {struggling.map((p) => (
              <span key={p.user_id} className="text-xs px-2.5 py-1 rounded-full bg-destructive/10 text-destructive font-medium">
                {p.display_name} · {p.accuracy ?? 0}% ({p.correct_count}/{p.answered_count})
              </span>
            ))}
          </div>
        </Card>
      )}

      {/* Live leaderboard */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
          <Trophy className="w-4 h-4 text-tier-gold" />
          <h2 className="font-bold text-sm">Live Leaderboard</h2>
          <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground font-semibold flex items-center gap-1">
            <Radio className="w-3 h-3" /> auto-refresh
          </span>
        </div>
        {parts.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            <Activity className="w-9 h-9 mx-auto text-muted-foreground/40 mb-2" />
            Waiting for students to join…
          </div>
        ) : (
          <div className="divide-y divide-border/60">
            {parts.map((p, i) => (
              <div key={p.user_id} className={cn("px-4 py-3 flex items-center gap-3", p.struggling && !p.finished && "bg-destructive/[0.04]")}>
                <div className={cn(
                  "w-7 h-7 rounded-md flex items-center justify-center text-xs font-semibold shrink-0",
                  i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                )}>{i + 1}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm truncate">{p.display_name}</span>
                    {p.finished
                      ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent font-semibold">DONE</span>
                      : <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-semibold flex items-center gap-0.5"><Zap className="w-2.5 h-2.5" /> LIVE</span>}
                    {p.struggling && !p.finished && <AlertTriangle className="w-3.5 h-3.5 text-destructive" />}
                  </div>
                  <div className="mt-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-primary transition-all duration-500" style={{ width: `${p.progress_pct}%` }} />
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {p.answered_count}/{b.question_count} answered · {p.accuracy ?? 0}% accuracy
                    {p.avg_ms != null ? ` · ${(p.avg_ms / 1000).toFixed(1)}s/q` : ""}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="font-semibold tabular-nums">{p.score}</div>
                  <div className="text-[10px] text-muted-foreground uppercase">pts</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Per-question difficulty */}
      <Card className="overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
          <BarChart3 className="w-4 h-4 text-primary" />
          <h2 className="font-bold text-sm">Question Performance</h2>
          {hardestQ && (
            <span className="ml-auto text-[10px] text-destructive font-semibold">
              Hardest: Q{hardestQ.order_index + 1} ({hardestQ.accuracy}%)
            </span>
          )}
        </div>
        <div className="p-4 space-y-2.5">
          {data.questions.map((q) => (
            <div key={q.order_index}>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-medium truncate pr-2">Q{q.order_index + 1}. {q.question}</span>
                <span className="text-muted-foreground whitespace-nowrap">
                  {q.attempts === 0 ? "—" : `${q.accuracy}% (${q.correct}/${q.attempts})`}
                </span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div className={cn("h-full rounded-full transition-all",
                  q.accuracy == null ? "bg-muted" : q.accuracy >= 70 ? "bg-accent" : q.accuracy >= 40 ? "bg-warning" : "bg-destructive")}
                  style={{ width: `${q.accuracy ?? 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Per-student analytics (24h) */}
      {reports.length > 0 && (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b bg-muted/30">
            <FileBarChart className="w-4 h-4 text-primary" />
            <h2 className="font-bold text-sm">Student performance reports</h2>
            <span className="ml-auto text-[10px] text-muted-foreground font-semibold">Available 24h</span>
          </div>
          <div className="divide-y divide-border/60">
            {reports.map((r) => (
              <Link
                key={r.participant_id}
                to={`/teacher/battleground/monitor/${id}/report/${r.participant_id}`}
                className={cn(
                  "flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors",
                  r.expired && "opacity-60",
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{r.display_name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {r.summary?.score ?? 0} pts · #{r.summary?.rank ?? "—"} · {r.summary?.accuracy_pct ?? 0}% accuracy
                    {r.expired ? " · expired" : ""}
                  </div>
                </div>
                <span className={cn(
                  "text-xs font-semibold shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md border",
                  r.expired ? "text-muted-foreground border-border" : "text-primary border-primary/30",
                )}>
                  <Sparkles className="w-3.5 h-3.5" /> {r.expired ? "Expired" : "Deep report →"}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Stat({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone: "primary" | "accent" | "warning" | "destructive" }) {
  const tones: Record<string, string> = {
    primary: "text-primary", accent: "text-accent", warning: "text-warning", destructive: "text-destructive",
  };
  return (
    <Card className="p-4">
      <div className={cn("flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-semibold", tones[tone])}>
        {icon} {label}
      </div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </Card>
  );
}
