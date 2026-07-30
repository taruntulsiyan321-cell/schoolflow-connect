import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth, dashboardForRole } from "@/auth";
import Landing from "./Landing";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Index() {
  const { user, role, loading, status, signOut, homePath } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading || status === "loading") return;
    if (user && role && status === "authenticated") {
      navigate(homePath || dashboardForRole(role), { replace: true });
    }
    if (user && (status === "disabled" || status === "missing_role" || status === "missing_profile")) {
      navigate("/unauthorized", { replace: true, state: { reason: status === "disabled" ? "disabled" : status } });
    }
  }, [user, role, loading, status, navigate, homePath]);

  if (loading || status === "loading" || (user && role && status === "authenticated")) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (user && !role) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-sm text-muted-foreground max-w-sm">
          Signed in, but no portal role is assigned to this account. Contact your school admin for access.
        </p>
        <Button variant="outline" size="sm" onClick={() => signOut()}>
          Sign out
        </Button>
      </div>
    );
  }

  return <Landing />;
}
