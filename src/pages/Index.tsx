import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import Landing from "./Landing";

export default function Index() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) return;
    if (!role) return; // show landing — no role assigned yet
    const map = { admin: "/admin", teacher: "/teacher", student: "/student", parent: "/parent" } as const;
    navigate(map[role], { replace: true });
  }, [user, role, loading, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-soft">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Authenticated but no role yet → show landing with a friendly banner
  return <Landing noRoleBanner={!!user && !role} />;
}
