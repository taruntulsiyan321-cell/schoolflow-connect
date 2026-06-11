import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { AcademicAnalyticsDashboard } from "@/components/student/analytics/AcademicAnalyticsDashboard";
import { AnalyticsEmptyState } from "@/components/student/AnalyticsEmptyState";
import { StudentAnalyticsSkeleton } from "@/components/student/StudentPanelStates";
import { ArrowLeft, FileText } from "lucide-react";

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="p-6 text-center mb-4 shadow-card">
      <p className="text-sm text-muted-foreground mb-2">Analytics could not load fully.</p>
      <p className="text-xs text-destructive mb-3">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
    </Card>
  );
}

export default function AcademicAnalytics() {
  const { data, loading, error: snapError, reload: reloadSnap } = useStudentAcademicSnapshot();
  const { data: charts, loading: chartsLoading, error: chartsError, reload: reloadCharts } = useStudentPerformanceCharts();

  const busy = loading || chartsLoading;

  const hasChartData =
    (charts?.subjects?.length ?? 0) > 0 ||
    (charts?.weekly_activity?.length ?? 0) > 0 ||
    (charts?.dpp_trend?.length ?? 0) > 0 ||
    (charts?.practice_trend?.length ?? 0) > 0;

  const hasSnapshotActivity =
    (data?.exam_readiness?.score ?? 0) > 0 ||
    (data?.xp?.total_battles ?? 0) > 0 ||
    (data?.self_practice?.sessions_completed ?? 0) > 0 ||
    (data?.mistake_count ?? 0) > 0;

  const showEmpty = !busy && !snapError && !chartsError && !hasChartData && !hasSnapshotActivity;

  return (
    <div className="analytics-page max-w-3xl mx-auto pb-12">
      <div className="flex items-center justify-between mb-4">
        <Button variant="ghost" size="sm" asChild className="-ml-2 text-muted-foreground">
          <Link to="/student"><ArrowLeft className="w-4 h-4" /> Back</Link>
        </Button>
        <Button size="sm" variant="ghost" asChild className="text-muted-foreground">
          <Link to="/student/report"><FileText className="w-4 h-4 mr-1" /> Report</Link>
        </Button>
      </div>

      {busy && <StudentAnalyticsSkeleton />}

      {!busy && snapError && <ErrorCard message={snapError} onRetry={reloadSnap} />}
      {!busy && chartsError && <ErrorCard message={chartsError} onRetry={reloadCharts} />}
      {!busy && showEmpty && <AnalyticsEmptyState />}

      {!busy && !showEmpty && data && (
        <AcademicAnalyticsDashboard data={data} charts={charts} />
      )}
    </div>
  );
}
