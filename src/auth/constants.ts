import type { AppRole } from "./types";

/**
 * The one panel the live app has: the individual student's.
 *
 * Since 2026-10-01 the app is launched for individual students only. The
 * organisation side — admin, principal, teacher, parent, super admin and the
 * school student's screens — is kept whole on the `organisation` branch (tag
 * organisation-archive-2026-10-01) and is not part of this build.
 */
export const STUDENT_HOME = "/student";

/** Which roles may enter which route prefixes */
export const ROUTE_ALLOW: Record<string, AppRole[]> = {
  "/student": ["student"],
};
