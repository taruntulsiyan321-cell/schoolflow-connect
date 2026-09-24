import type { AppRole, PortalRole } from "./types";

/** Human-readable role labels */
export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin",
  admin: "School Admin",
  principal: "Principal",
  teacher: "Teacher",
  student: "Student",
  parent: "Parent",
};

/** Dashboard path for each portal role */
export const ROLE_HOME: Record<PortalRole, string> = {
  admin: "/admin",
  principal: "/principal",
  teacher: "/teacher",
  student: "/student",
  parent: "/parent",
};

/** Which roles may enter which route prefixes */
export const ROUTE_ALLOW: Record<string, AppRole[]> = {
  "/admin": ["admin", "super_admin"],
  "/principal": ["principal"],
  "/teacher": ["teacher"],
  "/student": ["student"],
  "/parent": ["parent"],
};

/** Module keys for the /admin panel — shared by admin and super_admin, since
 *  super_admin is also routed into /admin (see ROUTE_ALLOW above). */
const ADMIN_PANEL_MODULES = [
  "dashboard",
  "students",
  "teachers",
  "parents",
  "classes",
  "announcements",
  "examinations",
  "leave",
  "reports",
  "settings",
  "account_linking",
] as const;

/** Modules allowed per role (for future fine-grained UI gating) */
export const ROLE_MODULES: Record<AppRole, readonly string[]> = {
  // `question_review` is super-admin ONLY: §10.20 gives "Manage the central
  // question bank" to them, and §10.9 makes the bank central, so one approval
  // decides what students at every school are served.
  super_admin: ["platform", "schools", "billing", "question_review", ...ADMIN_PANEL_MODULES],
  admin: ADMIN_PANEL_MODULES,
  principal: [
    "dashboard",
    "analytics",
    "teachers",
    "students",
    "examinations",
    "attendance",
    "announcements",
    "settings",
  ],
  teacher: [
    "dashboard",
    "my_classes",
    "doubts",
    "announcements",
    "leave",
    "profile",
  ],
  student: [
    "dashboard",
    "learning",
    "practice",
    "tests",
    "battleground",
    "doubts",
    "profile",
  ],
  parent: [
    "dashboard",
    "children",
    "insights",
    "marks",
    "announcements",
    "profile",
  ],
};

export const DEFAULT_SCHOOL_ID = "00000000-0000-4000-8000-000000000001";
