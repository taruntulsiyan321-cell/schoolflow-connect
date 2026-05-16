import { ReactNode, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { GraduationCap, LogOut, Menu, MoreHorizontal } from "lucide-react";

interface NavItem { to: string; label: string; icon: ReactNode; }

const MOBILE_PRIMARY = 4; // items shown in bottom bar; rest collapse into "More"

export const AppLayout = ({ children, nav, title }: { children: ReactNode; nav: NavItem[]; title: string }) => {
  const { signOut, user } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const handleSignOut = async () => { await signOut(); navigate("/auth"); };

  const primary = nav.slice(0, MOBILE_PRIMARY);
  const overflow = nav.slice(MOBILE_PRIMARY);
  const hasOverflow = overflow.length > 0;

  const renderNavList = (items: NavItem[], onClick?: () => void) => (
    <nav className="flex flex-col gap-0.5">
      {items.map(n => (
        <NavLink key={n.to} to={n.to} end onClick={onClick}
          className={({ isActive }) =>
            `group flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
              isActive
                ? "bg-sidebar-primary/15 text-white shadow-[inset_2px_0_0_0_hsl(var(--sidebar-primary))]"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-white"
            }`}>
          <span className="[&_svg]:w-[18px] [&_svg]:h-[18px] shrink-0 opacity-90">{n.icon}</span>
          <span className="truncate">{n.label}</span>
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background">
      {/* Desktop sidebar */}
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
        <div className="flex-1 overflow-y-auto px-3">
          {renderNavList(nav)}
        </div>
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
      <header className="md:hidden flex items-center justify-between gap-2 px-3 h-14 bg-sidebar text-sidebar-foreground border-b border-sidebar-border sticky top-0 z-40">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="text-sidebar-foreground hover:bg-sidebar-accent h-9 w-9 shrink-0">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[78vw] max-w-xs p-0 bg-sidebar text-sidebar-foreground border-sidebar-border">
            <SheetHeader className="px-5 h-16 flex-row items-center gap-2.5 border-b border-sidebar-border space-y-0">
              <div className="w-9 h-9 rounded-lg bg-gradient-primary flex items-center justify-center shadow-sm ring-1 ring-white/10">
                <GraduationCap className="w-[18px] h-[18px] text-primary-foreground" />
              </div>
              <div className="min-w-0 text-left">
                <SheetTitle className="text-white text-base leading-tight">Vidyalaya</SheetTitle>
                <div className="text-[11px] text-sidebar-foreground/55 uppercase tracking-wider font-medium">{title}</div>
              </div>
            </SheetHeader>
            <div className="px-3 pt-4 pb-2">
              <div className="text-[10px] font-semibold text-sidebar-foreground/40 uppercase tracking-wider px-2 mb-1.5">Workspace</div>
            </div>
            <div className="px-3 overflow-y-auto max-h-[calc(100vh-9rem)]">
              {renderNavList(nav, () => setMenuOpen(false))}
            </div>
            <div className="absolute bottom-0 inset-x-0 p-3 border-t border-sidebar-border bg-sidebar">
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
          </SheetContent>
        </Sheet>

        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-8 h-8 rounded-lg bg-gradient-primary flex items-center justify-center shrink-0">
            <GraduationCap className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm leading-none truncate">Vidyalaya</div>
            <div className="text-[10px] text-sidebar-foreground/55 uppercase tracking-wider mt-0.5 truncate">{title}</div>
          </div>
        </div>
        <Button onClick={handleSignOut} variant="ghost" size="icon" className="text-sidebar-foreground hover:bg-sidebar-accent h-9 w-9 shrink-0">
          <LogOut className="w-4 h-4" />
        </Button>
      </header>

      <main className="flex-1 px-3 py-4 sm:px-4 sm:py-6 md:px-8 md:py-8 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-10 max-w-[1400px] w-full mx-auto">{children}</main>

      {/* Mobile bottom nav — equal-width, safe-area aware */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 bg-card/95 backdrop-blur-md border-t border-border z-50 grid"
        style={{
          gridTemplateColumns: `repeat(${primary.length + (hasOverflow ? 1 : 0)}, minmax(0, 1fr))`,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {primary.map(n => (
          <NavLink key={n.to} to={n.to} end
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}>
            {({ isActive }) => (
              <>
                <span className={`[&_svg]:w-[20px] [&_svg]:h-[20px] ${isActive ? "scale-110" : ""} transition-transform`}>{n.icon}</span>
                <span className="truncate max-w-[64px]">{n.label}</span>
              </>
            )}
          </NavLink>
        ))}
        {hasOverflow && (
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button className="flex flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium text-muted-foreground">
                <MoreHorizontal className="w-5 h-5" />
                <span>More</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-xl pb-[calc(1rem+env(safe-area-inset-bottom))]">
              <SheetHeader className="text-left">
                <SheetTitle>More</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-3 gap-2 mt-4">
                {overflow.map(n => (
                  <NavLink key={n.to} to={n.to} end onClick={() => setMoreOpen(false)}
                    className={({ isActive }) =>
                      `flex flex-col items-center justify-center gap-1.5 p-3 rounded-lg border border-border text-xs font-medium transition-colors ${
                        isActive ? "bg-primary/10 text-primary border-primary/30" : "text-foreground hover:bg-muted"
                      }`}>
                    <span className="[&_svg]:w-5 [&_svg]:h-5">{n.icon}</span>
                    <span className="text-center leading-tight">{n.label}</span>
                  </NavLink>
                ))}
              </div>
            </SheetContent>
          </Sheet>
        )}
      </nav>
    </div>
  );
};
