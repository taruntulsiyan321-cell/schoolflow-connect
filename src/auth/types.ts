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
  | "missing_role"
  /** Signed in, but the account could not be read — a slow or dropped
   *  connection. Not a fact about the account: the answer is to try again. */
  | "unreachable";


