import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { StudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { AnalyticsDossier } from "@/components/student/analytics/AnalyticsDossier";

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
};

/** Analytics UI — editorial performance dossier layout. */
export function AcademicAnalyticsDashboard({ data, charts }: Props) {
  return <AnalyticsDossier data={data} charts={charts} />;
}
