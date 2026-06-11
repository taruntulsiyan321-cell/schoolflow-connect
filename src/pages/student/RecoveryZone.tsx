import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { fetchMostRecentPracticeMistake } from "@/lib/mistakeRecovery";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FlowConceptPanel,
  FlowConceptTag,
  FlowPage,
  FlowRecoveryCard,
  FlowSectionTitle,
  FlowStatGrid,
  FlowTopBar,
} from "@/components/student/flow/FlowDesign";
import { useRecoveryZone } from "@/hooks/useRecoveryZone";
import { BookMarked, Loader2, Target } from "lucide-react";
import { toast } from "sonner";
import { StudentDashboardSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";

const severityTone: Record<string, string> = {
  severe: "destructive",
  moderate: "default",
  minor: "outline",
};

export default function RecoveryZone() {
  const { data, loading, error, reload } = useRecoveryZone();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [hasPracticeMistakes, setHasPracticeMistakes] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [topicFixAttempted, setTopicFixAttempted] = useState(false);

  useEffect(() => {
    fetchMostRecentPracticeMistake().then((m) => setHasPracticeMistakes(!!m));
  }, [data?.open_assignments?.length]);

  useEffect(() => {
    if (topicFixAttempted || loading || searchParams.get("fix") !== "1") return;
    const subject = searchParams.get("subject");
    const concept = searchParams.get("concept");
    if (!subject || !concept) return;

    setTopicFixAttempted(true);
    setFixing(true);
    (async () => {
      try {
        const { data: aid, error: assignErr } = await (supabase as any).rpc(
          "rpc_assign_concept_recovery",
          {
            _subject: subject,
            _chapter: searchParams.get("chapter") || null,
            _concept: concept,
            _subconcept: null,
            _accuracy: 35,
            _source_type: "analytics",
            _source_id: null,
          },
        );
        if (assignErr) {
          toast.error(assignErr.message);
          return;
        }
        if (aid) navigate(`/student/recovery/${aid}`, { replace: true });
      } finally {
        setFixing(false);
      }
    })();
  }, [loading, navigate, searchParams, topicFixAttempted]);

  const handleFixMistakes = async () => {
    const assignments = data?.open_assignments ?? [];
    if (assignments[0]) {
      navigate(`/student/recovery/${assignments[0].id}`);
      return;
    }

    setFixing(true);
    try {
      const m = await fetchMostRecentPracticeMistake();
      if (!m) {
        toast.info("No practice mistakes yet — try Practice first.");
        return;
      }

      const { data: aid, error: assignErr } = await (supabase as any).rpc(
        "rpc_assign_concept_recovery",
        {
          _subject: m.subject,
          _chapter: m.chapter ?? null,
          _concept: m.concept ?? m.topic ?? m.chapter ?? null,
          _subconcept: null,
          _accuracy: 35,
          _source_type: "practice",
          _source_id: m.id,
        },
      );

      if (assignErr) {
        toast.error(assignErr.message);
        return;
      }
      if (aid) navigate(`/student/recovery/${aid}`);
    } finally {
      setFixing(false);
    }
  };

  if (loading) {
    return (
      <FlowPage>
        <FlowTopBar backTo="/student" />
        <StudentDashboardSkeleton />
      </FlowPage>
    );
  }

  if (error) {
    return (
      <FlowPage>
        <FlowTopBar backTo="/student" />
        <StudentErrorState
          title="Recovery Zone unavailable"
          message={error}
          onRetry={reload}
        />
      </FlowPage>
    );
  }

  const pending = data?.pending_count ?? 0;
  const assignments = data?.open_assignments ?? [];
  const weak = data?.weak_concepts ?? [];

  return (
    <FlowPage>
      <FlowTopBar
        backTo="/student"
        action={
          <Button size="sm" variant="ghost" className="h-9" asChild>
            <Link to="/student/mistakes">Mistake book</Link>
          </Button>
        }
      />

      <FlowRecoveryCard
        count={pending}
        weakConcepts={weak.slice(0, 6).map((w) => w.concept)}
        ctaLabel={fixing ? "Starting…" : "Fix my mistakes"}
        subtitle="Targeted practice on weak concepts"
        onCtaClick={assignments[0] || hasPracticeMistakes ? handleFixMistakes : undefined}
        ctaDisabled={fixing || (!assignments[0] && !hasPracticeMistakes)}
      />

      <div className="flex flex-wrap gap-2 -mt-4 justify-center sm:justify-start">
        <Button variant="outline" className="rounded-full" asChild>
          <Link to="/student/revision">Revision queue</Link>
        </Button>
      </div>

      <section>
        <FlowSectionTitle>Overview</FlowSectionTitle>
        <FlowStatGrid
          columns={3}
          items={[
            { label: "Open recovery", value: pending },
            { label: "Weak concepts", value: weak.length },
            { label: "Assignments", value: assignments.length },
          ]}
        />
      </section>

      <FlowConceptPanel
        title="Weak concepts"
        icon={<Target className="w-4 h-4" />}
        variant="weak"
        empty="Wrong answers in practice build this list automatically."
      >
        {weak.map((w, i) => (
          <FlowConceptTag
            key={i}
            label={w.concept}
            meta={`${w.subject}${w.chapter ? ` · ${w.chapter}` : ""} · ${Math.round(w.mastery_score)}%`}
            variant="weak"
          />
        ))}
      </FlowConceptPanel>

      <section className="rounded-2xl border border-border/60 bg-card p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-4">
          <BookMarked className="w-4 h-4" /> Recovery assignments
        </p>
        {assignments.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Complete practice — weak concepts auto-generate recovery work here.
          </p>
        ) : (
          <div className="space-y-2">
            {assignments.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl border border-border/60 bg-muted/20"
              >
                <div className="min-w-0">
                  <div className="font-medium text-sm">{a.concept}</div>
                  <div className="text-xs text-muted-foreground">
                    {a.subject}
                    {a.chapter ? ` · ${a.chapter}` : ""} · {a.questions_completed}/{a.question_count} done
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={severityTone[a.severity] as "destructive" | "default" | "outline"}>
                    {a.severity}
                  </Badge>
                  <Button size="sm" className="rounded-full" asChild>
                    <Link to={`/student/recovery/${a.id}`}>Start</Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </FlowPage>
  );
}
