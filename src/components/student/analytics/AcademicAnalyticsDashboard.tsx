import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { StudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { AnalyticsStudio } from "@/components/student/analytics/AnalyticsStudio";

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
};

/** Analytics UI — soft daylight study studio layout. */
export function AcademicAnalyticsDashboard({ data, charts }: Props) {
  return <AnalyticsStudio data={data} charts={charts} />;
}
