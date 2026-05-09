import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  BookOpen,
  Wallet,
  FileText,
  Bell,
  CalendarOff,
  BarChart3,
  UserCheck,
  CalendarDays,
  Activity,
  User,
  TrendingUp,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { PageHeader, StatCard } from "@/components/ui-bits";
import NoticesPage from "./shared/NoticesPage";
import ExamsPage from "./shared/ExamsPage";
import LeaveRequestsPage from "./shared/LeaveRequestsPage";
import LeaderboardPage from "./shared/LeaderboardPage";
import StudentsAdmin from "./admin/StudentsAdmin";
import PrincipalClasses from "./principal/PrincipalClasses";
import PrincipalClassDetail from "./principal/PrincipalClassDetail";
import {
  PresentToday,
  TeachersDirectory,
  PerformancePage,
  FeesOverview,
  ActivityLogPage,
  ReportsPage,
  TimetablePage,
  ProfilePage,
  AttendanceOverview,
} from "./shared/SchoolFeatures";

const nav = [
  { to: "/principal", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: "/principal/classes", label: "All Classes", icon: <BookOpen className="w-4 h-4" /> },
  { to: "/principal/students", label: "Students", icon: <Users className="w-4 h-4" /> },
  { to: "/principal/present", label: "Present", icon: <UserCheck className="w-4 h-4" /> },
  { to: "/principal/analytics", label: "Attendance", icon: <BarChart3 className="w-4 h-4" /> },
  { to: "/principal/teachers", label: "Teachers", icon: <GraduationCap className="w-4 h-4" /> },
  { to: "/principal/reports", label: "Reports", icon: <FileText className="w-4 h-4" /> },
  { to: "/principal/performance", label: "Performance", icon: <TrendingUp className="w-4 h-4" /> },
  { to: "/principal/fees", label: "Fees", icon: <Wallet className="w-4 h-4" /> },
  { to: "/principal/timetable", label: "Timetable", icon: <CalendarDays className="w-4 h-4" /> },
  { to: "/principal/notices", label: "Notifications", icon: <Bell className="w-4 h-4" /> },
  { to: "/principal/activity", label: "Activity Logs", icon: <Activity className="w-4 h-4" /> },
  { to: "/principal/leaves", label: "Leaves", icon: <CalendarOff className="w-4 h-4" /> },
  { to: "/principal/profile", label: "Profile", icon: <User className="w-4 h-4" /> },
];

const Overview = () => {
  const [stats, setStats] = useState({ students: 0, teachers: 0, classes: 0, pending: 0, present: 0, total: 0 });
  useEffect(() => {
    (async () => {
      const today = new Date().toISOString().split("T")[0];
      const [s, t, c, l, attToday] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase.from("teachers").select("id", { count: "exact", head: true }),
        supabase.from("classes").select("id", { count: "exact", head: true }),
        supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("attendance").select("status").eq("date", today),
      ]);
      const present = (attToday.data ?? []).filter(r => r.status === "present").length;
      setStats({
        students: s.count ?? 0, teachers: t.count ?? 0, classes: c.count ?? 0,
        pending: l.count ?? 0, present, total: attToday.data?.length ?? 0,
      });
    })();
  }, []);
  const rate = stats.total ? Math.round((stats.present / stats.total) * 100) : 0;
  return (
    <>
      <PageHeader title="Principal Overview" subtitle="School-wide academic & operational view" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<Users className="w-5 h-5" />} label="Students" value={stats.students} />
        <StatCard icon={<GraduationCap className="w-5 h-5" />} label="Teachers" value={stats.teachers} tone="secondary" />
        <StatCard icon={<BookOpen className="w-5 h-5" />} label="Classes" value={stats.classes} tone="accent" />
        <StatCard icon={<CalendarOff className="w-5 h-5" />} label="Pending Leaves" value={stats.pending} tone="warning" />
      </div>
      <Card className="p-6 bg-gradient-primary text-primary-foreground mb-4">
        <div className="text-sm opacity-80">Today's attendance</div>
        <div className="text-4xl font-bold">{rate}%</div>
        <div className="text-sm opacity-80">{stats.present} of {stats.total} marked present</div>
      </Card>
      <Card className="p-5">
        <h3 className="font-semibold mb-2">Principal toolkit</h3>
        <p className="text-sm text-muted-foreground">Use the side menu to review pending leave requests, post school-wide notices, and monitor exams.</p>
      </Card>
    </>
  );
};


export default function PrincipalDashboard() {
  return (
    <AppLayout nav={nav} title="Principal">
      <Routes>
        <Route index element={<Overview />} />
        <Route path="analytics" element={<AttendanceOverview />} />
        <Route path="classes" element={<PrincipalClasses />} />
        <Route path="classes/:classId" element={<PrincipalClassDetail />} />
        <Route path="students" element={<StudentsAdmin />} />
        <Route path="present" element={<PresentToday />} />
        <Route path="teachers" element={<TeachersDirectory />} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="performance" element={<PerformancePage />} />
        <Route path="fees" element={<FeesOverview />} />
        <Route path="timetable" element={<TimetablePage title="Timetable Monitoring" />} />
        <Route path="activity" element={<ActivityLogPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="leaves" element={<LeaveRequestsPage canReview />} />
        <Route path="exams" element={<ExamsPage isAdmin />} />
        <Route path="notices" element={<NoticesPage canPost />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="*" element={<Navigate to="/principal" replace />} />
      </Routes>
    </AppLayout>
  );
}
