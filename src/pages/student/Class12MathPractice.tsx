import { Navigate } from "react-router-dom";
import PracticeHubPage from "@/components/student/practice/PracticeHubPage";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { parseClassLevel } from "@/lib/curriculumScope";
import { StudentListSkeleton } from "@/components/student/StudentPanelStates";

/** Class-12 Math bank — only for students whose class SSOT resolves to 12. */
export default function Class12MathPractice() {
  const { classLabel, settled, ready } = useAcademicContext();
  if (!settled) return <StudentListSkeleton />;
  const level = parseClassLevel(classLabel);
  if (ready && level != null && level !== 12) {
    return <Navigate to="/student/practice" replace />;
  }
  return <PracticeHubPage />;
}
