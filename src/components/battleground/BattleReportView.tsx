import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { buildRuleBattleInsights, type BattleAiInsights } from "@/lib/battleReportInsights";
import type { ConceptRecoveryReport as ConceptRecoveryReportPayload } from "@/lib/conceptReportFallback";
import {
  Target, Clock, TrendingUp, TrendingDown, Sparkles, Loader2,
  AlertTriangle, Brain, CheckCircle2, XCircle, Timer, BarChart3,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { ConceptRecoveryReport } from "@/components/student/ConceptRecoveryReport";
import { MathText } from "@/components/MathText";
import "@/components/student/analytics/wisdom/wisdom-analytics.css";
import { displayChapter, displayTopic, displaySubject } from "@/lib/academicDisplay";

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
  const [aiSource, setAiSource] = useState<"ai" | "gemini" | null>(null);

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
    const normalized = res;
    setData(normalized as BattleReportPayload);
    if (normalized.ai_insights?.source) {
      setAiSource(normalized.ai_insights.source === "gemini" ? "gemini" : "ai");
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [participantId]);

  const applyInsights = async (insights: BattleAiInsights) => {
    setData((d) => d ? { ...d, ai_insights: insights } : d);
    setAiSource(insights.source === "gemini" ? "gemini" : "ai");
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
        const src = ai.source === "gemini" ? "gemini" : "ai";
        await applyInsights({ ...ai, source: src });
        return;
      }

      const fallback = buildRuleBattleInsights(data.report);
      await applyInsights(fallback);
      setAiError(fnErr ? "Live coach is unavailable, so this report is using instant learning insights." : null);
      return;
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? "Insights could not be loaded";
      const fallback = buildRuleBattleInsights(data.report);
      await applyInsights(fallback);
      setAiError(`${msg}. Showing instant learning insights instead.`);
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
  const conceptFallback = buildBattleConceptFallback(data);

  return (
    <div className="wisdom-analytics wa-gradient-bg wa-report-shell space-y-5 animate-rise max-w-4xl mx-auto p-1 sm:p-2">
      {/* Expiry urgency */}
      <div className="flex items-center gap-2 text-xs font-semibold text-amber-900 bg-[#fff4d6] border border-[#f2d486] rounded-2xl px-4 py-3 shadow-sm">
        <Timer className="w-3.5 h-3.5 shrink-0" />
        Detailed report expires {expiresIn} — review while it's available
      </div>

      {/* Hero */}
      <Card className="wa-report-hero p-6 sm:p-8 relative overflow-hidden">
        <div className="relative">
          <div className="flex flex-wrap gap-2 mb-4">
            <span className="wa-gold-pill">Battle Intelligence</span>
            {forTeacher && <span className="rounded-full bg-white/12 border border-white/15 px-3 py-1 text-[10px] font-semibold text-white/80">{data.display_name}</span>}
          </div>
          <h1 className="font-['Sora'] text-3xl sm:text-4xl font-semibold tracking-tight text-white">{b.title ?? "Battle report"}</h1>
          <p className="text-sm text-white/75 mt-1">
            {displaySubject(b.subject)}{b.chapter ? ` · ${displayChapter(b.chapter)}` : ""}{b.topic ? ` · ${displayTopic(b.topic)}` : ""}
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
          fallbackReport={conceptFallback}
        />
      )}

      {/* AI coach */}
      <Card className="wa-card wa-coach-premium p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="wa-ai-orb small"><Sparkles className="w-4 h-4" /></span>
          <div>
            <p className="wa-label text-[var(--wa-primary)]">Personal coach</p>
            <h2 className="wa-headline">Performance Coach</h2>
          </div>
          {coachSource && (
            <span className="ml-auto rounded-full bg-[var(--wa-primary-fixed)] px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--wa-primary)]">
              {coachSource === "rule" ? "Instant" : "Live"} insights
            </span>
          )}
        </div>
        {aiError && !aiLoading && (
          <p className="text-xs text-[var(--wa-on-surface-variant)] mb-3 flex items-center gap-1.5">
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
            {ai.headline && <p className="font-['Sora'] font-semibold text-lg text-[var(--wa-primary)]">{ai.headline}</p>}
            {ai.praise && (
              <p className="text-sm text-emerald-800 flex items-start gap-2 rounded-xl bg-emerald-50 border border-emerald-100 px-3 py-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" /> {ai.praise}
              </p>
            )}
            {(ai.insights ?? []).map((line: string, i: number) => (
              <p key={i} className="text-sm text-[var(--wa-on-surface-variant)] flex items-start gap-2">
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
              <p className="text-sm font-medium border-t border-[var(--wa-outline-variant)] pt-3 mt-2">{ai.recommendation}</p>
            )}
          </div>
        )}
        {!ai && !aiLoading && (
          <Button variant="outline" size="sm" onClick={fetchAI} className="gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> Generate full report
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
        <h2 className="wa-display text-2xl mb-3 flex items-center gap-2"><BarChart3 className="w-5 h-5" /> Question-wise analysis</h2>
        <div className="space-y-3">
          {questions.map((q: any, i: number) => (
            <Card key={q.question_id ?? i} className={cn("wa-question-card p-4", q.skipped && "opacity-80 border-dashed")}>
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
              <MathText block className="text-sm font-medium leading-snug" text={q.question} />
              {(q.chapter || q.topic) && (
                <p className="text-[11px] text-muted-foreground mt-1">{[q.chapter ? displayChapter(q.chapter) : null, q.topic ? displayTopic(q.topic) : null].filter(Boolean).join(" · ")}</p>
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

function buildBattleConceptFallback(data: BattleReportPayload): ConceptRecoveryReportPayload {
  const report = data.report ?? {};
  const summary = report.summary ?? {};
  const battle = report.battle ?? {};
  const topics = report.topics ?? {};
  const weak = Array.isArray(topics.weak) ? topics.weak : [];
  const strong = Array.isArray(topics.strong) ? topics.strong : [];

  return {
    source_type: "battle_participant",
    source_id: data.participant_id,
    accuracy_pct: Number(summary.accuracy_pct ?? 0),
    correct_count: Number(summary.correct_count ?? 0),
    total_count: Number(summary.answered_count ?? 0),
    time_minutes: Math.round(Number(summary.total_time_sec ?? 0) / 60),
    weak_concepts: weak.map((item: any) => ({
      subject: battle.subject ?? "General",
      chapter: item.chapter ?? battle.chapter,
      concept: item.label ?? item.topic ?? battle.topic ?? battle.chapter ?? battle.subject ?? "General",
      accuracy: Number(item.accuracy ?? 0),
      attempts: Number(item.total ?? 0),
      correct: Number(item.correct ?? 0),
    })),
    strong_concepts: strong.map((item: any) => ({
      subject: battle.subject ?? "General",
      chapter: item.chapter ?? battle.chapter,
      concept: item.label ?? item.topic ?? battle.topic ?? battle.chapter ?? battle.subject ?? "General",
      accuracy: Number(item.accuracy ?? 100),
    })),
    recovery_assignments: [],
    improvement_areas: weak.map((item: any) => item.label ?? item.topic ?? "Weak concept"),
  };
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
