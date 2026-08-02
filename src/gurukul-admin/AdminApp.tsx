import { useMemo, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Users, GraduationCap, Building2,
  BarChart2, Bell, Settings, ChevronLeft, ChevronRight,
  Shield, Menu, ClipboardList, CalendarCheck, LogOut, BookOpen, Activity,
} from "lucide-react";
import { cn } from "./shared";
import {
  type AdminPageKey,
  ADMIN_PAGE_PATH,
  ADMIN_PAGE_TITLES,
  adminPathToPage,
} from "./nav";
import AdminHome from "./Dashboard";
import StudentsAdmin from "@/pages/admin/StudentsAdmin";
import TeachersAdmin from "@/pages/admin/TeachersAdmin";
import ParentManagement from "./Parents";
import ClassManagement from "./Classes";
import AnnouncementManagement from "./Announcements";
import Reports from "./Reports";
import ExaminationManagement from "./Examinations";
import HomeworkAdmin from "./Homework";
import LeaveRequests from "./LeaveRequests";
import SettingsPage from "./Settings";
import AiAnalyticsPanel from "./AiAnalytics";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS } from "@/auth/constants";

export type { AdminPageKey } from "./nav";

interface NavItem {
  key: AdminPageKey;
  label: string;
  icon: ReactNode;
  badge?: number;
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
      { key: "reports", label: "Reports", icon: <BarChart2 className="w-4 h-4" /> },
      { key: "announcements", label: "Announcements", icon: <Bell className="w-4 h-4" /> },
    ],
  },
  {
    label: "Users",
    items: [
      { key: "students", label: "Students", icon: <GraduationCap className="w-4 h-4" /> },
      { key: "teachers", label: "Teachers", icon: <Users className="w-4 h-4" /> },
      { key: "parents", label: "Parents", icon: <Users className="w-4 h-4" /> },
      { key: "leave_requests", label: "Leave Requests", icon: <CalendarCheck className="w-4 h-4" /> },
    ],
  },
  {
    label: "Academic",
    items: [
      { key: "classes", label: "Classes", icon: <Building2 className="w-4 h-4" /> },
      { key: "examinations", label: "Examinations", icon: <ClipboardList className="w-4 h-4" /> },
      { key: "homework", label: "Homework", icon: <BookOpen className="w-4 h-4" /> },
    ],
  },
  {
    label: "System",
    items: [
      { key: "ai_analytics", label: "AI Analytics", icon: <Activity className="w-4 h-4" /> },
      { key: "settings", label: "Settings", icon: <Settings className="w-4 h-4" /> },
    ],
  },
];

