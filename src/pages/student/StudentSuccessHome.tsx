import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { StudentMissionDashboard } from "@/components/student/dashboard/StudentMissionDashboard";
import { StudentDashboardSkeleton, StudentErrorState } from "@/components/student/StudentPanelStates";

export default function StudentSuccessHome() {
  const { data, loading, error, reload } = useStudentAcademicSnapshot();

  if (loading) return <StudentDashboardSkeleton />;

  if (error) {
    return (
      <StudentErrorState
        title="Could not load your dashboard"
        hint="If this is a new setup, apply pending database migrations in Supabase."
        message={error}
        onRetry={reload}
      />
    );
  }

  const firstName = data?.student?.full_name ?? "Student";

  return <StudentMissionDashboard studentName={firstName} />;
}
