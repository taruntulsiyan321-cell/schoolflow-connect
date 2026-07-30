/**
 * Gurukul authentication domain types.
 * Designed for multi-tenant SaaS: one school + one role per account.
 */

export type AppRole =
  | "super_admin"
  | "admin" // School Admin
  | "principal"
  | "teacher"
  | "student"
  | "parent";

/** Roles that have a dashboard today */
export type PortalRole = Exclude<AppRole, "super_admin">;

export interface AuthSchool {
  id: string;
  name: string;
  slug: string | null;
  logoUrl: string | null;
}

export interface AuthProfile {
  id: string;
  email: string | null;
  fullName: string;
  photoUrl: string | null;
  isActive: boolean;
}

export interface AuthContextData {
  userId: string;
  profile: AuthProfile;
  role: AppRole | null;
  school: AuthSchool | null;
}

export type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "disabled"
  | "missing_profile"
  | "missing_role";

export interface SignInCredentials {
  email: string;
  password: string;
}

export interface AuthErrorInfo {
  code: string;
  message: string;
}
