import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchRevisionPlan } from "@/lib/academicBrain";
import { runRevisionAgent } from "@/lib/academicAgents";
import { useAcademicBrain } from "@/hooks/useAcademicBrain";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui-bits";
import { ListChecks, Check, Info, Clock, Loader2 } from "lucide-react";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { toast } from "sonner";

type RevisionItem = {
  id: string;
  subject: string;
  chapter?: string;
  topic?: string;
  reason?: string;
  priority: number;
  due_date: string;
  priority_label?: string;
  sort_factors?: string[];
  source?: string;
};

type BrainPriority = {
  concept: string;
  subject: string;
  chapter?: string;
  mastery_score?: number;
  priority: number;
  action?: string;
  source?: string;
};

type TodayPlanItem = {
  topic: string;
  subject: string;
  chapter?: string;
  time_minutes: number;
  action: string;
  priority: number;
  reason?: string;
};

export default function RevisionQueue() {
  const { brain } = useAcademicBrain();
  const [rows, setRows] = useState<RevisionItem[]>([]);
  const [brainPriorities, setBrainPriorities] = useState<BrainPriority[]>([]);
  const [todayPlan, setTodayPlan] = useState<TodayPlanItem[]>([]);
  const [sortNote, setSortNote] = useState("");
  const [coachHeadline, setCoachHeadline] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const plan = await fetchRevisionPlan();
      setRows((plan.queue_items ?? []) as RevisionItem[]);
      setBrainPriorities((plan.brain_priorities ?? []) as BrainPriority[]);
      setSortNote(plan.sort_note ?? "");

      if (brain) {
        const revisionInsight = await runRevisionAgent(brain, plan);
        setTodayPlan(revisionInsight.today_plan ?? []);
        setCoachHeadline(revisionInsight.headline ?? "");
      }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load revision plan");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (brain) load();
  }, [brain?.updated_at]);

  const complete = async (id: string) => {
    if (completingId) return;
    setCompletingId(id);
    const { error } = await supabase.rpc("rpc_complete_revision", { _id: id });
    if (error) {
      toast.error(error.message);
      setCompletingId(null);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
    toast.success("Revision done!");
    setCompletingId(null);
  };

  const priorityTone = (label?: string) => {
    if (label === "High") return "destructive";
    if (label === "Medium") return "default";
    return "secondary";
  };

  const hasContent = rows.length > 0 || brainPriorities.length > 0 || todayPlan.length > 0;

  return (
    <>
      <PageHeader
        title="Revision Center"
        subtitle="Prioritized from weak concepts, mistake history, and recovery gaps — not random questions"
      />

      {coachHeadline && (
        <Card className="p-4 mb-4 bg-primary/5 border-primary/20">
          <p className="text-sm font-medium">{coachHeadline}</p>
        </Card>
      )}

      {sortNote && (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5 mb-4">
          <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          {sortNote}
        </p>
      )}

      {loading ? (
        <StudentListSkeleton rows={5} />
      ) : loadError ? (
        <StudentErrorState
          title="Could not load revision plan"
          message={loadError}
          onRetry={load}
        />
      ) : !hasContent ? (
        <Card className="p-8 text-center">
          <ListChecks className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">
            Nothing queued yet. Complete practice or DPPs — revision builds from your academic profile.
          </p>
          <div className="flex gap-2 justify-center mt-4">
            <Button asChild><Link to="/student/dpp">Start a DPP</Link></Button>
            <Button asChild variant="outline"><Link to="/student/recovery">Recovery zone</Link></Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-6">
          {todayPlan.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                <Clock className="w-4 h-4" /> Today&apos;s plan
              </h2>
              <div className="space-y-2">
                {todayPlan.map((p, i) => (
                  <Card key={i} className="p-4 shadow-card">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{p.topic}</div>
                        <div className="text-sm text-muted-foreground">
                          {[p.chapter, p.subject].filter(Boolean).join(" · ")}
                        </div>
                        <p className="text-sm mt-2">{p.action}</p>
                        {p.reason && (
                          <p className="text-xs text-muted-foreground mt-1">{p.reason}</p>
                        )}
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {p.time_minutes} min
                      </Badge>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {rows.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Revision queue
              </h2>
              <div className="space-y-2">
                {rows.map((r) => (
                  <Card key={r.id} className="p-4 flex items-center justify-between gap-3 shadow-card">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{r.subject}</div>
                      <div className="text-sm text-muted-foreground">
                        {[r.chapter, r.topic].filter(Boolean).join(" · ")}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        <Badge variant={priorityTone(r.priority_label) as "default" | "destructive" | "secondary"}>
                          {r.priority_label ?? "Medium"} · {r.priority}
                        </Badge>
                        <span className="text-xs text-muted-foreground">Due {r.due_date}</span>
                      </div>
                      {r.reason && (
                        <p className="text-xs text-muted-foreground mt-1">{r.reason}</p>
                      )}
                    </div>
                    <Button
                      size="sm"
                      className="shrink-0"
                      disabled={completingId === r.id}
                      onClick={() => complete(r.id)}
                    >
                      {completingId === r.id ? (
                        <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Saving…</>
                      ) : (
                        <><Check className="w-4 h-4 mr-1" /> Done</>
                      )}
                    </Button>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {brainPriorities.length > 0 && rows.length === 0 && (
            <section>
              <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Weak concept priorities
              </h2>
              <div className="space-y-2">
                {brainPriorities.map((bp, i) => (
                  <Card key={i} className="p-4 shadow-card">
                    <div className="font-semibold">{bp.concept}</div>
                    <div className="text-sm text-muted-foreground">{bp.subject}{bp.chapter ? ` · ${bp.chapter}` : ""}</div>
                    <p className="text-sm mt-2">{bp.action ?? "Review and practice"}</p>
                    <div className="mt-2">
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/student/recovery?fix=1&subject=${encodeURIComponent(bp.subject)}&chapter=${encodeURIComponent(bp.chapter ?? "")}&concept=${encodeURIComponent(bp.concept)}`}>
                          Start recovery
                        </Link>
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
