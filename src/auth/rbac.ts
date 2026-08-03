import type { AppRole } from "./types";
import { ROLE_HOME, ROLE_MODULES, ROUTE_ALLOW } from "./constants";

export function isPortalRole(role: AppRole | null | undefined): role is keyof typeof ROLE_HOME {
  return !!role && role in ROLE_HOME;
}

export function dashboardForRole(role: AppRole | null | undefined): string {
  if (role === "super_admin") return "/admin"; // future: platform console
  if (isPortalRole(role)) return ROLE_HOME[role];
  return "/auth";
}

/** Paths safe for post-login redirect when not under a portal prefix. */
const SAFE_OPEN_PATHS = ["/", "/unauthorized", "/reset-password", "/auth"] as const;

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

export function canAccessModule(role: AppRole | null | undefined, moduleKey: string): boolean {
  if (!role) return false;
  return ROLE_MODULES[role]?.includes(moduleKey) ?? false;
}

export function mapAuthError(error: { message?: string; status?: number } | null | undefined): string {
  if (!error?.message) return "Something went wrong. Please try again.";
  const msg = error.message.toLowerCase();

  if (msg.includes("invalid login credentials") || msg.includes("invalid credentials")) {
    return "Invalid email or password.";
  }
  if (msg.includes("email not confirmed")) {
    return "Please confirm your email before signing in.";
  }
  if (msg.includes("user is banned") || msg.includes("disabled")) {
    return "This account has been disabled. Contact your school admin.";
  }
  if (msg.includes("network") || msg.includes("fetch")) {
    return "Network error. Check your connection and try again.";
  }
  if (msg.includes("rate limit") || msg.includes("too many")) {
    return "Too many attempts. Please wait a moment and try again.";
  }
  if (msg.includes("expired") || msg.includes("session")) {
    return "Your session has expired. Please sign in again.";
  }
  if (
    msg.includes("permission denied") ||
    msg.includes("row-level security") ||
    msg.includes("rls") ||
    msg.includes("not authorized") ||
    msg.includes("forbidden")
  ) {
    return "You don't have permission for this action. Contact your school admin.";
  }
  return error.message;
}
