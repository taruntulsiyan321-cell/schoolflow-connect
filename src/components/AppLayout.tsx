import { ReactNode } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { GraduationCap, LogOut } from "lucide-react";

interface NavItem { to: string; label: string; icon: ReactNode; }

export const AppLayout = ({ children, nav, title }: { children: ReactNode; nav: NavItem[]; title: string }) => {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const handleSignOut = async () => { await signOut(); navigate("/auth"); };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-gradient-soft">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 flex-col bg-sidebar text-sidebar-foreground p-5 gap-2 h-screen sticky top-0">
        <div className="flex items-center gap-2 mb-4 px-2 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-gradient-primary flex items-center justify-center shadow-elevated">
            <GraduationCap className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <div className="font-bold leading-tight">Vidyalaya</div>
            <div className="text-xs text-sidebar-foreground/60">{title}</div>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto flex flex-col gap-1 -mx-1 px-1">
          {nav.map(n => (
            <NavLink key={n.to} to={n.to} end
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? "bg-sidebar-primary text-sidebar-primary-foreground" : "hover:bg-sidebar-accent"
                }`}>
              {n.icon}{n.label}
            </NavLink>
          ))}
        </nav>
        <div className="pt-4 border-t border-sidebar-border shrink-0">
          <div className="text-xs text-sidebar-foreground/60 px-2 mb-2 truncate">{user?.email}</div>
          <Button onClick={handleSignOut} variant="ghost" className="w-full justify-start text-sidebar-foreground hover:bg-sidebar-accent">
            <LogOut className="w-4 h-4 mr-2" /> Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden flex items-center justify-between p-4 bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-primary flex items-center justify-center">
            <GraduationCap className="w-4 h-4 text-primary-foreground" />
          </div>
          <span className="font-bold">Vidyalaya</span>
        </div>
        <Button onClick={handleSignOut} variant="ghost" size="sm" className="text-sidebar-foreground">
          <LogOut className="w-4 h-4" />
        </Button>
      </header>

      <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8 max-w-6xl w-full mx-auto">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-card border-t border-border flex overflow-x-auto py-2 z-50 gap-1 px-2">
        {nav.map(n => (
          <NavLink key={n.to} to={n.to} end
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 px-3 py-1 text-[10px] shrink-0 min-w-[64px] ${isActive ? "text-primary" : "text-muted-foreground"}`}>
            {n.icon}<span className="whitespace-nowrap">{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
};
