import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LayoutDashboard, Users, GraduationCap, Bell, BookOpen, Wallet, FileText, Link2, ShieldCheck, ClipboardCheck, CalendarDays, Settings, Database, User, KeyRound } from "lucide-react";
import PlaceholderPage from "./shared/PlaceholderPage";
import { supabase } from "@/integrations/supabase/client";
import { StatCard, PageHeader } from "@/components/ui-bits";
import { Card } from "@/components/ui/card";
import StudentsAdmin from "./admin/StudentsAdmin";
import TeachersAdmin from "./admin/TeachersAdmin";
import ClassesAdmin from "./admin/ClassesAdmin";
import FeesAdmin from "./admin/FeesAdmin";
import LinkUsersAdmin from "./admin/LinkUsersAdmin";
import RolesAdmin from "./admin/RolesAdmin";
import NoticesPage from "./shared/NoticesPage";
import ExamsPage from "./shared/ExamsPage";

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
  { to: "/admin/permissions", label: "Permissions", icon: <KeyRound className="w-4 h-4" /> },
  { to: "/admin/roles", label: "Roles", icon: <ShieldCheck className="w-4 h-4" /> },
  { to: "/admin/settings", label: "App Settings", icon: <Settings className="w-4 h-4" /> },
  { to: "/admin/system", label: "System", icon: <Database className="w-4 h-4" /> },
  { to: "/admin/links", label: "Link Users", icon: <Link2 className="w-4 h-4" /> },
  { to: "/admin/profile", label: "Profile", icon: <User className="w-4 h-4" /> },
];

const Overview = () => {
  const [stats, setStats] = useState({ students: 0, teachers: 0, classes: 0, notices: 0 });
  useEffect(() => {
    (async () => {
      const [s, t, c, n] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase.from("teachers").select("id", { count: "exact", head: true }),
        supabase.from("classes").select("id", { count: "exact", head: true }),
        supabase.from("notices").select("id", { count: "exact", head: true }),
      ]);
      setStats({ students: s.count ?? 0, teachers: t.count ?? 0, classes: c.count ?? 0, notices: n.count ?? 0 });
    })();
  }, []);
  return (
    <>
      <PageHeader title="Admin Overview" subtitle="Manage your entire school in one place" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={<Users className="w-5 h-5" />} label="Students" value={stats.students} />
        <StatCard icon={<GraduationCap className="w-5 h-5" />} label="Teachers" value={stats.teachers} tone="secondary" />
        <StatCard icon={<BookOpen className="w-5 h-5" />} label="Classes" value={stats.classes} tone="accent" />
        <StatCard icon={<Bell className="w-5 h-5" />} label="Notices" value={stats.notices} tone="warning" />
      </div>
      <Card className="p-6 bg-gradient-primary text-primary-foreground">
        <h3 className="text-xl font-bold mb-2">Welcome, Principal 👋</h3>
        <p className="text-primary-foreground/80 text-sm">Set up classes → enroll students → assign teachers → generate fees → create exams → broadcast notices.</p>
      </Card>
    </>
  );
};

export default function AdminDashboard() {
  return (
    <AppLayout nav={nav} title="Admin Panel">
      <Routes>
        <Route index element={<Overview />} />
        <Route path="users" element={<PlaceholderPage title="User Management" subtitle="All app users in one place" />} />
        <Route path="students" element={<StudentsAdmin />} />
        <Route path="teachers" element={<TeachersAdmin />} />
        <Route path="classes" element={<ClassesAdmin />} />
        <Route path="fees" element={<FeesAdmin />} />
        <Route path="attendance" element={<PlaceholderPage title="Attendance Control" subtitle="Configure attendance policies" />} />
        <Route path="reports" element={<PlaceholderPage title="Reports" subtitle="Cross-school reports & exports" />} />
        <Route path="timetable" element={<PlaceholderPage title="Timetable Settings" subtitle="Manage period & timetable rules" />} />
        <Route path="exams" element={<ExamsPage isAdmin />} />
        <Route path="notices" element={<NoticesPage canPost />} />
        <Route path="permissions" element={<PlaceholderPage title="Permissions" subtitle="Granular access control" />} />
        <Route path="settings" element={<PlaceholderPage title="App Settings" subtitle="Branding, locale and modules" />} />
        <Route path="system" element={<PlaceholderPage title="Database / System" subtitle="System health & configuration" />} />
        <Route path="profile" element={<PlaceholderPage title="Profile" subtitle="Your personal information" />} />
        <Route path="links" element={<LinkUsersAdmin />} />
        <Route path="roles" element={<RolesAdmin />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AppLayout>
  );
}
