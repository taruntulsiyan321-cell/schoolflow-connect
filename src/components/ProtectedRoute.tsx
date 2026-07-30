import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, type AppRole } from "@/auth";
import { Loader2 } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Roles allowed to view this route. Others are redirected. */
  allow?: AppRole[];
}

/**
 * Route guard — unauthenticated → /auth (preserves destination).
 * Wrong role → /unauthorized.
 * Disabled / missing profile → /unauthorized.
 */
export const ProtectedRoute = ({ children, allow }: Props) => {
  const { user, role, profile, loading, status, homePath } = useAuth();
  const loc = useLocation();
  const onUnauthorizedPage = loc.pathname === "/unauthorized";

  if (loading || status === "loading") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Restoring your session…</p>
      </div>
    );
  }

  if (!user || status === "unauthenticated") {
    return <Navigate to="/auth" replace state={{ from: loc.pathname }} />;
  }

  // Allow the unauthorized page itself for any signed-in user (avoids redirect loops)
  if (onUnauthorizedPage) {
    return <>{children}</>;
  }

  if (status === "disabled" || (profile && !profile.isActive)) {
    return <Navigate to="/unauthorized" replace state={{ reason: "disabled" }} />;
  }

  if (status === "missing_profile") {
    return <Navigate to="/unauthorized" replace state={{ reason: "missing_profile" }} />;
  }

  if (allow && allow.length > 0) {
    if (!role || status === "missing_role") {
      return <Navigate to="/unauthorized" replace state={{ reason: "missing_role" }} />;
    }
    if (!allow.includes(role)) {
      return (
        <Navigate
          to="/unauthorized"
          replace
          state={{ reason: "forbidden", from: loc.pathname, home: homePath }}
        />
      );
    }
  }

  return <>{children}</>;
};
