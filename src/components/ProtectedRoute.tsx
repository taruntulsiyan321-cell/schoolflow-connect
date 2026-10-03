import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, type AppRole } from "@/auth";
import { Loader2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  /** Roles allowed to view this route. Others are redirected. */
  allow?: AppRole[];
}

/**
 * Route guard — unauthenticated → /auth (preserves destination).
 * Wrong role → /unauthorized.
 * Disabled / missing profile → /unauthorized.
 * Account could not be read (slow or dropped connection) → try again, in place.
 */
export const ProtectedRoute = ({ children, allow }: Props) => {
  const { user, role, profile, loading, status, homePath, refreshAuth } = useAuth();
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

  // The connection failed, not the account: say so, and offer the retry. This
  // was "Profile unavailable — try signing in again", which on a phone means a
  // new OTP for a student whose account was fine all along.
  if (status === "unreachable") {
    return (
      <div role="alert" className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background p-6 text-center">
        <WifiOff className="w-6 h-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-semibold text-foreground">We could not reach Gurukul</p>
        <p className="max-w-xs text-sm text-muted-foreground">Your account is fine — the connection is slow or down. Check it, then try again.</p>
        <Button onClick={() => void refreshAuth()}>Try again</Button>
      </div>
    );
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
          // Any role but student is an organisation account, and the live app
          // has no organisation panels (2026-10-01).
          state={{ reason: role === "student" ? "forbidden" : "organisation", from: loc.pathname, home: homePath }}
        />
      );
    }
  }

  return <>{children}</>;
};
