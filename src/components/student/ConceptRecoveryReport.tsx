import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import {
  type ConceptRecoveryReport,
  type ConceptAiReport,
  buildRuleConceptReport,
} from "@/lib/conceptReportFallback";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, Target, Timer } from "lucide-react";
import { displayConcept } from "@/lib/academicDisplay";
import "@/components/student/analytics/wisdom/wisdom-analytics.css";

type Props = {
  sourceType: "dpp_attempt" | "battle_participant" | "practice_session" | "recovery_assignment";
  sourceId: string;
  title?: string;
  /** Client-side report when DB/RPC has no attempt rows yet */
  fallbackReport?: ConceptRecoveryReport | null;
};

export function ConceptRecoveryReport({
  sourceType,
  sourceId,
  title = "Concept recovery report",
  fallbackReport = null,
}: Props) {
  const [report, setReport] = useState<ConceptRecoveryReport | null>(fallbackReport ?? null);
  const [insights, setInsights] = useState<ConceptAiReport | null>(
    fallbackReport ? buildRuleConceptReport(fallbackReport) : null,
  );
  const [loading, setLoading] = useState(!fallbackReport);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await (supabase as any).rpc("rpc_get_concept_recovery_report", {
        _source_type: sourceType,
        _source_id: sourceId,
      });
      if (err) {
        if (fallbackReport) {
          if (cancelled) return;
          setReport(fallbackReport);
          setInsights(buildRuleConceptReport(fallbackReport));
          setLoading(false);
          return;
        }
        setError(err.message);
        setLoading(false);
        return;
      }
      const r = data as ConceptRecoveryReport | null;
      if (!r) {
        if (fallbackReport) {
          if (cancelled) return;
          setReport(fallbackReport);
          setInsights(buildRuleConceptReport(fallbackReport));
          setLoading(false);
          return;
        }
        setError("No concept analysis data found for this session.");
        setLoading(false);
        return;
      }
      const useFallback = fallbackReport && (r.total_count ?? 0) === 0 && (fallbackReport.total_count ?? 0) > 0;
      const finalReport = useFallback ? fallbackReport : r;
      if (cancelled) return;
      setReport(finalReport);
      setInsights(finalReport.insights ?? buildRuleConceptReport(finalReport));
      setLoading(false);

      (supabase as any).rpc("rpc_post_assessment_concept_analysis", {
        _source_type: sourceType,
        _source_id: sourceId,
      }).then(({ data: postData }: { data: ConceptRecoveryReport | null }) => {
        if (cancelled || !postData) return;
        const refreshed = fallbackReport && (postData.total_count ?? 0) === 0 && (fallbackReport.total_count ?? 0) > 0
          ? fallbackReport
          : postData;
        setReport(refreshed);
        setInsights(refreshed.insights ?? buildRuleConceptReport(refreshed));
      });
    })();
    return () => { cancelled = true; };
  }, [sourceType, sourceId, fallbackReport]);

  const fetchAi = async () => {
    if (!report) return;
    setAiLoading(true);
    const { data, error: err } = await invokeEdgeFunction<ConceptAiReport>("ai-concept-report", {
      report,
      display_name: "Student",
    });
    if (data && !err) {
      setInsights({ ...data, source: "ai" });
      setAiLoading(false);
      return;
    }
    if (err) setError(err);
    setAiLoading(false);
  };

  if (loading) {
    return (
      <Card className="wisdom-analytics wa-card p-4 flex items-center gap-2 text-[var(--wa-on-surface-variant)]">
        <Loader2 className="w-4 h-4 animate-spin" /> Analyzing concepts…
      </Card>
    );
  }

  if (error || !report) {
    if (fallbackReport) {
      const fb = fallbackReport;
      const fbInsights = buildRuleConceptReport(fb);
      return (
        <Card className="p-5 mb-6 border-primary/20 bg-primary/5 shadow-card">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="font-semibold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" /> {title}
              </h3>
              <p className="text-xs text-muted-foreground mt-1">Session summary from your answers</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-3 gap-3 mb-4 text-sm">
            <div className="flex items-center gap-2 p-2 rounded-lg bg-background/60">
              <Target className="w-4 h-4 text-accent" />
              <div><div className="text-xs text-muted-foreground">Accuracy</div><div className="font-bold">{fb.accuracy_pct}%</div></div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-background/60">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              <div><div className="text-xs text-muted-foreground">Score</div><div className="font-bold">{fb.correct_count}/{fb.total_count}</div></div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-lg bg-background/60">
              <Timer className="w-4 h-4 text-muted-foreground" />
              <div><div className="text-xs text-muted-foreground">Time</div><div className="font-bold">{fb.time_minutes}m</div></div>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-background/70 border">
            <p className="font-medium text-sm">{fbInsights.headline}</p>
            <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc pl-4">
              {fbInsights.bullets.map((b, i) => <li key={i}>{b}</li>)}
            </ul>
          </div>
        </Card>
      );
    }
    return (
      <Card className="wisdom-analytics wa-card p-4 text-sm text-[var(--wa-on-surface-variant)]">
        Concept analysis unavailable{error ? `: ${error}` : ""}.
      </Card>
    );
  }

  const weak = report.weak_concepts ?? [];
  const strong = report.strong_concepts ?? [];

  return (
    <Card className="wisdom-analytics wa-card wa-concept-report-card p-5 sm:p-6 mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="wa-label text-[var(--wa-primary)]">Learning intelligence</p>
          <h3 className="wa-headline flex items-center gap-2 mt-1">
            <span className="wa-ai-orb small"><Sparkles className="w-4 h-4" /></span> {title}
          </h3>
          <p className="wa-body text-xs mt-1">NCERT concept-level breakdown after this session</p>
        </div>
        <Button size="sm" variant="outline" onClick={fetchAi} disabled={aiLoading} className="rounded-full bg-white/80">
          {aiLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
          {insights?.source === "ai" ? "View insights" : "Get insights"}
        </Button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-4 text-sm">
        <div className="wa-mini-metric">
          <Target className="w-4 h-4 text-accent" />
          <div><div className="wa-label text-[10px]">Accuracy</div><div className="font-bold">{report.accuracy_pct}%</div></div>
        </div>
        <div className="wa-mini-metric">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          <div><div className="wa-label text-[10px]">Score</div><div className="font-bold">{report.correct_count}/{report.total_count}</div></div>
        </div>
        <div className="wa-mini-metric">
          <Timer className="w-4 h-4 text-muted-foreground" />
          <div><div className="wa-label text-[10px]">Time</div><div className="font-bold">{report.time_minutes}m</div></div>
        </div>
      </div>

      {weak.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium flex items-center gap-1 mb-2 text-warning">
            <AlertTriangle className="w-3.5 h-3.5" /> Weak concepts
          </h4>
          <div className="flex flex-wrap gap-2">
            {weak.map((w, i) => (
              <Badge key={i} variant="outline" className="rounded-full bg-warning/10 border-warning/30">
                {displayConcept(w.concept)} · {w.accuracy}%
              </Badge>
            ))}
          </div>
        </div>
      )}

      {strong.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium mb-2 text-accent">Strong concepts</h4>
          <div className="flex flex-wrap gap-2">
            {strong.map((s, i) => (
              <Badge key={i} className="rounded-full bg-accent/15 text-accent border-0">{displayConcept(s.concept)} · {s.accuracy}%</Badge>
            ))}
          </div>
        </div>
      )}

      {insights && (
        <div className="wa-insight-panel p-4 rounded-2xl mb-4">
          <p className="font-medium text-sm">{insights.headline}</p>
          <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc pl-4">
            {insights.bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
          {insights.next_steps.length > 0 && (
            <>
              <p className="text-xs font-medium mt-3 mb-1">Next steps</p>
              <ul className="text-sm text-muted-foreground space-y-1 list-decimal pl-4">
                {insights.next_steps.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      {(report.recovery_assignments ?? []).length > 0 && (
        <Button asChild size="sm">
          <Link to="/student/recovery">Fix my mistakes ({report.recovery_assignments.length} queued)</Link>
        </Button>
      )}
    </Card>
  );
}
