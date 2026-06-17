import { useEffect, useState } from "react";
import { Routes, Route, Navigate, Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LayoutDashboard, ClipboardCheck, Bell, Wallet, FileText, Trophy, BookOpen, NotebookPen, CalendarDays, MessageSquare, User, Sword, Target, Megaphone, Brain, BookMarked, ListChecks, BarChart3, Sparkles, Wrench } from "lucide-react";
import RecoveryZone from "./student/RecoveryZone";
import RecoverySession from "./student/RecoverySession";
import StudentSuccessHome from "./student/StudentSuccessHome";
import MistakeBank from "./student/MistakeBank";
import RevisionQueue from "./student/RevisionQueue";
import ImprovementPlans from "./student/ImprovementPlans";
import AcademicAnalytics from "./student/AcademicAnalytics";
import AcademicReport from "./student/AcademicReport";
import Battleground from "./student/Battleground";
import Class12MathPractice from "./student/Class12MathPractice";
import Class12MathSession from "./student/Class12MathSession";
import Class12AiSession from "./student/Class12AiSession";
import PracticeSessionResult from "./student/PracticeSessionResult";
import DppAttempt from "./student/DppAttempt";
import DppResult from "./student/DppResult";
import StudentProfilePage from "./shared/StudentProfilePage";
import StudentClassesPage from "./shared/StudentClassesPage";
import StudentExamsPage from "./shared/StudentExamsPage";
import StudentTimetablePage from "./shared/StudentTimetablePage";
import StudentHomeworkPage from "./shared/StudentHomeworkPage";
import ChatPage from "./shared/ChatPage";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { PageHeader, StatCard } from "@/components/ui-bits";
import NoticesPage from "./shared/NoticesPage";
import NotificationsPage from "./shared/NotificationsPage";
import MyFeesPage from "./shared/MyFeesPage";
import MyMarksPage from "./shared/MyMarksPage";
import LeaderboardPage from "./shared/LeaderboardPage";
import { StudentListSkeleton } from "@/components/student/StudentPanelStates";

const nav = [
  { to: "/student", label: "Dashboard", icon: <Brain className="w-4 h-4" /> },
  { to: "/student/practice/math12", label: "Practice", icon: <Target className="w-4 h-4" /> },
  { to: "/student/recovery", label: "Recovery", icon: <Wrench className="w-4 h-4" />, end: false },
  { to: "/student/analytics", label: "Analysis", icon: <BarChart3 className="w-4 h-4" /> },
  { to: "/student/battleground", label: "Battleground", icon: <Sword className="w-4 h-4" />, end: false },
  { to: "/student/classes", label: "Classes", icon: <BookOpen className="w-4 h-4" /> },
  { to: "/student/homework", label: "Homework", icon: <NotebookPen className="w-4 h-4" /> },
  { to: "/student/attendance", label: "Attendance", icon: <ClipboardCheck className="w-4 h-4" /> },
  { to: "/student/timetable", label: "Timetable", icon: <CalendarDays className="w-4 h-4" /> },
  { to: "/student/exams", label: "Exams", icon: <FileText className="w-4 h-4" /> },
  { to: "/student/results", label: "Results", icon: <Trophy className="w-4 h-4" /> },
  { to: "/student/notifications", label: "Notifications", icon: <Bell className="w-4 h-4" /> },
  { to: "/student/notices", label: "Notices", icon: <Megaphone className="w-4 h-4" /> },
  { to: "/student/fees", label: "Fees", icon: <Wallet className="w-4 h-4" /> },
  { to: "/student/chat", label: "Chat", icon: <MessageSquare className="w-4 h-4" /> },
  { to: "/student/profile", label: "Profile", icon: <User className="w-4 h-4" /> },
];

