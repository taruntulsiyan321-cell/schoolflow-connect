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

export function canAccessPath(role: AppRole | null | undefined, pathname: string): boolean {
  if (!role) return false;
  const match = Object.entries(ROUTE_ALLOW).find(([prefix]) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!match) return true; // non-role routes handled elsewhere
  return match[1].includes(role);
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
  return error.message;
}
