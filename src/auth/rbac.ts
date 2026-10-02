import type { AppRole } from "./types";
import { STUDENT_HOME, ROUTE_ALLOW } from "./constants";

/**
 * Where a signed-in account lands. Only a student has a panel; every other
 * role (admin, principal, teacher, parent, super admin) is an organisation
 * account, and organisations are not part of the live app — it is told so on
 * /unauthorized rather than sent to a panel that does not exist.
 */
export function dashboardForRole(role: AppRole | null | undefined): string {
  if (role === "student") return STUDENT_HOME;
  if (role) return "/unauthorized";
  return "/auth";
}

/** Paths safe for post-login redirect when not under a portal prefix. */
const SAFE_OPEN_PATHS = ["/", "/unauthorized", "/auth"] as const;

export function canAccessPath(role: AppRole | null | undefined, pathname: string): boolean {
  if (!role) return false;
  if (!pathname.startsWith("/") || pathname.startsWith("//")) return false;
  const match = Object.entries(ROUTE_ALLOW).find(([prefix]) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (match) return match[1].includes(role);
  return SAFE_OPEN_PATHS.some(
    (p) => pathname === p || (p !== "/" && pathname.startsWith(`${p}/`)),
  );
}
