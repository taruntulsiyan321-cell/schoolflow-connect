import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Bell, User,
  ChevronLeft, ChevronRight, Menu, BookOpen, LogOut,
  BarChart2, ClipboardList,
} from "lucide-react";
import { cn } from "./shared";
import {
  type ParentPageKey,
  PARENT_PAGE_PATH,
  PARENT_PAGE_TITLES,
  parentPathToPage,
} from "./nav";
import ParentHome from "./Dashboard";
import MyChildren from "./MyChildren";
import ParentAnnouncements from "./Announcements";
import ParentNotifications from "./Notifications";
import ParentProfile from "./Profile";
import { MembershipSwitcher } from "@/auth/MembershipSwitcher";
import AcademicInsights from "./AcademicInsights";
import TestResults from "./TestResults";
import { useParentLiveChildren } from "./ParentLiveAttendance";
import { useAuth } from "@/hooks/useAuth";
import { useNotifications } from "@/hooks/useNotifications";

export type { ParentPageKey } from "./nav";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return parts.map((w) => w[0]).slice(0, 2).join("").toUpperCase();
}

interface NavItem {
  key: ParentPageKey;
  label: string;
  icon: ReactNode;
  badge?: number;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

function Sidebar({
  page,
  setPage,
  collapsed,
  setCollapsed,
  mobile = false,
  onClose,
  activeChildId,
  setActiveChildId,
  onSignOut,
  parentName,
  unreadNotif,
}: {
  page: ParentPageKey;
  setPage: (p: ParentPageKey) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  mobile?: boolean;
  onClose?: () => void;
  activeChildId: string;
  setActiveChildId: (id: string) => void;
  onSignOut?: () => void;
  parentName: string;
  unreadNotif: number;
}) {
  const displayName = parentName.trim() || "Parent";
  const initials = initialsFromName(displayName);

  const NAV_GROUPS: NavGroup[] = [
    {
      label: "Overview",
      items: [
        { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
      ],
    },
    {
      label: "My Children",
      items: [
        { key: "children", label: "My Children", icon: <Users className="w-4 h-4" /> },
        { key: "academic_insights", label: "Academic Insights", icon: <BarChart2 className="w-4 h-4" /> },
        { key: "test_results", label: "Test Results", icon: <ClipboardList className="w-4 h-4" /> },
      ],
    },
    {
      label: "Updates",
      items: [
        { key: "announcements", label: "Announcements", icon: <Bell className="w-4 h-4" /> },
        { key: "notifications", label: "Notifications", icon: <Bell className="w-4 h-4" />, badge: unreadNotif },
      ],
    },
    {
      label: "Account",
      items: [
        { key: "profile", label: "My Profile", icon: <User className="w-4 h-4" /> },
      ],
    },
  ];

  const { children: liveChildren } = useParentLiveChildren();
  const children = liveChildren.map((c) => ({
    id: c.id,
    name: c.fullName,
    className: c.classLabel,
    section: "",
  }));

  const activeChild = children.find((c) => c.id === activeChildId) ?? children[0];

  return (
    /* The design's dark rail. Colours inside come from the `sidebar-*` tokens:
       `bg-card` / `text-foreground` are the light page surface and would be
       dark-on-dark here. */
    <div className={cn(
      "flex flex-col h-full bg-sidebar text-sidebar-foreground border-r border-white/10 transition-all duration-300",
      mobile ? "w-64" : collapsed ? "w-16" : "w-60"
    )}>
      <div className={cn("flex items-center gap-3 px-4 py-5 border-b border-white/10", collapsed && !mobile && "justify-center px-2")}>
        {collapsed && !mobile ? (
          <BookOpen className="w-4 h-4 text-sidebar-foreground/70 shrink-0" />
        ) : (
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-medium text-white tracking-tight leading-none">Gurukul</div>
            <div className="text-xs text-sidebar-foreground/60 mt-1 font-mono">Parent Panel</div>
          </div>
        )}
        {!mobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="ml-auto shrink-0 w-6 h-6 rounded-[2px] bg-white/5 hover:bg-white/10 flex items-center justify-center text-sidebar-foreground/70 hover:text-sidebar-foreground transition-colors"
          >
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {(!collapsed || mobile) && activeChild && (
        <div className="px-3 pt-3 pb-2 border-b border-white/10">
          <div className="text-[10px] font-medium text-sidebar-foreground/60 uppercase tracking-widest px-2 mb-1.5">Active Child</div>
          {children.map((c) => (
            <div
              key={c.id}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-[2px] transition-colors cursor-pointer",
                c.id === activeChildId
                  ? "bg-sidebar-accent text-white"
                  : "hover:bg-white/5 text-sidebar-foreground/70",
              )}
              onClick={() => {
                setActiveChildId(c.id);
                setPage("children");
                onClose?.();
              }}
            >
              {/* The initials chip read `#3b5bdb25` / `#ffffff12` — the shadow
                  palette, and a translucent white that is invisible on a light
                  surface. On the dark rail both are token-derived now. */}
              <div
                className={cn(
                  "w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-mono shrink-0",
                  c.id === activeChildId ? "bg-accent text-accent-foreground" : "bg-white/10 text-sidebar-foreground/70",
                )}
              >
                {c.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </div>
              <div className="min-w-0">
                <div className="text-xs truncate">{c.name}</div>
                <div className="text-[10px] text-sidebar-foreground/60 font-mono">{c.className}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {(!collapsed || mobile) && (
              <div className="text-[10px] font-medium uppercase tracking-widest text-sidebar-foreground/55 px-2 py-2 mt-2">{group.label}</div>
            )}
            {collapsed && !mobile && <div className="h-2" />}
            {group.items.map((item) => {
              const active = page === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    setPage(item.key);
                    onClose?.();
                  }}
                  className={cn(
                    "w-full flex items-center gap-3 px-2.5 py-2.5 rounded-[2px] text-left transition-colors mb-0.5",
                    collapsed && !mobile && "justify-center px-2",
                    active
                      ? "bg-sidebar-accent text-white font-medium"
                      : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-white/5",
                  )}
                  title={collapsed && !mobile ? item.label : undefined}
                >
                  <span className="shrink-0">{item.icon}</span>
                  {(!collapsed || mobile) && (
                    <>
                      <span className="flex-1 truncate text-sm">{item.label}</span>
                      {item.badge ? (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-destructive text-white">
                          {item.badge}
                        </span>
                      ) : null}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {(!collapsed || mobile) && (
        <div className="px-3 py-4 border-t border-white/10 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center shrink-0">
              <span className="text-[11px] font-display font-medium text-accent-foreground">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-sidebar-foreground truncate">{displayName}</div>
              <div className="text-xs text-sidebar-foreground/60 font-mono">
                {children.length} linked {children.length === 1 ? "child" : "children"}
              </div>
            </div>
          </div>
          {onSignOut && (
            <button
              onClick={onSignOut}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-[2px] text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-white/5 text-xs transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ParentApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, profile } = useAuth();
  const { unread: unreadNotif } = useNotifications();
  const page = useMemo(() => parentPathToPage(location.pathname), [location.pathname]);
  const setPage = (p: ParentPageKey) => navigate(PARENT_PAGE_PATH[p]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeChildId, setActiveChildId] = useState("");
  const parentName = profile?.fullName ?? "";
  const initials = initialsFromName(parentName.trim() || "Parent");

  // Seed activeChildId here (not just in Dashboard) so any parent route
  // entered directly via deep link already has a selected child.
  const { children: liveChildren } = useParentLiveChildren();
  const liveChild = liveChildren.find((c) => c.id === activeChildId) ?? liveChildren[0];
  useEffect(() => {
    if (liveChild && liveChild.id !== activeChildId) {
      setActiveChildId(liveChild.id);
    }
  }, [liveChild, activeChildId]);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <div className="gurukul-parent flex h-screen bg-background overflow-hidden">
      <div className="hidden md:flex flex-col shrink-0">
        <Sidebar
          page={page}
          setPage={setPage}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          activeChildId={activeChildId}
          setActiveChildId={setActiveChildId}
          onSignOut={handleSignOut}
          parentName={parentName}
          unreadNotif={unreadNotif}
        />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-modal md:hidden flex">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative z-modal flex">
            <Sidebar
              page={page}
              setPage={setPage}
              collapsed={false}
              setCollapsed={() => {}}
              mobile
              onClose={() => setMobileOpen(false)}
              activeChildId={activeChildId}
              setActiveChildId={setActiveChildId}
              onSignOut={handleSignOut}
              parentName={parentName}
              unreadNotif={unreadNotif}
                />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="relative z-40 h-14 shrink-0 flex items-center gap-4 px-4 sm:px-6 border-b border-border bg-card/95 backdrop-blur-xl">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <Menu className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-muted-foreground">Parent</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-sm font-semibold text-foreground truncate">{PARENT_PAGE_TITLES[page]}</span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => setPage("notifications")}
              className="relative w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground transition-all"
            >
              <Bell className="w-4 h-4" />
              {unreadNotif > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-destructive rounded-full text-[8px] font-bold text-primary-foreground flex items-center justify-center">
                  {unreadNotif}
                </span>
              )}
            </button>
            <div className="hidden sm:flex items-center gap-1.5 bg-primary/10 border border-primary/20 rounded-full px-2.5 py-1">
              <BookOpen className="w-3 h-3 text-primary" />
              <span className="text-[10px] font-bold text-primary">Parent Panel</span>
            </div>
            {/*
              The shell that needed it most and was the only one without it.
              A teacher-parent defaults into `teacher` by ROLE_PRIORITY
              (20260906000000), so the parent shell is where they arrive after
              switching — and with no switcher here it was a one-way door in the
              direction that matters: no way back to their own child's surfaces.
              Renders nothing for a single-membership account, which is every
              account but the dual-role one.
            */}
            <MembershipSwitcher className="shrink-0" />
            <button
              onClick={() => setPage("profile")}
              className="w-8 h-8 rounded-[2px] bg-primary flex items-center justify-center shrink-0"
            >
              <span className="text-[11px] font-black text-primary-foreground">{initials}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-background">
          <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
            <Routes>
              <Route
                index
                element={
                  <ParentHome
                    setPage={setPage}
                    activeChildId={activeChildId}
                    setActiveChildId={setActiveChildId}
                  />
                }
              />
              <Route
                path="children"
                element={<MyChildren activeChildId={activeChildId} setActiveChildId={setActiveChildId} />}
              />
              <Route
                path="insights"
                element={<AcademicInsights activeChildId={activeChildId} setActiveChildId={setActiveChildId} />}
              />
              <Route
                path="marks"
                element={<TestResults activeChildId={activeChildId} setActiveChildId={setActiveChildId} />}
              />
              <Route path="test-results" element={<Navigate to="/parent/marks" replace />} />
              <Route path="notices" element={<ParentAnnouncements />} />
              <Route path="announcements" element={<Navigate to="/parent/notices" replace />} />
              <Route path="chat" element={<Navigate to="/parent/notices" replace />} />
              <Route path="messages" element={<Navigate to="/parent/notices" replace />} />
              <Route path="notifications" element={<ParentNotifications />} />
              <Route path="profile" element={<ParentProfile />} />
              <Route path="attendance" element={<Navigate to="/parent/children" replace />} />
              <Route path="homework" element={<Navigate to="/parent/children" replace />} />
              <Route path="fees" element={<Navigate to="/parent/profile" replace />} />
              <Route path="complaints" element={<Navigate to="/parent/notices" replace />} />
              <Route path="*" element={<Navigate to="/parent" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
