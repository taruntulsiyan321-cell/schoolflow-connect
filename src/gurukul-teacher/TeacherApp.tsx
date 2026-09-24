import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, BookOpen, HelpCircle, Megaphone,
  Calendar, User, ChevronLeft, ChevronRight, GraduationCap, Menu, LogOut,
  Swords, FolderOpen, FileText,
} from "lucide-react";
import { cn } from "./shared";
import {
  type TeacherPageKey,
  TEACHER_PAGE_PATH,
  TEACHER_PAGE_TITLES,
  teacherPathToPage,
} from "./nav";
import TeacherHome from "./Dashboard";
import MyClasses from "./MyClasses";
import TeacherAttendancePage from "./TeacherAttendancePage";
import Doubts from "./Doubts";
import Announcements from "./Announcements";
import TeacherResources from "./Resources";
import Leave from "./Leave";
import TeacherProfile from "./Profile";
import { useTeacherIdentity, teacherInitials } from "./useTeacherIdentity";
import { useAuth } from "@/hooks/useAuth";
import QuestionPapers from "./QuestionPapers";
import TeacherTimetablePage from "@/pages/shared/TeacherTimetablePage";
import TeacherBattleground from "@/pages/teacher/TeacherBattleground";
import BattleMonitor from "@/pages/teacher/BattleMonitor";
import { MembershipSwitcher } from "@/auth/MembershipSwitcher";

/** Set My Classes sub-tab then bounce to /teacher/classes (sessionStorage contract). */
function RedirectTeacherClassTab({ tab }: { tab: string }) {
  useEffect(() => {
    try {
      sessionStorage.setItem("teacher.openTab", tab);
    } catch {
      /* ignore */
    }
  }, [tab]);
  return <Navigate to="/teacher/classes" replace />;
}

export type { TeacherPageKey } from "./nav";

interface NavItem {
  key: TeacherPageKey;
  label: string;
  icon: ReactNode;
}

const navItems: NavItem[] = [
  { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
  { key: "myclasses", label: "My Classes", icon: <BookOpen className="w-4 h-4" /> },
  { key: "battleground", label: "Battles", icon: <Swords className="w-4 h-4" /> },
  { key: "questionpapers", label: "Question Papers", icon: <FileText className="w-4 h-4" /> },
  { key: "resources", label: "Resources", icon: <FolderOpen className="w-4 h-4" /> },
  { key: "doubts", label: "Student Doubts", icon: <HelpCircle className="w-4 h-4" /> },
  { key: "announcements", label: "Announcements", icon: <Megaphone className="w-4 h-4" /> },
  { key: "leave", label: "Leave", icon: <Calendar className="w-4 h-4" /> },
  { key: "profile", label: "My Profile", icon: <User className="w-4 h-4" /> },
];

function Sidebar({
  page,
  setPage,
  collapsed,
  setCollapsed,
  mobile = false,
  onClose,
  onSignOut,
  displayName,
  employeeId,
  initials,
}: {
  page: TeacherPageKey;
  setPage: (p: TeacherPageKey) => void;
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  mobile?: boolean;
  onClose?: () => void;
  onSignOut?: () => void;
  displayName: string;
  employeeId: string;
  initials: string;
}) {
  return (
    /* The design's dark rail against the cream canvas. Every colour inside it
       reads from the `sidebar-*` tokens rather than the page ones — `bg-card`
       and `text-foreground` are the LIGHT surface, and on a near-black rail
       they are the dark-on-dark trap this codebase has hit four times. */
    <aside className={cn(
      "flex flex-col h-full bg-sidebar text-sidebar-foreground border-r border-white/10 transition-all duration-300 shrink-0",
      mobile ? "w-64" : collapsed ? "w-16" : "w-60",
    )}>
      <div className={cn("flex items-center gap-3 px-4 py-5 border-b border-white/10 min-h-[72px]", collapsed && !mobile && "justify-center px-2")}>
        {collapsed && !mobile ? (
          <GraduationCap className="w-4 h-4 text-sidebar-foreground/70 shrink-0" />
        ) : (
          <div className="flex-1 min-w-0">
            <div className="font-display text-lg font-medium text-white tracking-tight leading-none">Gurukul</div>
            <div className="text-xs text-sidebar-foreground/60 mt-1 font-mono">Teacher Panel</div>
          </div>
        )}
        {!mobile && (
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="w-6 h-6 rounded-[2px] bg-white/5 text-sidebar-foreground/70 flex items-center justify-center hover:bg-white/10 hover:text-sidebar-foreground transition-all shrink-0"
          >
            {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronLeft className="w-3 h-3" />}
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {navItems.map((item) => {
          const active = page === item.key;
          return (
            <button
              key={item.key}
              type="button"
              onClick={() => {
                setPage(item.key);
                onClose?.();
              }}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-[2px] transition-colors text-left group",
                collapsed && !mobile && "justify-center px-2",
                active
                  ? "bg-sidebar-accent text-white font-medium"
                  : "text-sidebar-foreground/70 hover:bg-white/5 hover:text-sidebar-foreground",
              )}
              title={collapsed && !mobile ? item.label : undefined}
            >
              <div className={cn("shrink-0 transition-colors", active ? "text-white" : "text-sidebar-foreground/60 group-hover:text-sidebar-foreground")}>
                {item.icon}
              </div>
              {(!collapsed || mobile) && (
                <span className="text-sm truncate flex-1">{item.label}</span>
              )}
            </button>
          );
        })}
      </nav>

      {(!collapsed || mobile) && (
        <div className="p-3 border-t border-white/10 space-y-2">
          <div className="flex items-center gap-2 px-1">
            <div className="w-8 h-8 rounded-full bg-accent flex items-center justify-center shrink-0">
              <span className="text-[11px] font-display font-medium text-accent-foreground">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-sidebar-foreground truncate">{displayName || "Teacher"}</div>
              <div className="text-xs text-sidebar-foreground/60 truncate font-mono">{employeeId || "—"}</div>
            </div>
          </div>
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-[2px] text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-white/5 text-xs transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          )}
        </div>
      )}
    </aside>
  );
}

