import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ArrowLeft } from "lucide-react";
import { RecoveryCompletionReportView } from "@/components/student/recovery/RecoveryCompletionReportView";
import { StudentListSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useRecoveryZone } from "@/hooks/useRecoveryZone";
import { useAcademicContext } from "@/academic";
import { DecisionEngineService } from "@/academic/services/decisionEngineService";
import { DECISION_ENGINE_FEATURE_FLAGS } from "@/lib/productFeatureFlags";
import { buildRecoveryCompletionReport, appendSuccessHistory } from "@/lib/recoveryCompletionReport";
import { readRecoveryResultState } from "@/lib/recoverySessionSnapshot";

export default function RecoveryCompletionReportPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { items: mastery, loading: masteryLoading } = useConceptMastery();
  const { data: snapshot, loading: snapLoading } = useStudentAcademicSnapshot();
  const { data: recoveryZone, loading: zoneLoading } = useRecoveryZone();
  const { ctx, ready: academicReady } = useAcademicContext();

  // Decision Engine Slice 1 swap-in for the "next weak concept" suggestion
  // -- reuses the same weakAreasV2 flag already live for Practice.tsx (one
  // rollout, not a per-consumer toggle), calling the already-verified
  // DecisionEngineService.getWeakAreasV2 directly. No new RPC, no new flag.
  const [v2WeakConcepts, setV2WeakConcepts] = useState<{ concept: string; mastery_score?: number }[] | null>(null);
  useEffect(() => {
    if (!DECISION_ENGINE_FEATURE_FLAGS.weakAreasV2 || !ctx || !academicReady) return;
    let cancelled = false;
    DecisionEngineService.getWeakAreasV2(ctx)
      .then((recs) => {
        if (cancelled) return;
        setV2WeakConcepts(recs.map((r) => ({ concept: r.concept, mastery_score: r.understanding ?? undefined })));
      })
      .catch((e) => {
        if (cancelled) return;
        // Optional/cosmetic suggestion, not core report content -- log and
        // show no suggestion rather than threading a new error UI through
        // the whole report. Does NOT fall back to the legacy
        // rpc_student_recovery_zone data on failure -- an empty result is
        // honest about V2 having failed, not a silent V1 substitution.
        console.warn("[RecoveryCompletionReportPage] getWeakAreasV2 failed:", e instanceof Error ? e.message : e);
        setV2WeakConcepts([]);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, academicReady]);
  const weakConcepts = useMemo(
    () =>
      DECISION_ENGINE_FEATURE_FLAGS.weakAreasV2
        ? (v2WeakConcepts ?? [])
        : (recoveryZone?.weak_concepts ?? []),
    [v2WeakConcepts, recoveryZone?.weak_concepts],
  );

  const localState = useMemo(() => {
    const fromNav = location.state as ReturnType<typeof readRecoveryResultState>;
    if (fromNav?.attempts?.length) return fromNav;
    if (id) return readRecoveryResultState(id);
    return null;
  }, [location.state, id]);

  const loading = masteryLoading || snapLoading || zoneLoading;

  const report = useMemo(() => {
    if (!localState) return null;
    const nextWeak = weakConcepts.find(
      (w) => w.concept !== localState.concept,
    )?.concept;
    return buildRecoveryCompletionReport({
      state: localState,
      mastery,
      snapshot,
      weakConcepts,
      nextWeakConcept: nextWeak,
    });
  }, [localState, mastery, snapshot, weakConcepts]);

  const historySaved = useRef(false);
  useEffect(() => {
    if (!report || historySaved.current) return;
    historySaved.current = true;
    appendSuccessHistory({
      topic: report.concept,
      gain: report.hero.masteryAfter - report.hero.masteryBefore,
      completedAt: report.completedAt,
    });
  }, [report]);

  if (!id) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground">Invalid recovery session.</p>
        <Button asChild className="mt-4"><Link to="/student/recovery">Recovery Center</Link></Button>
      </Card>
    );
  }

  if (loading && !localState) {
    return <StudentListSkeleton rows={6} />;
  }

  if (!localState) {
    return (
      <>
        <Button variant="ghost" size="sm" asChild className="mb-2">
          <Link to="/student/recovery"><ArrowLeft className="w-4 h-4" /> Recovery</Link>
        </Button>
        <StudentErrorState
          title="Recovery report not found"
          message="Complete a recovery session first, or your session data may have expired."
          onRetry={() => window.location.reload()}
        />
        <div className="flex justify-center mt-4">
          <Button asChild><Link to="/student/recovery">Go to Recovery Center</Link></Button>
        </div>
      </>
    );
  }

  if (!report) {
    return <StudentListSkeleton rows={6} />;
  }

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2 print:hidden">
        <Link to="/student/recovery"><ArrowLeft className="w-4 h-4" /> Recovery Center</Link>
      </Button>
      <RecoveryCompletionReportView report={report} />
    </>
  );
}
