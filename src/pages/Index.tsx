import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth, dashboardForRole } from "@/auth";
import { Loader2 } from "lucide-react";

/**
 * `/` inside the app. On the website `/` is the marketing page
 * (scripts/promote-landing.mjs); here a signed-out visitor goes to sign-in and
 * a signed-in one to their home. The app's own landing — a pitch to schools —
 * went with the organisation side (2026-10-01).
 */
export default function Index() {
  const { user, role, loading, status, homePath } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || status === "loading") return;
    if (user && role && status === "authenticated") {
      navigate(homePath || dashboardForRole(role), { replace: true });
      return;
    }
    if (user && (status === "disabled" || status === "missing_role" || status === "missing_profile")) {
      navigate("/unauthorized", { replace: true, state: { reason: status } });
    }
  }, [user, role, loading, status, navigate, homePath]);

  if (!loading && status === "unauthenticated") return <Navigate to="/auth" replace />;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3">
      <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}
