import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

export default function Index() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [delayed, setDelayed] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) { navigate("/auth"); return; }
    if (!role) { setDelayed(true); return; }
    const map = { admin: "/admin", teacher: "/teacher", student: "/student", parent: "/parent" } as const;
    navigate(map[role], { replace: true });
  }, [user, role, loading, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-gradient-soft">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      {delayed && <p className="text-muted-foreground text-sm">No role assigned. Contact your admin.</p>}
    </div>
  );
}
