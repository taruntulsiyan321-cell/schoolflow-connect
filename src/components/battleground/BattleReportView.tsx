import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { invokeEdgeFunction, isAiUnavailableError } from "@/lib/edgeFunction";
import { buildRuleBattleInsights, type BattleAiInsights } from "@/lib/battleReportInsights";
import {
  Target, Clock, TrendingUp, TrendingDown, Sparkles, Loader2,
  AlertTriangle, Brain, CheckCircle2, XCircle, Timer, BarChart3,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ConceptRecoveryReport } from "@/components/student/ConceptRecoveryReport";

export type BattleReportPayload = {
  id: string;
  participant_id: string;
  battle_id: string;
  user_id: string;
  display_name: string;
  report: any;
  ai_insights: any;
  expires_at: string;
  created_at: string;
  expired: boolean;
};

type Props = {
  participantId: string;
  forTeacher?: boolean;
  onBack?: () => void;
};

export function BattleReportView({ participantId, forTeacher = false, onBack }: Props) {
  const [data, setData] = useState<BattleReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSource, setAiSource] = useState<"ai" | "rule" | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    let res: BattleReportPayload | null = null;
    let err: { message: string } | null = null;

    ({ data: res, error: err } = await (supabase as any).rpc("rpc_get_battle_report", {
      _participant_id: participantId,
    }));

    if (!res && !err) {
      ({ data: res, error: err } = await (supabase as any).rpc("rpc_ensure_battle_report", {
        _participant_id: participantId,
      }));
    }

    if (err) { setError(err.message); setLoading(false); return; }
    if (!res) { setError("Report not found — finish the battle and try again."); setLoading(false); return; }
    setData(res as BattleReportPayload);
    if (res.ai_insights?.source) setAiSource(res.ai_insights.source);
    setLoading(false);
  };

  useEffect(() => { load(); }, [participantId]);

  const applyInsights = async (insights: BattleAiInsights) => {
    setData((d) => d ? { ...d, ai_insights: insights } : d);
    setAiSource(insights.source ?? "ai");
    const { error: saveErr } = await (supabase as any).rpc("rpc_save_battle_ai_insights", {
      _participant_id: participantId,
      _insights: insights,
    });
    if (saveErr) {
      /* non-fatal — insights still shown in UI */
    }
  };

  const fetchAI = async () => {
    if (!data || data.expired) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const { data: ai, error: fnErr } = await invokeEdgeFunction<BattleAiInsights>("ai-battle-report", {
        participant_id: participantId,
        display_name: data.display_name,
        for_teacher: forTeacher,
        report: data.report,
      });

      if (ai && !fnErr) {
        await applyInsights({ ...ai, source: "ai" });
        return;
      }

      const fallback = buildRuleBattleInsights(data.report ?? {});
      await applyInsights(fallback);
      if (fnErr) {
        setAiError(
          isAiUnavailableError(fnErr)
            ? "Using offline coach — AI credits unavailable."
            : fnErr,
        );
      }
      return;
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? "AI insights failed";
      const fallback = buildRuleBattleInsights(data.report ?? {});
      await applyInsights(fallback);
      setAiError(msg);
    } finally {
      setAiLoading(false);
    }
  };

  useEffect(() => {
    // Auto-generate for students only; teachers trigger manually to control AI cost
    if (data && !data.expired && !data.ai_insights && !forTeacher) fetchAI();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.participant_id, data?.ai_insights, data?.expired, forTeacher]);

  if (loading) {
    return (
      <div className="py-12 text-center text-muted-foreground flex flex-col items-center gap-2">
        <Loader2 className="w-6 h-6 animate-spin" /> Loading battle report…
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card className="p-8 text-center">
        <AlertTriangle className="w-10 h-10 mx-auto text-warning mb-2" />
        <p className="font-semibold">{error}</p>
        {onBack && <Button variant="outline" className="mt-4" onClick={onBack}>Back</Button>}
      </Card>
    );
  }

  if (!data) return null;

  if (data.expired) {
    return (
      <Card className="p-8 text-center">
        <Timer className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
        <h2 className="font-bold text-lg">Report expired</h2>
        <p className="text-sm text-muted-foreground mt-2">
          Detailed battle analytics are available for 24 hours after each battle.
          Your permanent XP, badges and leaderboard stats are still saved.
        </p>
        {onBack && <Button className="mt-4" onClick={onBack}>Back</Button>}
      </Card>
    );
  }

  const r = data.report;
  const s = r.summary ?? {};
  const b = r.battle ?? {};
  const topics = r.topics ?? { strong: [], weak: [] };
  const speed = r.speed ?? {};
  const cmp = r.comparison ?? {};
  const questions: any[] = r.questions ?? [];
  const ai = data.ai_insights;
  const coachSource = aiSource ?? ai?.source ?? null;
  const expiresIn = formatDistanceToNow(new Date(data.expires_at), { addSuffix: true });

  return (
    <div className="space-y-5 animate-rise max-w-3xl mx-auto">
      {/* Expiry urgency */}
      <div className="flex items-center gap-2 text-xs font-semibold text-warning bg-warning/10 border border-warning/20 rounded-lg px-3 py-2">
        <Timer className="w-3.5 h-3.5 shrink-0" />
        Detailed report expires {expiresIn} — review while it's available
      </div>

      {/* Hero */}
      <Card className="p-6 hero-panel relative overflow-hidden">
        <div className="relative">
          {forTeacher && <div className="text-xs uppercase tracking-widest opacity-70 mb-1">{data.display_name}</div>}
          <h1 className="text-2xl font-semibold text-white">{b.title ?? "Battle report"}</h1>
          <p className="text-sm text-white/75 mt-1">
            {b.subject}{b.chapter ? ` · ${b.chapter}` : ""}{b.topic ? ` · ${b.topic}` : ""}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            <MiniStat label="Score" value={s.score} />
            <MiniStat label="Rank" value={s.rank ? `#${s.rank}` : "—"} />
            <MiniStat label="Accuracy" value={`${s.accuracy_pct ?? 0}%`} />
            <MiniStat label="Avg speed" value={`${((s.avg_time_ms ?? 0) / 1000).toFixed(1)}s/q`} />
          </div>
        </div>
      </Card>

      {!forTeacher && (
        <ConceptRecoveryReport
          sourceType="battle_participant"
          sourceId={participantId}
          title="Battle concept recovery report"
        />
      )}

      {/* AI coach */}
      <Card className="p-5 surface-card">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <Sparkles className="w-5 h-5 text-primary" />
          <h2 className="font-bold">Performance Coach</h2>
          {coachSource === "rule" && (
            <Badge variant="outline" className="text-xs border-warning/40 text-warning">Offline coach</Badge>
          )}
          {coachSource === "ai" && (
            <Badge variant="outline" className="text-xs border-primary/40 text-primary">AI powered</Badge>
          )}
        </div>
        {aiError && !aiLoading && (
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" /> {aiError}
          </p>
        )}
        {aiLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
            <Loader2 className="w-4 h-4 animate-spin" /> Generating personalized insights…
          </div>
        )}
        {ai && !aiLoading && (
          <div className="space-y-3">
            {ai.headline && <p className="font-semibold text-lg">{ai.headline}</p>}
            {ai.praise && (
              <p className="text-sm text-accent flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> {ai.praise}
              </p>
            )}
            {(ai.insights ?? []).map((line: string, i: number) => (
              <p key={i} className="text-sm text-muted-foreground flex items-start gap-2">
                <Brain className="w-4 h-4 shrink-0 mt-0.5 text-primary" /> {line}
              </p>
            ))}
            {(ai.focus_areas ?? []).length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {ai.focus_areas.map((f: string) => (
                  <span key={f} className="text-xs px-2 py-1 rounded-full bg-warning/15 text-warning font-medium">{f}</span>
                ))}
              </div>
            )}
            {ai.recommendation && (
              <p className="text-sm font-medium border-t pt-3 mt-2">{ai.recommendation}</p>
            )}
          </div>
        )}
        {!ai && !aiLoading && (
          <Button variant="outline" size="sm" onClick={fetchAI} className="gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Generate AI report
          </Button>
        )}
      </Card>

      {/* Analytics tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <Tile icon={<Target />} label="Correct" value={`${s.correct_count}/${s.answered_count}`} />
        <Tile icon={<XCircle />} label="Skipped" value={s.skipped_count ?? 0} tone="warning" />
        <Tile icon={<Clock />} label="Total time" value={`${s.total_time_sec ?? 0}s`} />
        {speed.under_pressure_accuracy != null && (
          <Tile icon={<Timer />} label="Under pressure" value={`${speed.under_pressure_accuracy}% acc`} tone="destructive" />
        )}
        {speed.comfort_zone_accuracy != null && (
          <Tile icon={<CheckCircle2 />} label="Comfort zone" value={`${speed.comfort_zone_accuracy}% acc`} tone="accent" />
        )}
        {cmp.vs_avg_accuracy != null && (
          <Tile
            icon={cmp.vs_avg_accuracy >= 0 ? <TrendingUp /> : <TrendingDown />}
            label="Vs class avg"
            value={`${cmp.vs_avg_accuracy >= 0 ? "+" : ""}${cmp.vs_avg_accuracy}%`}
            tone={cmp.vs_avg_accuracy >= 0 ? "accent" : "warning"}
          />
        )}
      </div>

      {/* Strong / weak topics */}
      <div className="grid md:grid-cols-2 gap-3">
        <TopicCard title="Strong areas" items={topics.strong} variant="strong" />
        <TopicCard title="Needs work" items={topics.weak} variant="weak" />
      </div>

      {/* Question breakdown */}
      <div>
        <h2 className="font-bold mb-3 flex items-center gap-2"><BarChart3 className="w-4 h-4" /> Question-wise analysis</h2>
        <div className="space-y-3">
          {questions.map((q: any, i: number) => (
            <Card key={q.question_id ?? i} className={cn("p-4", q.skipped && "opacity-80 border-dashed")}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="text-xs text-muted-foreground">Q{q.order_index + 1}</span>
                {q.skipped ? (
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">Skipped</span>
                ) : q.is_correct ? (
                  <span className="text-[10px] font-semibold uppercase text-accent flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Correct · {(q.time_ms / 1000).toFixed(1)}s
                  </span>
                ) : (
                  <span className="text-[10px] font-semibold uppercase text-destructive flex items-center gap-1">
                    <XCircle className="w-3 h-3" /> Wrong · {(q.time_ms / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
              <p className="text-sm font-medium leading-snug">{q.question}</p>
              {(q.chapter || q.topic) && (
                <p className="text-[11px] text-muted-foreground mt-1">{[q.chapter, q.topic].filter(Boolean).join(" · ")}</p>
              )}
              {!q.skipped && (
                <ExplainPanel
                  question={q.question}
                  options={q.options as string[]}
                  correctIndex={q.correct_index}
                  selectedIndex={q.selected_index}
                  subject={b.subject}
                  chapter={q.chapter}
                  topic={q.topic}
                  wasCorrect={q.is_correct}
                />
              )}
            </Card>
          ))}
        </div>
      </div>

      {onBack && (
        <Button onClick={onBack} className="w-full">Done</Button>
      )}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xl font-semibold text-white">{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-white/70">{label}</div>
    </div>
  );
}

function Tile({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: React.ReactNode; tone?: "accent" | "warning" | "destructive" }) {
  const c = tone === "accent" ? "text-accent" : tone === "warning" ? "text-warning" : tone === "destructive" ? "text-destructive" : "text-primary";
  return (
    <Card className="p-4">
      <div className={cn("flex items-center gap-1.5 text-[11px] uppercase font-semibold [&_svg]:w-3.5 [&_svg]:h-3.5", c)}>
        {icon}{label}
      </div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </Card>
  );
}

function TopicCard({ title, items, variant }: { title: string; items: any[]; variant: "strong" | "weak" }) {
  const border = variant === "strong" ? "border-accent" : "border-warning";
  return (
    <Card className={cn("p-4 border-l-4", border)}>
      <h3 className="font-bold text-sm mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Not enough data yet.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((t: any, i: number) => (
            <li key={i} className="flex justify-between text-sm">
              <span className="font-medium truncate pr-2">{t.label}</span>
              <span className="text-muted-foreground shrink-0">{t.correct}/{t.total} · {t.accuracy}%</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
