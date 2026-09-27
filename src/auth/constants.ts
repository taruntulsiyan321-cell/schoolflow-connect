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



