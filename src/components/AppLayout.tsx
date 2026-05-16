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
    <div className="min-h-screen flex flex-col md:flex-row bg-background">
      {/* Sidebar */}
      <aside className="hidden md:flex w-64 flex-col bg-sidebar text-sidebar-foreground h-screen sticky top-0 border-r border-sidebar-border">
        <div className="flex items-center gap-2.5 px-5 h-16 shrink-0 border-b border-sidebar-border">
          <div className="w-9 h-9 rounded-lg bg-gradient-primary flex items-center justify-center shadow-sm ring-1 ring-white/10">
            <GraduationCap className="w-[18px] h-[18px] text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold leading-tight tracking-tight">Vidyalaya</div>
            <div className="text-[11px] text-sidebar-foreground/55 uppercase tracking-wider font-medium">{title}</div>
          </div>
        </div>
        <div className="px-3 pt-4 pb-2">
          <div className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-wider px-2 mb-1.5">Workspace</div>
        </div>
        <nav className="flex-1 overflow-y-auto flex flex-col gap-0.5 px-3">
          {nav.map(n => (
            <NavLink key={n.to} to={n.to} end
              className={({ isActive }) =>
                `group flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-all ${
                  isActive
                    ? "bg-sidebar-primary/15 text-white shadow-[inset_2px_0_0_0_hsl(var(--sidebar-primary))]"
                    : "text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-white"
                }`}>
              <span className="[&_svg]:w-[17px] [&_svg]:h-[17px] shrink-0 opacity-90">{n.icon}</span>
              <span className="truncate">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-sidebar-border shrink-0">
          <div className="flex items-center gap-2.5 px-2 py-2 mb-1">
            <div className="w-8 h-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-semibold text-white shrink-0">
              {user?.email?.[0]?.toUpperCase() ?? "U"}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-medium text-white truncate">{user?.email?.split("@")[0]}</div>
              <div className="text-[10px] text-sidebar-foreground/50 truncate">{user?.email}</div>
            </div>
          </div>
          <Button onClick={handleSignOut} variant="ghost" size="sm" className="w-full justify-start text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white h-8 text-xs">
            <LogOut className="w-3.5 h-3.5 mr-2" /> Sign out
          </Button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="md:hidden flex items-center justify-between px-4 h-14 bg-sidebar text-sidebar-foreground border-b border-sidebar-border sticky top-0 z-40">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-primary flex items-center justify-center">
            <GraduationCap className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <div className="font-semibold text-sm leading-none">Vidyalaya</div>
            <div className="text-[10px] text-sidebar-foreground/55 uppercase tracking-wider mt-0.5">{title}</div>
          </div>
        </div>
        <Button onClick={handleSignOut} variant="ghost" size="sm" className="text-sidebar-foreground hover:bg-sidebar-accent">
          <LogOut className="w-4 h-4" />
        </Button>
      </header>

      <main className="flex-1 px-4 py-6 md:px-8 md:py-8 pb-24 md:pb-10 max-w-[1400px] w-full mx-auto">{children}</main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 bg-card/95 backdrop-blur-md border-t border-border flex overflow-x-auto py-1.5 z-50 gap-0.5 px-1">
        {nav.map(n => (
          <NavLink key={n.to} to={n.to} end
            className={({ isActive }) =>
              `flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-md text-[10px] shrink-0 min-w-[60px] transition-colors ${
                isActive ? "text-primary bg-primary/8 font-semibold" : "text-muted-foreground"
              }`}>
            <span className="[&_svg]:w-[18px] [&_svg]:h-[18px]">{n.icon}</span>
            <span className="whitespace-nowrap">{n.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
};
