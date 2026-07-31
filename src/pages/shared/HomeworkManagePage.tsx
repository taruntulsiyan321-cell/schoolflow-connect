import { Navigate } from "react-router-dom";

/**
 * Legacy shared homework page — Academic Engine homework lives in
 * Teacher My Classes → Homework tab (LiveHomeworkPanels via HomeworkService).
 * Do not query Supabase from UI here.
 */
export default function HomeworkManagePage() {
  return <Navigate to="/teacher/classes" replace />;
}
