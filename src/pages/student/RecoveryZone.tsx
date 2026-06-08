import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { ConceptMastery } from "@/components/student/ConceptMastery";
import { useRecoveryZone } from "@/hooks/useRecoveryZone";
import { AlertTriangle, BookMarked, ListChecks, Target, Wrench } from "lucide-react";
import { StudentDashboardSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";

const severityTone: Record<string, string> = {
  severe: "destructive",
  moderate: "default",
  minor: "outline",
};

export default function RecoveryZone() {
  const { data, loading, error, reload } = useRecoveryZone();

  if (loading) {
    return (
      <>
        <PageHeader eyebrow="Mistake recovery" title="Recovery Zone" subtitle="Loading…" />
        <StudentDashboardSkeleton />
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader eyebrow="Mistake recovery" title="Recovery Zone" />
        <StudentErrorState
          title="Recovery Zone unavailable"
          hint="Apply the concept mastery migration in Supabase if this is a new setup."
          message={error}
          onRetry={reload}
        />
      </>
    );
  }

  const pending = data?.pending_count ?? 0;
  const assignments = data?.open_assignments ?? [];
  const weak = data?.weak_concepts ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Mistake recovery"
        title="Recovery Zone"
        subtitle="Targeted practice on weak NCERT concepts — fix mistakes before they become exam gaps"
      />

      <Card className="hero-panel p-5 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-[11px] uppercase tracking-wide text-white/70">Recovery questions pending</div>
            <div className="text-3xl font-bold mt-1">{pending}</div>
            <div className="text-sm text-white/80 mt-1">
              {pending > 0 ? "Concepts waiting for you to fix" : "You're caught up — great work!"}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            {assignments[0] && (
              <Button size="sm" asChild>
                <Link to={`/student/recovery/${assignments[0].id}`}>
                  <Wrench className="w-4 h-4 mr-1" /> Fix my mistakes
                </Link>
              </Button>
            )}
            <Button size="sm" variant="secondary" asChild><Link to="/student/mistakes">Mistake book</Link></Button>
            <Button size="sm" variant="secondary" asChild><Link to="/student/revision">Revision queue</Link></Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        <StatCard icon={<Target className="w-5 h-5" />} label="Open recovery" value={String(pending)} tone={pending > 0 ? "warning" : "accent"} />
        <StatCard icon={<AlertTriangle className="w-5 h-5" />} label="Weak concepts" value={String(weak.length)} />
        <StatCard icon={<ListChecks className="w-5 h-5" />} label="Assignments" value={String(assignments.length)} />
      </div>

      <div className="grid lg:grid-cols-2 gap-4 mb-6">
        <Card className="p-4 shadow-card">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-warning" /> Weak concepts
          </h3>
          {weak.length === 0 && (
            <p className="text-sm text-muted-foreground">No weak concepts tracked yet. Wrong answers in DPP, battles, and practice build this list.</p>
          )}
          <div className="space-y-2">
            {weak.map((w, i) => (
              <div key={i} className="flex justify-between items-center p-2 rounded-lg bg-warning/10 border border-warning/20">
                <div>
                  <div className="font-medium text-sm">{w.concept}</div>
                  <div className="text-xs text-muted-foreground">{w.subject}{w.chapter ? ` · ${w.chapter}` : ""}</div>
                </div>
                <Badge variant="outline">{Math.round(w.mastery_score)}% mastery</Badge>
              </div>
            ))}
          </div>
        </Card>

        <ConceptMastery limit={6} />
      </div>

      <Card className="p-4 shadow-card">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <BookMarked className="w-4 h-4 text-primary" /> Recovery assignments
        </h3>
        {assignments.length === 0 && (
          <p className="text-sm text-muted-foreground">Complete a DPP, battle, or practice session — weak concepts auto-generate recovery work here.</p>
        )}
        <div className="space-y-3">
          {assignments.map((a) => (
            <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-lg border">
              <div>
                <div className="font-medium text-sm">{a.concept}</div>
                <div className="text-xs text-muted-foreground">{a.subject}{a.chapter ? ` · ${a.chapter}` : ""}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {a.questions_completed}/{a.question_count} done
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={severityTone[a.severity] as "destructive" | "default" | "outline"}>{a.severity}</Badge>
                <Button size="sm" asChild>
                  <Link to={`/student/recovery/${a.id}`}>Start</Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
