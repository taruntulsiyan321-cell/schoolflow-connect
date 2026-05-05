import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LayoutDashboard, Users, GraduationCap, BookOpen, ClipboardCheck, Wallet, FileText, Bell, CalendarOff, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { PageHeader, StatCard } from "@/components/ui-bits";
import NoticesPage from "./shared/NoticesPage";
import ExamsPage from "./shared/ExamsPage";
import LeaveRequestsPage from "./shared/LeaveRequestsPage";
import LeaderboardPage from "./shared/LeaderboardPage";

const nav = [
  { to: "/principal", label: "Home", icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: "/principal/analytics", label: "Analytics", icon: <BarChart3 className="w-4 h-4" /> },
  { to: "/principal/leaves", label: "Leaves", icon: <CalendarOff className="w-4 h-4" /> },
  { to: "/principal/exams", label: "Exams", icon: <FileText className="w-4 h-4" /> },
  { to: "/principal/notices", label: "Notices", icon: <Bell className="w-4 h-4" /> },
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

const Analytics = () => {
  const [byClass, setByClass] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data: classes } = await supabase.from("classes").select("id,name,section");
      const { data: students } = await supabase.from("students").select("class_id");
      const counts = new Map<string, number>();
      students?.forEach(s => counts.set(s.class_id, (counts.get(s.class_id) ?? 0) + 1));
      setByClass((classes ?? []).map(c => ({ ...c, count: counts.get(c.id) ?? 0 })));
    })();
  }, []);
  return (
    <>
      <PageHeader title="Analytics" subtitle="Distribution of students across classes" />
      <div className="grid sm:grid-cols-2 gap-3">
        {byClass.map(c => (
          <Card key={c.id} className="p-4 flex items-center justify-between">
            <div><div className="font-semibold">Class {c.name}-{c.section}</div><div className="text-xs text-muted-foreground">enrolled</div></div>
            <div className="text-2xl font-bold text-primary">{c.count}</div>
          </Card>
        ))}
      </div>
    </>
  );
};

export default function PrincipalDashboard() {
  return (
    <AppLayout nav={nav} title="Principal">
      <Routes>
        <Route index element={<Overview />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="leaves" element={<LeaveRequestsPage canReview />} />
        <Route path="exams" element={<ExamsPage isAdmin />} />
        <Route path="notices" element={<NoticesPage canPost />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="*" element={<Navigate to="/principal" replace />} />
      </Routes>
    </AppLayout>
  );
}
