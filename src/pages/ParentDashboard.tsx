import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LayoutDashboard, ClipboardCheck, Bell, Wallet, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui-bits";
import NoticesPage from "./shared/NoticesPage";
import MyFeesPage from "./shared/MyFeesPage";
import MyMarksPage from "./shared/MyMarksPage";

const nav = [
  { to: "/parent", label: "Home", icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: "/parent/attendance", label: "Attend", icon: <ClipboardCheck className="w-4 h-4" /> },
  { to: "/parent/marks", label: "Marks", icon: <FileText className="w-4 h-4" /> },
  { to: "/parent/fees", label: "Fees", icon: <Wallet className="w-4 h-4" /> },
  { to: "/parent/notices", label: "Notices", icon: <Bell className="w-4 h-4" /> },
];

const Home = () => {
  const { user } = useAuth();
  const [children, setChildren] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data } = await supabase.from("students").select("*, classes(name,section)").eq("parent_user_id", user.id);
      setChildren(data ?? []);
    })();
  }, [user]);
  return (
    <>
      <PageHeader title="Parent Dashboard" subtitle="Track your child's progress" />
      {children.length === 0 ? (
        <Card className="p-5 border-warning/30 bg-warning/5">
          <p className="text-sm">No children linked. Ask admin to link your account ({user?.email}).</p>
        </Card>
      ) : (
        <div className="grid gap-4">
          {children.map(c => (
            <Card key={c.id} className="p-5 shadow-card">
              <div className="font-bold text-lg">{c.full_name}</div>
              <div className="text-sm text-muted-foreground">{c.classes ? `Class ${c.classes.name}-${c.classes.section}` : "Unassigned"} · Adm# {c.admission_number}</div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
};

const ChildAttendance = () => {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: ss } = await supabase.from("students").select("id").eq("parent_user_id", user.id);
      const ids = ss?.map(s => s.id) ?? [];
      if (!ids.length) return;
      const { data } = await supabase.from("attendance").select("*, students(full_name)").in("student_id", ids).order("date", { ascending: false }).limit(60);
      setRows(data ?? []);
    })();
  }, [user]);
  const colors: any = { present: "bg-accent/10 text-accent", absent: "bg-destructive/10 text-destructive", leave: "bg-warning/10 text-warning" };
  return (
    <>
      <PageHeader title="Child Attendance" />
      <div className="space-y-2">
        {rows.map(r => (
          <Card key={r.id} className="p-3 flex items-center justify-between shadow-card">
            <div>
              <div className="font-medium">{r.students?.full_name}</div>
              <div className="text-xs text-muted-foreground">{new Date(r.date).toLocaleDateString()}</div>
            </div>
            <span className={`text-xs px-2.5 py-1 rounded-full capitalize font-medium ${colors[r.status]}`}>{r.status}</span>
          </Card>
        ))}
        {rows.length === 0 && <p className="text-muted-foreground text-center py-8">No records yet.</p>}
      </div>
    </>
  );
};

export default function ParentDashboard() {
  return (
    <AppLayout nav={nav} title="Parent">
      <Routes>
        <Route index element={<Home />} />
        <Route path="attendance" element={<ChildAttendance />} />
        <Route path="marks" element={<MyMarksPage asParent />} />
        <Route path="fees" element={<MyFeesPage asParent />} />
        <Route path="notices" element={<NoticesPage />} />
        <Route path="*" element={<Navigate to="/parent" replace />} />
      </Routes>
    </AppLayout>
  );
}
