import { useEffect, useState } from "react";
import { Routes, Route, Navigate, Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LayoutDashboard, Users, GraduationCap, Bell, BookOpen, Wallet, FileText, ShieldCheck, ClipboardCheck, CalendarDays, Settings, User, AlertCircle, TrendingUp, UserPlus, ArrowRight, CheckCircle2, Clock } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { StatCard, PageHeader } from "@/components/ui-bits";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import StudentsAdmin from "./admin/StudentsAdmin";
import TeacherProfile from "./admin/TeacherProfile";
import TeachersAdmin from "./admin/TeachersAdmin";
import ClassesAdmin from "./admin/ClassesAdmin";
import FeesAdmin from "./admin/FeesAdmin";
import LinkUsersAdmin from "./admin/LinkUsersAdmin";
import RolesAdmin from "./admin/RolesAdmin";
import NoticesPage from "./shared/NoticesPage";
import ExamsPage from "./shared/ExamsPage";
import {
  UsersDirectory, AttendanceOverview, ReportsPage, TimetablePage,
  AppSettingsPage, ProfilePage,
} from "./shared/SchoolFeatures";

const nav = [
  { to: "/admin", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: "/admin/users", label: "Users", icon: <Users className="w-4 h-4" /> },
  { to: "/admin/students", label: "Students", icon: <Users className="w-4 h-4" /> },
  { to: "/admin/teachers", label: "Teachers", icon: <GraduationCap className="w-4 h-4" /> },
  { to: "/admin/classes", label: "Classes", icon: <BookOpen className="w-4 h-4" /> },
  { to: "/admin/fees", label: "Fees", icon: <Wallet className="w-4 h-4" /> },
  { to: "/admin/attendance", label: "Attendance", icon: <ClipboardCheck className="w-4 h-4" /> },
  { to: "/admin/reports", label: "Reports", icon: <FileText className="w-4 h-4" /> },
  { to: "/admin/timetable", label: "Timetable", icon: <CalendarDays className="w-4 h-4" /> },
  { to: "/admin/notices", label: "Notifications", icon: <Bell className="w-4 h-4" /> },
  { to: "/admin/roles", label: "Student Access", icon: <ShieldCheck className="w-4 h-4" /> },
  { to: "/admin/settings", label: "App Settings", icon: <Settings className="w-4 h-4" /> },
  { to: "/admin/profile", label: "Profile", icon: <User className="w-4 h-4" /> },
];

