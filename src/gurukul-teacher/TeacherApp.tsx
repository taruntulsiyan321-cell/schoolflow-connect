import { useMemo, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, BookOpen, HelpCircle, MessageCircle, Megaphone,
  Calendar, User, ChevronLeft, ChevronRight, GraduationCap, Menu, LogOut,
  Swords, Library,
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
import Communication from "./Communication";
import Announcements from "./Announcements";
import Leave from "./Leave";
import TeacherProfile from "./Profile";
import { useTeacherIdentity, teacherInitials } from "./useTeacherIdentity";
import { useAuth } from "@/hooks/useAuth";
import QuestionBankPage from "@/pages/shared/QuestionBankPage";
import TeacherBattleground from "@/pages/teacher/TeacherBattleground";
import BattleMonitor from "@/pages/teacher/BattleMonitor";
import BattleTeacherReport from "@/pages/teacher/BattleTeacherReport";

/** Set My Classes sub-tab then bounce to /teacher/classes (sessionStorage contract). */
function RedirectTeacherClassTab({ tab }: { tab: string }) {
  try {
    sessionStorage.setItem("teacher.openTab", tab);
  } catch {
    /* ignore */
  }
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
  { key: "questionbank", label: "Question Bank", icon: <Library className="w-4 h-4" /> },
  { key: "doubts", label: "Student Doubts", icon: <HelpCircle className="w-4 h-4" /> },
  { key: "communication", label: "Communication", icon: <MessageCircle className="w-4 h-4" /> },
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
    <aside className={cn(
      "flex flex-col h-full bg-[#0a0a0c] border-r border-white/7 transition-all duration-300 shrink-0",
      mobile ? "w-64" : collapsed ? "w-16" : "w-60",
    )}>
      <div className={cn("flex items-center gap-3 px-4 py-5 border-b border-white/7 min-h-[72px]", collapsed && !mobile && "justify-center px-2")}>
        <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center shrink-0">
          <GraduationCap className="w-4 h-4 text-black" />
        </div>
        {(!collapsed || mobile) && (
          <div className="flex-1 min-w-0">
            <div className="text-xs font-black text-white leading-none">Gurukul</div>
            <div className="text-[9px] text-[#3b5bdb] font-semibold mt-0.5">Teacher Panel</div>
          </div>
        )}
        {!mobile && (
          <button
            type="button"
            onClick={() => setCollapsed(!collapsed)}
            className="w-6 h-6 rounded-lg bg-white/5 text-[#46465a] flex items-center justify-center hover:bg-white/10 hover:text-white transition-all shrink-0"
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
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left group",
                collapsed && !mobile && "justify-center px-2",
                active
                  ? "bg-[#3b5bdb]/10 text-[#3b5bdb]"
                  : "text-[#78788c] hover:bg-white/5 hover:text-white",
              )}
              title={collapsed && !mobile ? item.label : undefined}
            >
              <div className={cn("shrink-0 transition-all", active ? "text-[#3b5bdb]" : "text-[#46465a] group-hover:text-white")}>
                {item.icon}
              </div>
              {(!collapsed || mobile) && (
                <>
                  <span className="text-xs font-semibold truncate">{item.label}</span>
                  {active && <div className="w-1.5 h-1.5 rounded-full bg-[#3b5bdb] ml-auto shrink-0" />}
                </>
              )}
            </button>
          );
        })}
      </nav>

      {(!collapsed || mobile) && (
        <div className="p-3 border-t border-white/7 space-y-2">
          <div className="flex items-center gap-2 px-1">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center shrink-0">
              <span className="text-[11px] font-black text-black">{initials}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-white truncate">{displayName || "Teacher"}</div>
              <div className="text-[9px] text-[#46465a] truncate">{employeeId || "—"}</div>
            </div>
          </div>
          {onSignOut && (
            <button
              type="button"
              onClick={onSignOut}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-[#78788c] hover:text-white hover:bg-white/5 text-xs font-medium transition-all"
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
    <div className="gurukul-teacher dark flex h-screen bg-[#0d0d0f] text-white overflow-hidden">
      <div className="hidden md:flex flex-col shrink-0 h-screen">
        <Sidebar
          {...sidebarProps}
          collapsed={collapsed}
          setCollapsed={setCollapsed}
        />
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="relative z-50 flex h-full">
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
        <header className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/7 bg-[#0d0d0f] shrink-0 gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              className="md:hidden w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-[#78788c] hover:text-white shrink-0"
            >
              <Menu className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <div className="text-sm font-black text-white truncate">{TEACHER_PAGE_TITLES[page]}</div>
              <div className="text-[10px] text-[#46465a] mt-0.5 truncate">
                {displayName} · {employeeId}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPage("profile")}
            className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#3b5bdb] to-[#6882e8] flex items-center justify-center shrink-0"
          >
            <span className="text-xs font-black text-black">{initials}</span>
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
              <Route path="communication" element={<Communication />} />
              <Route path="announcements" element={<Announcements />} />
              <Route path="leave" element={<Leave />} />
              <Route path="profile" element={<TeacherProfile />} />
              <Route path="question-bank" element={<QuestionBankPage />} />
              <Route path="practice" element={<Navigate to="/teacher/question-bank" replace />} />
              <Route path="battleground" element={<TeacherBattleground />} />
              <Route path="battleground/monitor/:id" element={<BattleMonitor />} />
              <Route path="battleground/monitor/:id/report/:participantId" element={<BattleTeacherReport />} />
              <Route path="class" element={<Navigate to="/teacher/classes" replace />} />
              <Route path="my-class" element={<Navigate to="/teacher/classes" replace />} />
              <Route path="my-subjects" element={<Navigate to="/teacher/classes" replace />} />
              <Route path="exams" element={<RedirectTeacherClassTab tab="exams-marks" />} />
              <Route path="timetable" element={<Navigate to="/teacher/classes" replace />} />
              <Route path="performance" element={<RedirectTeacherClassTab tab="insights" />} />
              <Route path="homework" element={<RedirectTeacherClassTab tab="homework" />} />
              <Route path="chat" element={<Navigate to="/teacher/communication" replace />} />
              <Route path="connect" element={<Navigate to="/teacher/communication" replace />} />
              <Route path="notices" element={<Navigate to="/teacher/announcements" replace />} />
              <Route path="leaves" element={<Navigate to="/teacher/leave" replace />} />
              <Route path="insights" element={<RedirectTeacherClassTab tab="insights" />} />
              <Route path="reports" element={<RedirectTeacherClassTab tab="insights" />} />
              <Route path="dpp/*" element={<RedirectTeacherClassTab tab="tests" />} />
              <Route path="*" element={<Navigate to="/teacher" replace />} />
            </Routes>
          </div>
        </main>
      </div>
    </div>
  );
}