const Home = () => {
  const { user } = useAuth();
  const [student, setStudent] = useState<any>(null);
  const [pct, setPct] = useState(0);
  const [pendingFees, setPendingFees] = useState(0);
  const [latestNotices, setLatestNotices] = useState<any[]>([]);
  const [xp, setXp] = useState<any>(null);
  const [rank, setRank] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: s } = await supabase.from("students").select("*, classes(name,section)").eq("user_id", user.id).maybeSingle();
      setStudent(s);
      if (s) {
        const { data: att } = await supabase.from("attendance").select("status").eq("student_id", s.id);
        if (att?.length) setPct(Math.round((att.filter(a => a.status === "present").length / att.length) * 100));
        const { data: f } = await supabase.from("fees").select("amount,paid_amount,status").eq("student_id", s.id);
        const owed = (f ?? []).filter(r => r.status !== "paid").reduce((sum, r) => sum + (Number(r.amount) - Number(r.paid_amount)), 0);
        setPendingFees(owed);
      }
      const { data: x } = await supabase.from("student_xp").select("xp, level, current_streak").eq("user_id", user.id).maybeSingle();
      setXp(x);
      const { data: lb } = await supabase.rpc("rpc_leaderboard", { _scope: "class", _category: "xp", _subject: undefined, _limit: 200 });
      if (Array.isArray(lb)) {
        const i = lb.findIndex((r: any) => r.user_id === user.id);
        setRank(i >= 0 ? i + 1 : null);
      }
      const { data: n } = await supabase.from("notices").select("*").order("created_at", { ascending: false }).limit(3);
      setLatestNotices(n ?? []);
    })();
  }, [user]);

  return (
    <>
      <PageHeader
        eyebrow="Student workspace"
        title={`Welcome, ${student?.full_name?.split(" ")[0] || "Student"}`}
        subtitle={student?.classes ? `Class ${student.classes.name}-${student.classes.section} · Roll ${student.roll_number || "—"}` : "Your academic hub"}
      />

      <Link to="/student/battleground" className="block mb-6 group">
        <Card className="hero-panel p-5 transition-shadow hover:shadow-elevated">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-white/10 flex items-center justify-center ring-1 ring-white/15">
              <Sword className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-wide text-white/70">Competition</div>
              <div className="font-semibold text-lg mt-0.5">Battleground</div>
              <div className="text-sm text-white/75 mt-0.5">Live quizzes, class rankings, and progress analytics</div>
            </div>
            <span className="text-xs px-3 py-2 rounded-lg bg-primary text-primary-foreground font-semibold shrink-0">Open</span>
          </div>
        </Card>
      </Link>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<ClipboardCheck className="w-5 h-5" />} label="Attendance" value={`${pct}%`} tone={pct >= 75 ? "accent" : "warning"} />
        <StatCard icon={<Wallet className="w-5 h-5" />} label="Pending Fees" value={pendingFees ? `₹${pendingFees}` : "₹0"} tone={pendingFees > 0 ? "warning" : "accent"} />
        <Link to="/student/battleground/progress"><StatCard icon={<Sword className="w-5 h-5" />} label="Level / XP" value={xp ? `L${xp.level} · ${xp.xp}` : "L1 · 0"} /></Link>
        <Link to="/student/classes#leaderboard"><StatCard icon={<Trophy className="w-5 h-5" />} label="Class Rank" value={rank ? `#${rank}` : "—"} tone="accent" /></Link>
      </div>
      <h3 className="font-semibold mb-3">Latest notices</h3>
      <div className="space-y-2">
        {latestNotices.map(n => (
          <Card key={n.id} className="p-4 shadow-card">
            <div className="font-medium">{n.title}</div>
            <p className="text-sm text-muted-foreground line-clamp-2 mt-1">{n.body}</p>
          </Card>
        ))}
        {latestNotices.length === 0 && <p className="text-muted-foreground text-sm">No notices.</p>}
      </div>
    </>
  );
};

const MyAttendance = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      if (!user) return;
      setLoading(true);
      const { data: s } = await supabase.from("students").select("id").eq("user_id", user.id).maybeSingle();
      if (!s) { setLoading(false); return; }
      const { data } = await supabase.from("attendance").select("*").eq("student_id", s.id).order("date", { ascending: false }).limit(60);
      setRows(data ?? []);
      setLoading(false);
    })();
  }, [user]);
  const colors: any = { present: "bg-accent/10 text-accent", absent: "bg-destructive/10 text-destructive", leave: "bg-warning/10 text-warning" };
  return (
    <>
      <PageHeader title="My Attendance" subtitle={loading ? "Loading records…" : `Last ${rows.length} days`} />
      {loading && <StudentListSkeleton rows={6} />}
      <div className="space-y-2">
        {!loading && rows.map(r => (
          <Card key={r.id} className="p-3 flex items-center justify-between shadow-card">
            <span className="font-medium">{new Date(r.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
            <span className={`text-xs px-2.5 py-1 rounded-full capitalize font-medium ${colors[r.status]}`}>{r.status}</span>
          </Card>
        ))}
        {!loading && rows.length === 0 && <p className="text-muted-foreground text-center py-8">No records yet.</p>}
      </div>
    </>
  );
};

export default function StudentDashboard() {
  return (
    <AppLayout nav={nav} title="Student">
      <Routes>
        <Route index element={<StudentSuccessHome />} />
        <Route path="revision" element={<RevisionQueue />} />
        <Route path="plans" element={<ImprovementPlans />} />
        <Route path="recovery" element={<RecoveryZone />} />
        <Route path="recovery/:id" element={<RecoverySession />} />
        <Route path="mistakes" element={<MistakeBank />} />
        <Route path="analytics" element={<AcademicAnalytics />} />
        <Route path="report" element={<AcademicReport />} />
        <Route path="classes" element={<StudentClassesPage />} />
        <Route path="homework" element={<StudentHomeworkPage />} />
        <Route path="attendance" element={<MyAttendance />} />
        <Route path="timetable" element={<StudentTimetablePage />} />
        <Route path="exams" element={<StudentExamsPage />} />
        <Route path="results" element={<MyMarksPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="notices" element={<NoticesPage viewerRole="student" />} />
        <Route path="fees" element={<MyFeesPage />} />
        <Route path="chat" element={<ChatPage userRole="student" />} />
        <Route path="profile" element={<StudentProfilePage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="battleground/*" element={<Battleground />} />
        <Route path="dpp" element={<Navigate to="/student" replace />} />
        <Route path="practice/math12" element={<Class12MathPractice />} />
        <Route path="practice/math12/session" element={<Class12MathSession />} />
        <Route path="practice/ai/session" element={<Class12AiSession />} />
        <Route path="practice/session/:id/result" element={<PracticeSessionResult />} />
        <Route path="dpp/:id/attempt" element={<DppAttempt />} />
        <Route path="dpp/:id/result" element={<DppResult />} />
        <Route path="*" element={<Navigate to="/student" replace />} />
      </Routes>
    </AppLayout>
  );
}
