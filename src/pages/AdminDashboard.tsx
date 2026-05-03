import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LayoutDashboard, Users, GraduationCap, Bell, BookOpen } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { StatCard, PageHeader } from "@/components/ui-bits";
import { Card } from "@/components/ui/card";
import StudentsAdmin from "./admin/StudentsAdmin";
import TeachersAdmin from "./admin/TeachersAdmin";
import ClassesAdmin from "./admin/ClassesAdmin";
import NoticesPage from "./shared/NoticesPage";

const nav = [
  { to: "/admin", label: "Overview", icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: "/admin/students", label: "Students", icon: <Users className="w-4 h-4" /> },
  { to: "/admin/teachers", label: "Teachers", icon: <GraduationCap className="w-4 h-4" /> },
  { to: "/admin/classes", label: "Classes", icon: <BookOpen className="w-4 h-4" /> },
  { to: "/admin/notices", label: "Notices", icon: <Bell className="w-4 h-4" /> },
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
        <p className="text-primary-foreground/80 text-sm">Use the sidebar to add classes, enroll students, assign teachers, and broadcast notices to the whole school.</p>
      </Card>
    </>
  );
};

export default function AdminDashboard() {
  return (
    <AppLayout nav={nav} title="Admin Panel">
      <Routes>
        <Route index element={<Overview />} />
        <Route path="students" element={<StudentsAdmin />} />
        <Route path="teachers" element={<TeachersAdmin />} />
        <Route path="classes" element={<ClassesAdmin />} />
        <Route path="notices" element={<NoticesPage canPost />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AppLayout>
  );
}