const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
const timeAgo = (d: string) => {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const Overview = () => {
  const [stats, setStats] = useState({ students: 0, teachers: 0, classes: 0, notices: 0 });
  const [attendance, setAttendance] = useState({ present: 0, absent: 0, late: 0, total: 0 });
  const [fees, setFees] = useState({ unpaidCount: 0, dueAmount: 0, collectedThisMonth: 0 });
  const [pendingLeaves, setPendingLeaves] = useState(0);
  const [recentStudents, setRecentStudents] = useState<any[]>([]);
  const [recentTeachers, setRecentTeachers] = useState<any[]>([]);
  const [recentNotices, setRecentNotices] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const today = todayStr();
      const monthStart = today.slice(0, 7) + "-01";

      const [s, t, c, n, att, unpaid, paidMonth, leaves, rs, rt, rn] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase.from("teachers").select("id", { count: "exact", head: true }),
        supabase.from("classes").select("id", { count: "exact", head: true }),
        supabase.from("notices").select("id", { count: "exact", head: true }).is("revoked_at", null),
        supabase.from("attendance").select("status").eq("date", today),
        supabase.from("fees").select("amount, paid_amount, status").neq("status", "paid"),
        supabase.from("fees").select("paid_amount").eq("status", "paid").gte("updated_at", monthStart),
        supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("students").select("id, full_name, admission_number, created_at, classes(name,section)").order("created_at", { ascending: false }).limit(5),
        supabase.from("teachers").select("id, full_name, subject, created_at").order("created_at", { ascending: false }).limit(5),
        supabase.from("notices").select("id, title, audience, created_at").is("revoked_at", null).order("created_at", { ascending: false }).limit(5),
      ]);

      setStats({ students: s.count ?? 0, teachers: t.count ?? 0, classes: c.count ?? 0, notices: n.count ?? 0 });

      const rows = att.data ?? [];
      setAttendance({
        present: rows.filter(r => r.status === "present").length,
        absent: rows.filter(r => r.status === "absent").length,
        late: rows.filter(r => r.status === "late").length,
        total: rows.length,
      });

      const unpaidRows = unpaid.data ?? [];
      setFees({
        unpaidCount: unpaidRows.length,
        dueAmount: unpaidRows.reduce((a, r: any) => a + (Number(r.amount) - Number(r.paid_amount || 0)), 0),
        collectedThisMonth: (paidMonth.data ?? []).reduce((a, r: any) => a + Number(r.paid_amount || 0), 0),
      });

      setPendingLeaves(leaves.count ?? 0);
      setRecentStudents(rs.data ?? []);
      setRecentTeachers(rt.data ?? []);
      setRecentNotices(rn.data ?? []);
    })();
  }, []);

  const attRate = attendance.total ? Math.round((attendance.present / attendance.total) * 100) : 0;

  return (
    <>
      <PageHeader title="Admin Overview" subtitle="Today at a glance — what needs your attention" />

      {/* Key institutional stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<Users className="w-5 h-5" />} label="Students" value={stats.students} />
        <StatCard icon={<GraduationCap className="w-5 h-5" />} label="Teachers" value={stats.teachers} tone="secondary" />
        <StatCard icon={<BookOpen className="w-5 h-5" />} label="Classes" value={stats.classes} tone="accent" />
        <StatCard icon={<Bell className="w-5 h-5" />} label="Active Notices" value={stats.notices} tone="warning" />
      </div>

      {/* Operational alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Link to="/admin/attendance" className="block">
          <Card className="p-5 shadow-card hover:shadow-elevated transition-shadow h-full">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
                  <ClipboardCheck className="w-4 h-4" />
                </div>
                <h3 className="font-semibold text-sm">Today's Attendance</h3>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
            </div>
            {attendance.total === 0 ? (
              <p className="text-sm text-muted-foreground">Not marked yet for today.</p>
            ) : (
              <>
                <div className="text-3xl font-bold">{attRate}%</div>
                <div className="text-xs text-muted-foreground mb-3">present rate · {attendance.total} marked</div>
                <div className="flex gap-3 text-xs">
                  <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-accent" />{attendance.present} Present</span>
                  <span className="flex items-center gap-1"><AlertCircle className="w-3 h-3 text-destructive" />{attendance.absent} Absent</span>
                  <span className="flex items-center gap-1"><Clock className="w-3 h-3 text-warning" />{attendance.late} Late</span>
                </div>
              </>
            )}
          </Card>
        </Link>

        <Link to="/admin/fees" className="block">
          <Card className="p-5 shadow-card hover:shadow-elevated transition-shadow h-full">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-warning/10 text-warning flex items-center justify-center">
                  <Wallet className="w-4 h-4" />
                </div>
                <h3 className="font-semibold text-sm">Pending Fees</h3>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="text-3xl font-bold">{fmtMoney(fees.dueAmount)}</div>
            <div className="text-xs text-muted-foreground mb-3">{fees.unpaidCount} unpaid invoice{fees.unpaidCount === 1 ? "" : "s"}</div>
            <div className="text-xs flex items-center gap-1 text-accent">
              <TrendingUp className="w-3 h-3" /> {fmtMoney(fees.collectedThisMonth)} collected this month
            </div>
          </Card>
        </Link>

        <Link to="/admin/notices" className="block">
          <Card className="p-5 shadow-card hover:shadow-elevated transition-shadow h-full">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-secondary/10 text-secondary flex items-center justify-center">
                  <AlertCircle className="w-4 h-4" />
                </div>
                <h3 className="font-semibold text-sm">Action Required</h3>
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground" />
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Pending leave requests</span>
                <Badge variant={pendingLeaves > 0 ? "default" : "outline"}>{pendingLeaves}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Unpaid fee invoices</span>
                <Badge variant={fees.unpaidCount > 0 ? "default" : "outline"}>{fees.unpaidCount}</Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Attendance pending today</span>
                <Badge variant={attendance.total === 0 ? "destructive" : "outline"}>
                  {attendance.total === 0 ? "Not marked" : "Done"}
                </Badge>
              </div>
            </div>
          </Card>
        </Link>
      </div>

      {/* Activity feeds */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <Card className="p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <UserPlus className="w-4 h-4 text-primary" /> Recent Admissions
            </h3>
            <Link to="/admin/students" className="text-xs text-primary hover:underline">View all</Link>
          </div>
          <div className="space-y-3">
            {recentStudents.length === 0 && <p className="text-xs text-muted-foreground">No students yet.</p>}
            {recentStudents.map(s => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{s.full_name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    Adm# {s.admission_number}{s.classes ? ` · Class ${s.classes.name}-${s.classes.section}` : ""}
                  </div>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">{timeAgo(s.created_at)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-secondary" /> Recently Onboarded Teachers
            </h3>
            <Link to="/admin/teachers" className="text-xs text-primary hover:underline">View all</Link>
          </div>
          <div className="space-y-3">
            {recentTeachers.length === 0 && <p className="text-xs text-muted-foreground">No teachers yet.</p>}
            {recentTeachers.map(t => (
              <div key={t.id} className="flex items-center justify-between text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{t.full_name}</div>
                  <div className="text-xs text-muted-foreground truncate">{t.subject || "Subject not set"}</div>
                </div>
                <span className="text-xs text-muted-foreground shrink-0 ml-2">{timeAgo(t.created_at)}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold flex items-center gap-2">
              <Bell className="w-4 h-4 text-warning" /> Latest Notices
            </h3>
            <Link to="/admin/notices" className="text-xs text-primary hover:underline">View all</Link>
          </div>
          <div className="space-y-3">
            {recentNotices.length === 0 && <p className="text-xs text-muted-foreground">No notices posted.</p>}
            {recentNotices.map(n => (
              <div key={n.id} className="flex items-start justify-between text-sm gap-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{n.title}</div>
                  <div className="text-xs text-muted-foreground capitalize">{n.audience}</div>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{timeAgo(n.created_at)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
};

export default function AdminDashboard() {
  return (
    <AppLayout nav={nav} title="Admin Panel">
      <Routes>
        <Route index element={<Overview />} />
        <Route path="users" element={<UsersDirectory />} />
        <Route path="students" element={<StudentsAdmin />} />
        <Route path="teachers" element={<TeachersAdmin />} />
        <Route path="teachers/:id" element={<TeacherProfile />} />
        <Route path="classes" element={<ClassesAdmin />} />
        <Route path="fees" element={<FeesAdmin />} />
        <Route path="attendance" element={<AttendanceOverview />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="timetable" element={<TimetablePage title="Timetable" />} />
        <Route path="exams" element={<ExamsPage isAdmin />} />
        <Route path="notices" element={<NoticesPage canPost />} />
        <Route path="settings" element={<AppSettingsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="links" element={<LinkUsersAdmin />} />
        <Route path="roles" element={<RolesAdmin />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AppLayout>
  );
}
