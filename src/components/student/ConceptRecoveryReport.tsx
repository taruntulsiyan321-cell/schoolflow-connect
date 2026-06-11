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
} from "@/lib/conceptReportFallback";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, Target, Timer } from "lucide-react";

type Props = {
  sourceType: "dpp_attempt" | "battle_participant" | "practice_session";
  sourceId: string;
  title?: string;
};

export function ConceptRecoveryReport({ sourceType, sourceId, title = "Concept recovery report" }: Props) {
  const [report, setReport] = useState<ConceptRecoveryReport | null>(null);
  const [insights, setInsights] = useState<ConceptAiReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      const { data, error: err } = await (supabase as any).rpc("rpc_post_assessment_concept_analysis", {
        _source_type: sourceType,
        _source_id: sourceId,
      });
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      const r = data as ConceptRecoveryReport;
      setReport(r);
      setInsights(r.insights ?? null);
      setLoading(false);
    })();
  }, [sourceType, sourceId]);

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
      <Card className="p-4 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Analyzing concepts…
      </Card>
    );
  }

  if (error || !report) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Concept analysis unavailable{error ? `: ${error}` : ""}.
      </Card>
    );
  }

  const weak = report.weak_concepts ?? [];
  const strong = report.strong_concepts ?? [];

  return (
    <Card className="p-5 mb-6 border-primary/20 bg-primary/5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h3 className="font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> {title}
          </h3>
          <p className="text-xs text-muted-foreground mt-1">NCERT concept-level breakdown after this session</p>
        </div>
        <Button size="sm" variant="outline" onClick={fetchAi} disabled={aiLoading}>
          {aiLoading ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
          {insights?.source === "ai" ? "View insights" : "Get insights"}
        </Button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-4 text-sm">
        <div className="flex items-center gap-2 p-2 rounded-lg bg-background/60">
          <Target className="w-4 h-4 text-accent" />
          <div><div className="text-xs text-muted-foreground">Accuracy</div><div className="font-bold">{report.accuracy_pct}%</div></div>
        </div>
        <div className="flex items-center gap-2 p-2 rounded-lg bg-background/60">
          <CheckCircle2 className="w-4 h-4 text-primary" />
          <div><div className="text-xs text-muted-foreground">Score</div><div className="font-bold">{report.correct_count}/{report.total_count}</div></div>
        </div>
        <div className="flex items-center gap-2 p-2 rounded-lg bg-background/60">
          <Timer className="w-4 h-4 text-muted-foreground" />
          <div><div className="text-xs text-muted-foreground">Time</div><div className="font-bold">{report.time_minutes}m</div></div>
        </div>
      </div>

      {weak.length > 0 && (
        <div className="mb-4">
          <h4 className="text-sm font-medium flex items-center gap-1 mb-2 text-warning">
            <AlertTriangle className="w-3.5 h-3.5" /> Weak concepts
          </h4>
          <div className="flex flex-wrap gap-2">
            {weak.map((w, i) => (
              <Badge key={i} variant="outline" className="bg-warning/10 border-warning/30">
                {w.concept} · {w.accuracy}%
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
              <Badge key={i} className="bg-accent/15 text-accent border-0">{s.concept} · {s.accuracy}%</Badge>
            ))}
          </div>
        </div>
      )}

      {insights && (
        <div className="p-3 rounded-lg bg-background/70 border mb-4">
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
