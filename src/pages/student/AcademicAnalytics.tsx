import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { AcademicAnalyticsDashboard } from "@/components/student/analytics/AcademicAnalyticsDashboard";
import { FlowPage, FlowTopBar } from "@/components/student/flow/FlowDesign";
import { StudentAnalyticsSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { FileText } from "lucide-react";

export default function AcademicAnalytics() {
  const { data, loading, error: snapError, reload: reloadSnap } = useStudentAcademicSnapshot();
  const { data: charts, loading: chartsLoading, error: chartsError } = useStudentPerformanceCharts();

  return (
    <FlowPage className="max-w-6xl">
      <FlowTopBar
        action={
          <Button size="sm" variant="ghost" asChild className="text-muted-foreground h-9">
            <Link to="/student/analysis">
              <FileText className="w-4 h-4 mr-1" /> Report
            </Link>
          </Button>
        }
      />

      {loading && <StudentAnalyticsSkeleton />}

      {!loading && snapError && (
        <StudentErrorState
          title="Analysis could not load"
          message={snapError}
          onRetry={reloadSnap}
        />
      )}

      {!loading && !snapError && data && (
        <AcademicAnalyticsDashboard
          data={data}
          charts={chartsError ? null : charts}
          chartsLoading={chartsLoading}
        />
      )}
    </FlowPage>
  );
}
