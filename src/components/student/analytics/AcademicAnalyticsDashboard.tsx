import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { StudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { AnalyticsStudio } from "@/components/student/analytics/AnalyticsStudio";

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
  chartsLoading?: boolean;
};

/** Student analysis — 6-section flow layout. */
export function AcademicAnalyticsDashboard({ data, charts, chartsLoading }: Props) {
  return <AnalyticsStudio data={data} charts={charts} chartsLoading={chartsLoading} />;
}
