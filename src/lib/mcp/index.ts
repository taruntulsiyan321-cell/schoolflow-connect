import { auth, defineMcp } from "@lovable.dev/mcp-js";
import whoamiTool from "./tools/whoami";
import listClassesTool from "./tools/list-classes";
import listStudentsTool from "./tools/list-students";
import attendanceSummaryTool from "./tools/attendance-summary";
import studentMarksTool from "./tools/student-marks";
import listHomeworkTool from "./tools/list-homework";
import listNoticesTool from "./tools/list-notices";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "schoolflow-connect",
  title: "SchoolFlow Connect",
  version: "0.1.0",
  instructions:
    "Read-only tools for SchoolFlow Connect, a school management platform. " +
    "Call `whoami` first to learn the signed-in user's role. " +
    "All data access respects the app's per-user permissions: admins and principals see the whole school, " +
    "teachers see their classes, students and parents see their own records.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [
    whoamiTool,
    listClassesTool,
    listStudentsTool,
    attendanceSummaryTool,
    studentMarksTool,
    listHomeworkTool,
    listNoticesTool,
  ],
});
