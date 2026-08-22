import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchRevisionPlan } from "@/lib/academicBrain";
import { runRevisionAgent } from "@/lib/academicAgents";
import { useAcademicBrain } from "@/hooks/useAcademicBrain";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FlowPage,
  FlowSectionTitle,
  FlowTopBar,
} from "@/components/student/flow/FlowDesign";
import { ListChecks, Check, Info, Clock, Loader2 } from "lucide-react";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { toast } from "sonner";
import { displayChapter, displayConcept, displayTopic } from "@/lib/academicDisplay";

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
    try {
      const { PracticeService, resolveStudentServiceContext } = await import("@/academic");
      const ctx = await resolveStudentServiceContext();
      await PracticeService.completeRevision(ctx, id);
      setRows((prev) => prev.filter((r) => r.id !== id));
      toast.success("Revision done!");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not complete revision");
    } finally {
      setCompletingId(null);
    }
  };

  const priorityTone = (label?: string) => {
    if (label === "High") return "destructive";
    if (label === "Medium") return "default";
    return "secondary";
  };

  const displayTodayPlan = todayPlan;
  const displayRows = rows;
  const displayCoachHeadline = coachHeadline;

  const hasContent =
    displayRows.length > 0 || brainPriorities.length > 0 || displayTodayPlan.length > 0;

  return (
    <FlowPage>
      <FlowTopBar backTo="/student" />

      <section className="sp-hero rounded-3xl overflow-hidden shadow-elevated bg-[#074b37] text-white p-6 sm:p-8 relative">
        <div className="absolute top-0 right-0 w-40 h-40 bg-[#b2f0d4]/15 rounded-full blur-2xl pointer-events-none" />
        <div className="relative z-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-white/70">Revision Center</p>
          <h1 className="font-['Sora'] text-2xl sm:text-3xl font-semibold mt-2 tracking-tight">Your study queue</h1>
          <p className="text-sm text-white/75 mt-2 max-w-lg">
            Prioritized from weak concepts, mistake history, and recovery gaps — not random questions.
          </p>
        </div>
      </section>

      {displayCoachHeadline && (
        <section className="rounded-2xl border border-[#97d3b8]/40 bg-[#defaeb] p-5 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#074b37]">Coach note</p>
          <p className="text-sm font-medium text-foreground mt-1">{displayCoachHeadline}</p>
        </section>
      )}

      {sortNote && (
        <p className="text-xs text-muted-foreground flex items-start gap-1.5">
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
        <section className="rounded-2xl border border-border/60 bg-card p-8 text-center shadow-sm">
          <ListChecks className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-muted-foreground">
            Nothing queued yet. Complete practice or DPPs — revision builds from your academic profile.
          </p>
          <div className="flex gap-2 justify-center mt-4">
            <Button asChild><Link to="/student/practice/math12">Start practice</Link></Button>
            <Button asChild variant="outline"><Link to="/student/recovery">Recovery zone</Link></Button>
          </div>
        </section>
      ) : (
        <div className="space-y-6">
          {displayTodayPlan.length > 0 && (
            <section>
              <FlowSectionTitle>
                <span className="inline-flex items-center gap-1.5">
                  <Clock className="w-4 h-4" /> Today&apos;s plan
                </span>
              </FlowSectionTitle>
              <div className="space-y-2">
                {displayTodayPlan.map((p, i) => (
                  <div key={i} className="sp-stat-card rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{displayTopic(p.topic)}</div>
                        <div className="text-sm text-muted-foreground">
                          {[p.chapter ? displayChapter(p.chapter) : null, p.subject].filter(Boolean).join(" · ")}
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
                  </div>
                ))}
              </div>
            </section>
          )}

          {displayRows.length > 0 && (
            <section>
              <FlowSectionTitle>Revision queue</FlowSectionTitle>
              <div className="space-y-2">
                {displayRows.map((r) => (
                  <div key={r.id} className="sp-stat-card rounded-2xl border border-border/60 bg-card p-4 flex items-center justify-between gap-3 shadow-sm">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold">{r.subject}</div>
                      <div className="text-sm text-muted-foreground">
                        {[r.chapter ? displayChapter(r.chapter) : null, r.topic ? displayTopic(r.topic) : null].filter(Boolean).join(" · ")}
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
                      className="shrink-0 rounded-full"
                      disabled={completingId === r.id}
                      onClick={() => complete(r.id)}
                    >
                      {completingId === r.id ? (
                        <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Saving…</>
                      ) : (
                        <><Check className="w-4 h-4 mr-1" /> Done</>
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {brainPriorities.length > 0 && displayRows.length === 0 && (
            <section>
              <FlowSectionTitle>Weak concept priorities</FlowSectionTitle>
              <div className="space-y-2">
                {brainPriorities.map((bp, i) => (
                  <div key={i} className="sp-stat-card rounded-2xl border border-border/60 bg-card p-4 shadow-sm">
                    <div className="font-semibold">{displayConcept(bp.concept)}</div>
                    <div className="text-sm text-muted-foreground">{bp.subject}{bp.chapter ? ` · ${displayChapter(bp.chapter)}` : ""}</div>
                    <p className="text-sm mt-2">{bp.action ?? "Review and practice"}</p>
                    <div className="mt-2">
                      <Button size="sm" variant="outline" className="rounded-full" asChild>
                        <Link to={`/student/recovery?fix=1&subject=${encodeURIComponent(bp.subject)}&chapter=${encodeURIComponent(bp.chapter ?? "")}&concept=${encodeURIComponent(bp.concept)}`}>
                          Start recovery
                        </Link>
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </FlowPage>
  );
}
