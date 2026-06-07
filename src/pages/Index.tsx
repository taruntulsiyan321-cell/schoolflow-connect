import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import Landing from "./Landing";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function Index() {
  const { user, role, loading, signOut } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user && role) {
      navigate(`/${role}`, { replace: true });
    }
  }, [user, role, loading, navigate]);

  if (loading || (user && role)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
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
