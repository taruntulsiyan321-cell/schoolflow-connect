import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { AnalyticsStudio } from "@/components/student/analytics/AnalyticsStudio";
import { StudentAnalyticsSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";
import { FileText } from "lucide-react";

export default function AcademicAnalytics() {
  const { data, loading, error: snapError, reload: reloadSnap } = useStudentAcademicSnapshot();
  const { data: charts, loading: chartsLoading, error: chartsError } = useStudentPerformanceCharts();

  return (
    <div className="max-w-5xl mx-auto px-3 sm:px-4 py-4 sm:py-6">
      <div className="flex justify-end mb-3 print:hidden">
        <Button
          size="sm"
          variant="ghost"
          asChild
          className="text-muted-foreground h-9 hover:text-foreground"
        >
          <Link to="/student/report">
            <FileText className="w-4 h-4 mr-1" /> Report
          </Link>
        </Button>
      </div>

      {loading && <StudentAnalyticsSkeleton />}

      {!loading && snapError && (
        <StudentErrorState
          title="Analysis could not load"
          message={snapError}
          onRetry={reloadSnap}
        />
      )}

      {!loading && !snapError && data && (
        <AnalyticsStudio
          data={data}
          charts={chartsError ? null : charts}
          chartsLoading={chartsLoading}
        />
      )}
    </div>
  );
}
