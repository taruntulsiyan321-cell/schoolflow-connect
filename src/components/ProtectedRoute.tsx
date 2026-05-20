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

  if (allow && allow.length > 0 && role && !allow.includes(role)) {
    // Redirect to user's own dashboard
    return <Navigate to={`/${role}`} replace />;
  }

  return <>{children}</>;
};
