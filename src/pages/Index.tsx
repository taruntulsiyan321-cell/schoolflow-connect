import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";

export default function Index() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    if (!role) {
      navigate("/auth", { replace: true });
      return;
    }
    const map = { admin: "/admin", principal: "/principal", teacher: "/teacher", student: "/student", parent: "/parent" } as const;
    navigate(map[role], { replace: true });
  }, [user, role, loading, navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-soft">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}
