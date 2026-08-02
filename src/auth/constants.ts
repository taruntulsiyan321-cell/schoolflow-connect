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

/** Modules allowed per role (for future fine-grained UI gating) */
export const ROLE_MODULES: Record<AppRole, readonly string[]> = {
  super_admin: ["platform", "schools", "billing"],
  admin: [
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
  ],
  principal: [
    "dashboard",
    "analytics",
    "teachers",
    "students",
    "examinations",
    "attendance",
    "announcements",
    "messages",
    "settings",
  ],
  teacher: [
    "dashboard",
    "my_classes",
    "doubts",
    "communication",
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
    "messages",
    "profile",
  ],
};

export const DEFAULT_SCHOOL_ID = "00000000-0000-4000-8000-000000000001";