export default function TeacherApp() {
  const navigate = useNavigate();
  const location = useLocation();
  const { signOut } = useAuth();
  const identity = useTeacherIdentity();
  const page = useMemo(() => teacherPathToPage(location.pathname), [location.pathname]);
  const setPage = (p: TeacherPageKey) => navigate(TEACHER_PAGE_PATH[p]);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const displayName = identity.name || "Teacher";
  const employeeId = identity.employeeId || "—";
  const initials = teacherInitials(displayName, "?");

  const handleSignOut = async () => {
    await signOut();
    navigate("/auth");
  };

  const sidebarProps = {
    page,
    setPage,
    displayName,
    employeeId,
    initials,
    onSignOut: handleSignOut,
  };

  return (
    <div className="gurukul-teacher flex h-screen bg-background text-foreground overflow-hidden">
      <div className="hidden md:flex flex-col shrink-0 h-screen">
        <Sidebar
          {...sidebarProps}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
        />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-modal md:hidden flex">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative z-modal flex h-full">
            <Sidebar
              {...sidebarProps}
              collapsed={false}
              setCollapsed={() => {}}
              mobile
              onClose={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <header className="relative z-40 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-border bg-card/95 backdrop-blur-xl shrink-0 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="md:hidden w-8 h-8 rounded-lg bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground shrink-0"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <div className="text-sm font-black text-foreground truncate">{TEACHER_PAGE_TITLES[page]}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                {displayName} · {employeeId}
              </div>
            </div>
          </div>
          <MembershipSwitcher className="shrink-0" />
          <button
            type="button"
            onClick={() => setPage("profile")}
            className="w-8 h-8 rounded-[2px] bg-primary flex items-center justify-center shrink-0"
          >
            <span className="text-xs font-black text-primary-foreground">{initials}</span>
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-[1400px] mx-auto">
            <Routes>
              <Route index element={<TeacherHome setPage={setPage} />} />
              <Route path="classes" element={<MyClasses />} />
              <Route path="classes/:classId/attendance" element={<TeacherAttendancePage />} />
              <Route path="attendance" element={<TeacherAttendancePage />} />
              <Route path="attendance/:classId" element={<TeacherAttendancePage />} />
              <Route path="doubts" element={<Doubts />} />
              <Route path="announcements" element={<Announcements />} />
              <Route path="leave" element={<Leave />} />
              <Route path="profile" element={<TeacherProfile />} />
              <Route path="question-papers" element={<QuestionPapers />} />
              {/* The teachers' AI is the question-paper maker and nothing else, so
                  its old address and the retired Question Bank both land there. */}
              <Route path="ai-coach" element={<Navigate to="/teacher/question-papers" replace />} />
              <Route path="question-bank" element={<Navigate to="/teacher/question-papers" replace />} />
              <Route path="practice" element={<Navigate to="/teacher/question-papers" replace />} />
              <Route path="resources" element={<TeacherResources />} />
              <Route path="battleground" element={<TeacherBattleground />} />
              <Route path="battleground/monitor/:id" element={<BattleMonitor />} />
              {/* A student's battle report is practice (§10.8): the student and
                  nobody else. The route and its page are removed rather than
                  left unreachable — an unrouted component is one PR away from
                  being routed again. The RLS policy and rpc_ensure_battle_report
                  were narrowed to the owner in the same migration, so the data
                  is closed even if a caller reappears. */}
              <Route path="class" element={<Navigate to="/teacher/classes" replace />} />
              <Route path="my-class" element={<Navigate to="/teacher/classes" replace />} />
              <Route path="my-subjects" element={<Navigate to="/teacher/classes" replace />} />
              <Route path="exams" element={<RedirectTeacherClassTab tab="exams-marks" />} />
              {/* Was a placeholder redirect to /teacher/classes, which has no timetable.
                  TeacherTimetablePage was dark, not broken: every identifier it uses
                  (teachers.class_teacher_of, teacher_classes.class_id,
                  class_timetables.grid) checks out against the live schema. */}
              <Route path="timetable" element={<TeacherTimetablePage />} />
              <Route path="performance" element={<RedirectTeacherClassTab tab="insights" />} />
              <Route path="homework" element={<RedirectTeacherClassTab tab="homework" />} />
              <Route path="notices" element={<Navigate to="/teacher/announcements" replace />} />
              <Route path="leaves" element={<Navigate to="/teacher/leave" replace />} />
              <Route path="insights" element={<RedirectTeacherClassTab tab="insights" />} />
              <Route path="reports" element={<RedirectTeacherClassTab tab="insights" />} />
              <Route path="test/*" element={<RedirectTeacherClassTab tab="tests" />} />
              <Route path="*" element={<Navigate to="/teacher" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