function Sidebar({
  page,
  setPage,
  collapsed,
  setCollapsed,
  mobile = false,
  onClose,
  onSignOut,
}: {
  page: AdminPageKey;
  setPage: (p: AdminPageKey) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  mobile?: boolean;
  onClose?: () => void;
  onSignOut?: () => void;
}) {
  return (
    <div className={cn(
      "flex flex-col h-full bg-[#0a0a0c] border-r border-white/7 transition-all duration-300",
      mobile ? "w-64" : collapsed ? "w-16" : "w-60"
    )}>
      <div className={cn(
        "flex items-center gap-3 px-4 py-5 border-b border-white/7",
        collapsed && !mobile && "justify-center px-2"
      )}>
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center shrink-0">
          <Shield className="w-4 h-4 text-white" />
        </div>
        {(!collapsed || mobile) && (
          <div className="min-w-0">
            <div className="text-sm font-black text-white">Gurukul</div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-[#3b5bdb]">Admin Panel</div>
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

      <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-1">
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            {(!collapsed || mobile) && (
              <div className="text-[9px] uppercase tracking-[0.15em] text-[#46465a] px-2 py-2 mt-2">
                {group.label}
              </div>
            )}
            {collapsed && !mobile && <div className="h-2" />}
            {group.items.map((item) => {
              const active = page === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => { setPage(item.key); onClose?.(); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left text-sm font-medium transition-all duration-150",
                    collapsed && !mobile && "justify-center px-2",
                    active
                      ? "bg-[#3b5bdb]/15 text-[#3b5bdb] border border-[#3b5bdb]/25"
                      : "text-[#78788c] hover:text-white hover:bg-white/5 border border-transparent"
                  )}
                  title={collapsed && !mobile ? item.label : undefined}
                >
                  <span className="shrink-0">{item.icon}</span>
                  {(!collapsed || mobile) && (
                    <>
                      <span className="flex-1 truncate text-xs">{item.label}</span>
                      {item.badge && (
                        <span className={cn(
                          "text-[9px] font-bold px-1.5 py-0.5 rounded-full",
                          active ? "bg-[#3b5bdb]/30 text-[#a5b4fc]" : "bg-white/8 text-[#78788c]"
                        )}>
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {onSignOut && (
        <div className="p-2 border-t border-white/7">
          <button
            onClick={onSignOut}
            className={cn(
              "w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-left text-xs font-medium text-[#78788c] hover:text-rose-400 hover:bg-rose-400/5 transition-all",
              collapsed && !mobile && "justify-center px-2"
            )}
          >
            <LogOut className="w-4 h-4 shrink-0" />
            {(!collapsed || mobile) && <span>Sign out</span>}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AdminApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut, profile, role } = useAuth();
  const roleLabel = role ? ROLE_LABELS[role] : "Admin";
  const initials =
    (profile?.fullName ?? "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?";
  const page = useMemo(() => adminPathToPage(location.pathname), [location.pathname]);
  const setPage = (p: AdminPageKey) => navigate(ADMIN_PAGE_PATH[p]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  return (
    <div className="gurukul-admin dark flex h-screen bg-[#0d0d0f] overflow-hidden">
      <div className="hidden md:flex flex-col shrink-0">
        <Sidebar
          page={page}
          setPage={setPage}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
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
            <span className="text-xs text-[#46465a]">Admin</span>
            <span className="text-[#46465a]">/</span>
            <span className="text-sm font-semibold text-white truncate">{ADMIN_PAGE_TITLES[page]}</span>
          </div>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-1.5 bg-[#3b5bdb]/10 border border-[#3b5bdb]/20 rounded-full px-2.5 py-1">
              <Shield className="w-3 h-3 text-[#3b5bdb]" />
              <span className="text-[10px] font-bold text-[#3b5bdb]">{roleLabel}</span>
            </div>
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center shrink-0">
              <span className="text-[11px] font-black text-white">{initials}</span>
            </div>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-[#0d0d0f]">
          <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
            <Routes>
              <Route index element={<AdminHome setPage={setPage} />} />
              <Route path="students/*" element={<StudentsAdmin />} />
              <Route path="teachers/*" element={<TeachersAdmin />} />
              <Route path="parents/*" element={<ParentManagement />} />
              <Route path="classes/*" element={<ClassManagement />} />
              <Route path="announcements/*" element={<AnnouncementManagement />} />
              <Route path="notices" element={<Navigate to="/admin/announcements" replace />} />
              <Route path="reports/*" element={<Reports />} />
              <Route path="fees" element={<Navigate to="/admin/reports" replace />} />
              <Route path="examinations/*" element={<ExaminationManagement />} />
              <Route path="homework/*" element={<HomeworkAdmin />} />
              <Route path="exams" element={<Navigate to="/admin/examinations" replace />} />
              <Route path="exams/*" element={<Navigate to="/admin/examinations" replace />} />
              <Route path="leave-requests/*" element={<LeaveRequests />} />
              <Route path="leave" element={<Navigate to="/admin/leave-requests" replace />} />
              <Route path="ai-analytics" element={<AiAnalyticsPanel />} />
              <Route path="settings/*" element={<SettingsPage />} />
              <Route path="roles" element={<Navigate to="/admin/settings" replace />} />
              <Route path="users" element={<Navigate to="/admin/settings" replace />} />
              <Route path="profile" element={<Navigate to="/admin/settings" replace />} />
              <Route path="attendance" element={<Navigate to="/admin/classes" replace />} />
              <Route path="timetable" element={<Navigate to="/admin/classes" replace />} />
              <Route path="question-bank" element={<Navigate to="/admin/examinations" replace />} />
              <Route path="*" element={<Navigate to="/admin" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
