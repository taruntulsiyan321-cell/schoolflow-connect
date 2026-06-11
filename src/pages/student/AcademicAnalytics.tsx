import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-bits";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { AcademicAnalyticsDashboard } from "@/components/student/analytics/AcademicAnalyticsDashboard";
import { AnalyticsEmptyState } from "@/components/student/AnalyticsEmptyState";
import { StudentAnalyticsSkeleton } from "@/components/student/StudentPanelStates";
import { ArrowLeft, FileText } from "lucide-react";

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="p-6 text-center mb-4 shadow-card">
      <p className="text-sm text-muted-foreground mb-2">
        Part of analytics could not be loaded. Apply pending Supabase migrations if this is a new environment.
      </p>
      <p className="text-xs text-destructive mb-3">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
    </Card>
  );
}

export default function AcademicAnalytics() {
  const { data, loading, error: snapError, reload: reloadSnap } = useStudentAcademicSnapshot();
  const { data: charts, loading: chartsLoading, error: chartsError, reload: reloadCharts } = useStudentPerformanceCharts();

  const busy = loading || chartsLoading;
  const firstName = data?.student?.full_name?.split(" ")[0] ?? "Student";

  const hasChartData =
    (charts?.subjects?.length ?? 0) > 0 ||
    (charts?.weekly_activity?.length ?? 0) > 0 ||
    (charts?.dpp_trend?.length ?? 0) > 0 ||
    (charts?.practice_trend?.length ?? 0) > 0;

  const hasSnapshotActivity =
    (data?.exam_readiness?.score ?? 0) > 0 ||
    (data?.xp?.total_battles ?? 0) > 0 ||
    (data?.self_practice?.sessions_completed ?? 0) > 0 ||
    (data?.weak_topics?.length ?? 0) > 0 ||
    (data?.strong_topics?.length ?? 0) > 0 ||
    (data?.mistake_count ?? 0) > 0;

  const showEmpty = !busy && !snapError && !chartsError && !hasChartData && !hasSnapshotActivity;

  return (
    <div className="max-w-6xl mx-auto">
      <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
        <Link to="/student"><ArrowLeft className="w-4 h-4" /> Dashboard</Link>
      </Button>

      <PageHeader
        eyebrow="Performance"
        title="Analytics"
        subtitle={`Clear picture of how ${firstName} is progressing across subjects, practice, and exams`}
        action={
          <Button size="sm" variant="outline" asChild>
            <Link to="/student/report"><FileText className="w-4 h-4 mr-1" /> Report</Link>
          </Button>
        }
      />

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
