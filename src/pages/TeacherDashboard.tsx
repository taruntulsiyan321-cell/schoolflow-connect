import { useEffect, useState } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LayoutDashboard, ClipboardCheck, Bell, FileText, Check, X, Coffee } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { toast } from "sonner";
import NoticesPage from "./shared/NoticesPage";
import ExamsPage from "./shared/ExamsPage";

const nav = [
  { to: "/teacher", label: "Home", icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: "/teacher/attendance", label: "Attendance", icon: <ClipboardCheck className="w-4 h-4" /> },
  { to: "/teacher/exams", label: "Exams", icon: <FileText className="w-4 h-4" /> },
  { to: "/teacher/notices", label: "Notices", icon: <Bell className="w-4 h-4" /> },
];

const Overview = () => {
  const { user } = useAuth();
  const [classCount, setClassCount] = useState(0);
  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: t } = await supabase.from("teachers").select("id").eq("user_id", user.id).maybeSingle();
      if (t) {
        const { count } = await supabase.from("teacher_classes").select("id", { count: "exact", head: true }).eq("teacher_id", t.id);
        setClassCount(count ?? 0);
      }
    })();
  }, [user]);
  return (
    <>
      <PageHeader title="Teacher Dashboard" subtitle="Mark attendance and engage with your classes" />
      <div className="grid grid-cols-2 gap-4 mb-6">
        <StatCard icon={<ClipboardCheck className="w-5 h-5" />} label="Assigned Classes" value={classCount} />
        <StatCard icon={<Bell className="w-5 h-5" />} label="Today" value={new Date().toLocaleDateString(undefined, { day: "numeric", month: "short" })} tone="accent" />
      </div>
      <Card className="p-6 bg-gradient-primary text-primary-foreground">
        <h3 className="text-xl font-bold mb-1">Ready to teach? 📚</h3>
        <p className="text-sm text-primary-foreground/80">Tap Attendance to mark today's roll.</p>
      </Card>
    </>
  );
};

const Attendance = () => {
  const { user } = useAuth();
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<any[]>([]);
  const [marks, setMarks] = useState<Record<string, "present" | "absent" | "leave">>({});
  const [date] = useState(new Date().toISOString().split("T")[0]);

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: t } = await supabase.from("teachers").select("id, class_teacher_of").eq("user_id", user.id).maybeSingle();
      const ids = new Set<string>();
      if (t?.class_teacher_of) ids.add(t.class_teacher_of);
      if (t) {
        const { data: tc } = await supabase.from("teacher_classes").select("class_id").eq("teacher_id", t.id);
        tc?.forEach(r => ids.add(r.class_id));
      }
      if (ids.size) {
        const { data: cls } = await supabase.from("classes").select("*").in("id", Array.from(ids));
        setClasses(cls ?? []);
      }
    })();
  }, [user]);

  useEffect(() => {
    if (!classId) { setStudents([]); return; }
    (async () => {
      const { data } = await supabase.from("students").select("*").eq("class_id", classId).order("roll_number");
      setStudents(data ?? []);
      const { data: existing } = await supabase.from("attendance").select("student_id,status").eq("class_id", classId).eq("date", date);
      const m: Record<string, any> = {};
      existing?.forEach(r => m[r.student_id] = r.status);
      setMarks(m);
    })();
  }, [classId, date]);

  const setMark = (sid: string, status: "present" | "absent" | "leave") => setMarks(p => ({ ...p, [sid]: status }));

  const save = async () => {
    const rows = Object.entries(marks).map(([student_id, status]) => ({ student_id, class_id: classId, date, status, marked_by: user?.id }));
    if (!rows.length) return toast.error("Mark at least one student");
    const { error } = await supabase.from("attendance").upsert(rows, { onConflict: "student_id,date" });
    if (error) return toast.error(error.message);
    toast.success("Attendance saved");
  };

  return (
    <>
      <PageHeader title="Mark Attendance" subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} />
      <Card className="p-4 mb-4 shadow-card">
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
          <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>Class {c.name}-{c.section}</SelectItem>)}</SelectContent>
        </Select>
      </Card>

      {classId && students.length === 0 && <p className="text-muted-foreground text-center py-8">No students in this class.</p>}

      <div className="space-y-2">
        {students.map(s => (
          <Card key={s.id} className="p-3 flex items-center justify-between shadow-card">
            <div className="min-w-0">
              <div className="font-medium truncate">{s.full_name}</div>
              <div className="text-xs text-muted-foreground">Roll {s.roll_number || "-"}</div>
            </div>
            <div className="flex gap-1">
              {([["present", Check, "bg-accent text-accent-foreground"], ["absent", X, "bg-destructive text-destructive-foreground"], ["leave", Coffee, "bg-warning text-warning-foreground"]] as const).map(([st, Icon, cls]) => (
                <button key={st} onClick={() => setMark(s.id, st)}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${marks[s.id] === st ? cls : "bg-muted text-muted-foreground"}`}>
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {students.length > 0 && (
        <Button className="w-full mt-6 bg-gradient-primary text-primary-foreground" onClick={save}>Save Attendance</Button>
      )}
    </>
  );
};

export default function TeacherDashboard() {
  return (
    <AppLayout nav={nav} title="Teacher">
      <Routes>
        <Route index element={<Overview />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="exams" element={<ExamsPage />} />
        <Route path="notices" element={<NoticesPage canPost />} />
        <Route path="*" element={<Navigate to="/teacher" replace />} />
      </Routes>
    </AppLayout>
  );
}
