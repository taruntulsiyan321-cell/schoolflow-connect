import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth, type AppRole } from "@/hooks/useAuth";
import { Loader2 } from "lucide-react";

interface Props {
  children: ReactNode;
  allow?: AppRole[];
}

export const ProtectedRoute = ({ children, allow }: Props) => {
  const { user, role, loading } = useAuth();
  const loc = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/auth" replace state={{ from: loc.pathname }} />;
  }

  if (allow && allow.length > 0) {
    if (!role) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6 text-center">
          <p className="text-sm text-muted-foreground max-w-sm">
            Your account is signed in but has no portal role yet. Ask your school admin to assign access, then sign in again.
          </p>
        </div>
      );
    }
    if (!allow.includes(role)) {
      return <Navigate to={`/${role}`} replace />;
    }
  }

  return <>{children}</>;
};
