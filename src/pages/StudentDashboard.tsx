import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LayoutDashboard, ClipboardCheck, Bell, Wallet, FileText, Trophy, BookOpen, NotebookPen, CalendarDays, Library, MessageSquare, User } from "lucide-react";
import StudentProfilePage from "./shared/StudentProfilePage";
import StudentClassesPage from "./shared/StudentClassesPage";
import StudentExamsPage from "./shared/StudentExamsPage";
import StudentTimetablePage from "./shared/StudentTimetablePage";
import StudentHomeworkPage from "./shared/StudentHomeworkPage";
import StudentLibraryPage from "./shared/StudentLibraryPage";
import ChatPage from "./shared/ChatPage";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { PageHeader, StatCard } from "@/components/ui-bits";
import NoticesPage from "./shared/NoticesPage";
import MyFeesPage from "./shared/MyFeesPage";
import MyMarksPage from "./shared/MyMarksPage";
import LeaderboardPage from "./shared/LeaderboardPage";

const nav = [
  { to: "/student", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: "/student/classes", label: "Classes", icon: <BookOpen className="w-4 h-4" /> },
  { to: "/student/homework", label: "Homework", icon: <NotebookPen className="w-4 h-4" /> },
  { to: "/student/attendance", label: "Attendance", icon: <ClipboardCheck className="w-4 h-4" /> },
  { to: "/student/timetable", label: "Timetable", icon: <CalendarDays className="w-4 h-4" /> },
  { to: "/student/exams", label: "Exams", icon: <FileText className="w-4 h-4" /> },
  { to: "/student/results", label: "Results", icon: <Trophy className="w-4 h-4" /> },
  { to: "/student/notifications", label: "Notifications", icon: <Bell className="w-4 h-4" /> },
  { to: "/student/fees", label: "Fees", icon: <Wallet className="w-4 h-4" /> },
  { to: "/student/library", label: "Library", icon: <Library className="w-4 h-4" /> },
  { to: "/student/chat", label: "Chat", icon: <MessageSquare className="w-4 h-4" /> },
  { to: "/student/profile", label: "Profile", icon: <User className="w-4 h-4" /> },
];

const Home = () => {
  const { user } = useAuth();
  const [student, setStudent] = useState<any>(null);
  const [pct, setPct] = useState(0);
  const [pendingFees, setPendingFees] = useState(0);
  const [latestNotices, setLatestNotices] = useState<any[]>([]);

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
      const { data: n } = await supabase.from("notices").select("*").order("created_at", { ascending: false }).limit(3);
      setLatestNotices(n ?? []);
    })();
  }, [user]);

  return (
    <>
      <PageHeader title={`Hi, ${student?.full_name?.split(" ")[0] || "Student"} 👋`}
        subtitle={student?.classes ? `Class ${student.classes.name}-${student.classes.section} · Roll ${student.roll_number || "-"}` : "Profile not linked yet"} />
      {!student && (
        <Card className="p-5 mb-4 border-warning/30 bg-warning/5">
          <p className="text-sm">Your account isn't linked yet. Ask admin to link <strong>{user?.email}</strong> from the Link Users panel.</p>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <StatCard icon={<ClipboardCheck className="w-5 h-5" />} label="Attendance" value={`${pct}%`} tone={pct >= 75 ? "accent" : "warning"} />
        <StatCard icon={<Wallet className="w-5 h-5" />} label="Pending Fees" value={pendingFees ? `₹${pendingFees}` : "₹0"} tone={pendingFees > 0 ? "warning" : "accent"} />
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
  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: s } = await supabase.from("students").select("id").eq("user_id", user.id).maybeSingle();
      if (!s) return;
      const { data } = await supabase.from("attendance").select("*").eq("student_id", s.id).order("date", { ascending: false }).limit(60);
      setRows(data ?? []);
    })();
  }, [user]);
  const colors: any = { present: "bg-accent/10 text-accent", absent: "bg-destructive/10 text-destructive", leave: "bg-warning/10 text-warning" };
  return (
    <>
      <PageHeader title="My Attendance" subtitle={`Last ${rows.length} days`} />
      <div className="space-y-2">
        {rows.map(r => (
          <Card key={r.id} className="p-3 flex items-center justify-between shadow-card">
            <span className="font-medium">{new Date(r.date).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</span>
            <span className={`text-xs px-2.5 py-1 rounded-full capitalize font-medium ${colors[r.status]}`}>{r.status}</span>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-muted-foreground text-center py-8">No records yet.</p>}
      </div>
    </>
  );
};

export default function StudentDashboard() {
  return (
    <AppLayout nav={nav} title="Student">
      <Routes>
        <Route index element={<Home />} />
        <Route path="classes" element={<StudentClassesPage />} />
        <Route path="homework" element={<StudentHomeworkPage />} />
        <Route path="attendance" element={<MyAttendance />} />
        <Route path="timetable" element={<StudentTimetablePage />} />
        <Route path="exams" element={<StudentExamsPage />} />
        <Route path="results" element={<MyMarksPage />} />
        <Route path="notifications" element={<NoticesPage />} />
        <Route path="fees" element={<MyFeesPage />} />
        <Route path="library" element={<StudentLibraryPage />} />
        <Route path="chat" element={<ChatPage userRole="student" />} />
        <Route path="profile" element={<StudentProfilePage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="*" element={<Navigate to="/student" replace />} />
      </Routes>
    </AppLayout>
  );
}
