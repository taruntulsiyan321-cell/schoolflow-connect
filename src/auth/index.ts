export type {
  AppRole,
  PortalRole,
  AuthSchool,
  AuthProfile,
  AuthContextData,
  AuthStatus,
  SignInCredentials,
  AuthErrorInfo,
} from "./types";

export { ROLE_LABELS, ROLE_HOME, ROLE_MODULES, ROUTE_ALLOW, DEFAULT_SCHOOL_ID } from "./constants";
export {
  isPortalRole,
  dashboardForRole,
  canAccessPath,
  canAccessModule,
  mapAuthError,
} from "./rbac";
export { loadAuthContext, clearClientAuthCaches } from "./session";
export { requireSchoolId } from "./tenant";
export { AuthProvider, useAuth } from "./AuthProvider";
