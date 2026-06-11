import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useImprovementPlans, type ImprovementPlanRow } from "@/hooks/useImprovementPlans";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui-bits";
import { Sparkles, Loader2, ListChecks, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import type { ImprovementPlanPayload } from "@/lib/improvementPlanFallback";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";

export default function ImprovementPlans() {
  const { user } = useAuth();
  const { plans, loading, error, reload } = useImprovementPlans();
  const [enhancing, setEnhancing] = useState<string | null>(null);

  const topicKey = (p: ImprovementPlanRow) =>
    `${p.subject}|${p.chapter ?? ""}|${p.topic ?? ""}`;

  const savePlan = async (p: ImprovementPlanRow, plan: ImprovementPlanPayload) => {
    if (!user) return;
    let q = supabase
      .from("student_improvement_plans")
      .select("id")
      .eq("user_id", user.id)
      .eq("subject", p.subject)
      .eq("source", "ai");
    q = p.chapter ? q.eq("chapter", p.chapter) : q.is("chapter", null);
    q = p.topic ? q.eq("topic", p.topic) : q.is("topic", null);
    const { data: existing } = await q.maybeSingle();

    const row = {
      user_id: user.id,
      subject: p.subject,
      chapter: p.chapter ?? null,
      topic: p.topic ?? null,
      plan,
      source: "ai" as const,
      updated_at: new Date().toISOString(),
    };

    const { error: saveErr } = existing?.id
      ? await supabase.from("student_improvement_plans").update(row).eq("id", existing.id)
      : await supabase.from("student_improvement_plans").insert(row);
    if (saveErr) throw new Error(saveErr.message);

    toast.success("Personalized plan saved for this topic");
    reload();
  };

  const enhanceWithAI = async (p: ImprovementPlanRow) => {
    if (!user) return;
    const key = topicKey(p);
    setEnhancing(key);
    try {
      const { data: student } = await supabase
        .from("students")
        .select("full_name")
        .eq("user_id", user.id)
        .maybeSingle();

      const { data: ai, error: fnErr } = await invokeEdgeFunction<ImprovementPlanPayload>("ai-improvement-plan", {
        subject: p.subject,
        chapter: p.chapter,
        topic: p.topic,
        accuracy: p.accuracy,
        attempts: p.attempts,
        mistake_count: p.mistake_count,
        display_name: student?.full_name ?? "Student",
      });

      if (ai && !fnErr) {
        await savePlan(p, { ...ai, source: "ai" });
        return;
      }

      toast.error(fnErr || "Could not generate a plan. Please retry.");
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? "Could not generate plan");
    } finally {
      setEnhancing(null);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2">
        <Link to="/student"><ArrowLeft className="w-4 h-4" /> Dashboard</Link>
      </Button>
      <PageHeader
        title="Improvement plans"
        subtitle="Weak topics from DPPs, battles, and self-practice — with steps to improve"
      />

      {loading && <StudentListSkeleton rows={3} />}

      {!loading && error && (
        <StudentErrorState title="Could not load improvement plans" message={error} onRetry={reload} />
      )}

      {!loading && !error && plans.length === 0 && (
        <Card className="p-8 text-center">
          <ListChecks className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">No weak topics yet. Try a DPP, battle, or Class 12 self-practice session.</p>
          <div className="flex gap-2 justify-center mt-4 flex-wrap">
            <Button asChild><Link to="/student/dpp">Start a DPP</Link></Button>
            <Button asChild variant="outline"><Link to="/student/practice/math12">Self-practice</Link></Button>
          </div>
        </Card>
      )}

      {!loading && !error && (
      <div className="space-y-4">
        {plans.map((p) => {
          const key = topicKey(p);
          const hasGeminiPlan = Boolean(p.ai_plan && (p.ai_plan as { source?: string }).source !== "rule");
          const active = hasGeminiPlan ? p.ai_plan : p.rule_plan;
          const steps = active?.steps ?? [];
          return (
            <Card key={key} className="p-5 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
                <div>
                  <div className="font-semibold">{p.subject}</div>
                  <div className="text-sm text-muted-foreground">
                    {[p.chapter, p.topic].filter(Boolean).join(" · ") || "General"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{p.accuracy}% accuracy</Badge>
                  {hasGeminiPlan && (
                    <Badge className="bg-primary/15 text-primary border-0">Personalized</Badge>
                  )}
                </div>
              </div>

              <p className="font-medium text-sm mb-2">{active?.headline ?? p.rule_plan?.headline}</p>
              {active?.timeframe && (
                <p className="text-xs text-muted-foreground mb-2">Suggested timeframe: {active.timeframe}</p>
              )}

              <ul className="list-disc pl-5 space-y-1 text-sm mb-4">
                {steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>

              {p.ai_plan?.resources && p.ai_plan.resources.length > 0 && (
                <div className="text-sm mb-4">
                  <div className="font-medium mb-1">Resources</div>
                  <ul className="list-disc pl-5 space-y-0.5 text-muted-foreground">
                    {p.ai_plan.resources.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}

              <div className="flex flex-wrap gap-2 mb-3">
                <Button size="sm" variant="outline" asChild><Link to="/student/mistakes">Mistake book</Link></Button>
                <Button size="sm" variant="outline" asChild><Link to="/student/recovery">Recovery zone</Link></Button>
                <Button size="sm" variant="outline" asChild><Link to="/student/practice/math12">Practice this topic</Link></Button>
              </div>

              <Button
                size="sm"
                variant={hasGeminiPlan ? "outline" : "default"}
                disabled={enhancing === key}
                onClick={() => enhanceWithAI(p)}
              >
                {enhancing === key ? (
                  <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Generating…</>
                ) : (
                  <><Sparkles className="w-4 h-4 mr-1" /> {hasGeminiPlan ? "Refresh plan" : "Personalize plan"}</>
                )}
              </Button>
            </Card>
          );
        })}
      </div>
      )}
    </>
  );
}
