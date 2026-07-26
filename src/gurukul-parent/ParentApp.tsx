import { useMemo, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, Bell, MessageSquare, User,
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
import ParentMessages from "./Messages";
import ParentNotifications from "./Notifications";
import ParentProfile from "./Profile";
import AcademicInsights from "./AcademicInsights";
import TestResults from "./TestResults";
import { children, parentNotifications, messageThreads } from "./data";
import { useAuth } from "@/hooks/useAuth";

export type { ParentPageKey } from "./nav";

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
}) {
  const unreadNotif = parentNotifications.filter((n) => !n.read).length;
  const unreadMsg = messageThreads.reduce((s, t) => s + t.unreadCount, 0);

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
      label: "Communication",
      items: [
        { key: "announcements", label: "Announcements", icon: <Bell className="w-4 h-4" /> },
        { key: "messages", label: "Messages", icon: <MessageSquare className="w-4 h-4" />, badge: unreadMsg },
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

  const activeChild = children.find((c) => c.id === activeChildId);

  return (
    <div className={cn(
      "flex flex-col h-full bg-[#0a0a0c] border-r border-white/7 transition-all duration-300",
      mobile ? "w-64" : collapsed ? "w-16" : "w-60"
    )}>
      <div className={cn("flex items-center gap-3 px-4 py-5 border-b border-white/7", collapsed && !mobile && "justify-center px-2")}>
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#10b981] to-[#059669] flex items-center justify-center shrink-0">
          <BookOpen className="w-4 h-4 text-white" />
        </div>
        {(!collapsed || mobile) && (
          <div className="min-w-0">
            <div className="text-sm font-black text-white">Gurukul</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#10b981]">Parent Panel</div>
          </div>
        )}
        {!mobile && (
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="ml-auto shrink-0 w-6 h-6 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center text-[#78788c] hover:text-white transition-all"
          >
            {collapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>

      {(!collapsed || mobile) && activeChild && (
        <div className="px-3 pt-3 pb-2 border-b border-white/7">
          <div className="text-[8px] font-bold text-[#46465a] uppercase tracking-widest px-2 mb-1">Active Child</div>
          {children.map((c) => (
            <div
              key={c.id}
              className={cn(
                "flex items-center gap-2 px-2 py-1.5 rounded-xl transition-all cursor-pointer",
                c.id === activeChildId ? "bg-[#10b981]/10 text-[#10b981]" : "hover:bg-white/3 text-[#78788c]",
              )}
              onClick={() => {
                setActiveChildId(c.id);
                setPage("children");
                onClose?.();
              }}
            >
              <div
                className="w-6 h-6 rounded-lg flex items-center justify-center text-[9px] font-black shrink-0"
                style={{
                  background: c.id === activeChildId ? "#10b98125" : "#ffffff12",
                  color: c.id === activeChildId ? "#10b981" : "#78788c",
                }}
              >
                {c.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold truncate">{c.name}</div>
                <div className="text-[8px] opacity-60">{c.className} · {c.section}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {(!collapsed || mobile) && (
              <div className="text-[8px] uppercase tracking-[0.15em] text-[#46465a] px-2 py-2 mt-2">{group.label}</div>
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
                    "w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left transition-all duration-150 mb-0.5",
                    collapsed && !mobile && "justify-center px-2",
                    active
                      ? "bg-[#10b981]/15 text-[#10b981] border border-[#10b981]/25"
                      : "text-[#78788c] hover:text-white hover:bg-white/5 border border-transparent",
                  )}
                  title={collapsed && !mobile ? item.label : undefined}
                >
                  <span className="shrink-0">{item.icon}</span>
                  {(!collapsed || mobile) && (
                    <>
                      <span className="flex-1 truncate text-xs font-medium">{item.label}</span>
                      {item.badge ? (
                        <span className={cn(
                          "text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                          active ? "bg-[#10b981]/30 text-[#10b981]" : "bg-[#cc5069]/20 text-[#cc5069]",
                        )}>
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
        <div className="px-3 py-4 border-t border-white/7 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#10b981] to-[#059669] flex items-center justify-center shrink-0">
              <span className="text-[11px] font-black text-white">RM</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-white truncate">Rajesh Mehta</div>
              <div className="text-[9px] text-[#46465a]">Father · {children.length} children</div>
            </div>
          </div>
          {onSignOut && (
            <button
              onClick={onSignOut}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-[#78788c] hover:text-white hover:bg-white/5 text-xs font-medium transition-all"
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
  const { signOut } = useAuth();
  const page = useMemo(() => parentPathToPage(location.pathname), [location.pathname]);
  const setPage = (p: ParentPageKey) => navigate(PARENT_PAGE_PATH[p]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeChildId, setActiveChildId] = useState(children[0]?.id ?? "c1");

  const activeChild = children.find((c) => c.id === activeChildId) ?? children[0];
  const unreadNotif = parentNotifications.filter((n) => !n.read).length;
  const unreadMsg = messageThreads.reduce((s, t) => s + t.unreadCount, 0);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <div className="gurukul-parent dark flex h-screen bg-[#0d0d0f] overflow-hidden">
      <div className="hidden md:flex flex-col shrink-0">
        <Sidebar
          page={page}
          setPage={setPage}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
          activeChildId={activeChildId}
          setActiveChildId={setActiveChildId}
          onSignOut={handleSignOut}
        />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative z-50 flex">
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
            />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-14 shrink-0 flex items-center gap-4 px-4 sm:px-6 border-b border-white/7 bg-[#0a0a0c]/80 backdrop-blur-xl">
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-[#78788c] hover:text-white"
          >
            <Menu className="w-4 h-4" />
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-[#46465a]">Parent</span>
            <span className="text-[#46465a]">/</span>
            <span className="text-sm font-semibold text-white truncate">{PARENT_PAGE_TITLES[page]}</span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={() => setPage("notifications")}
              className="relative w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-[#78788c] hover:text-white transition-all"
            >
              <Bell className="w-4 h-4" />
              {unreadNotif > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#cc5069] rounded-full text-[8px] font-bold text-white flex items-center justify-center">
                  {unreadNotif}
                </span>
              )}
            </button>
            <button
              onClick={() => setPage("messages")}
              className="relative w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-[#78788c] hover:text-white transition-all"
            >
              <MessageSquare className="w-4 h-4" />
              {unreadMsg > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-[#10b981] rounded-full text-[8px] font-bold text-white flex items-center justify-center">
                  {unreadMsg}
                </span>
              )}
            </button>
            <div className="hidden sm:flex items-center gap-1.5 bg-[#10b981]/10 border border-[#10b981]/20 rounded-full px-2.5 py-1">
              <BookOpen className="w-3 h-3 text-[#10b981]" />
              <span className="text-[10px] font-bold text-[#10b981]">Parent Panel</span>
            </div>
            <button
              onClick={() => setPage("profile")}
              className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#10b981] to-[#059669] flex items-center justify-center shrink-0"
            >
              <span className="text-[11px] font-black text-white">RM</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-[#0d0d0f]">
          <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
            <Routes>
              <Route
                index
                element={
                  <ParentHome
                    child={activeChild}
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
              <Route path="chat" element={<ParentMessages />} />
              <Route path="messages" element={<Navigate to="/parent/chat" replace />} />
              <Route path="notifications" element={<ParentNotifications />} />
              <Route path="profile" element={<ParentProfile />} />
              <Route path="attendance" element={<Navigate to="/parent/children" replace />} />
              <Route path="homework" element={<Navigate to="/parent/children" replace />} />
              <Route path="fees" element={<Navigate to="/parent/profile" replace />} />
              <Route path="complaints" element={<Navigate to="/parent/chat" replace />} />
              <Route path="*" element={<Navigate to="/parent" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
