import { useEffect, useState } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LayoutDashboard, ClipboardCheck, Bell, FileText, Check, X, Coffee, BookOpen, Users, CalendarOff, NotebookPen, BarChart3, CalendarDays, MessageSquare, User, Target } from "lucide-react";
import DppList from "./teacher/DppList";
import DppEditor from "./teacher/DppEditor";
import DppAnalytics from "./teacher/DppAnalytics";
import TeacherProfilePage from "./shared/TeacherProfilePage";
import StudentPerformancePage from "./shared/StudentPerformancePage";
import TeacherReportsPage from "./shared/TeacherReportsPage";
import TeacherTimetablePage from "./shared/TeacherTimetablePage";
import HomeworkManagePage from "./shared/HomeworkManagePage";
import ChatPage from "./shared/ChatPage";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { toast } from "sonner";
import NoticesPage from "./shared/NoticesPage";
import ExamsPage from "./shared/ExamsPage";
import LeaveRequestsPage from "./shared/LeaveRequestsPage";

const nav = [
  { to: "/teacher", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: "/teacher/my-class", label: "My Classes", icon: <Users className="w-4 h-4" /> },
  { to: "/teacher/attendance", label: "Attendance", icon: <ClipboardCheck className="w-4 h-4" /> },
  { to: "/teacher/homework", label: "Homework", icon: <NotebookPen className="w-4 h-4" /> },
  { to: "/teacher/dpp", label: "Daily Practice", icon: <Target className="w-4 h-4" /> },
  { to: "/teacher/performance", label: "Performance", icon: <BarChart3 className="w-4 h-4" /> },
  { to: "/teacher/exams", label: "Exams", icon: <FileText className="w-4 h-4" /> },
  { to: "/teacher/timetable", label: "Timetable", icon: <CalendarDays className="w-4 h-4" /> },
  { to: "/teacher/notices", label: "Notices", icon: <Bell className="w-4 h-4" /> },
  { to: "/teacher/reports", label: "Reports", icon: <FileText className="w-4 h-4" /> },
  { to: "/teacher/chat", label: "Chat", icon: <MessageSquare className="w-4 h-4" /> },
  { to: "/teacher/leaves", label: "Leaves", icon: <CalendarOff className="w-4 h-4" /> },
  { to: "/teacher/profile", label: "Profile", icon: <User className="w-4 h-4" /> },
];

// Hook to load teacher's class-teacher class + subject classes
function useTeacherAssignments() {
  const { user } = useAuth();
  const [data, setData] = useState<{
    teacherId: string | null;
    classTeacherOf: { id: string; name: string; section: string } | null;
    subjectClasses: { id: string; name: string; section: string; subject: string | null }[];
    loading: boolean;
  }>({ teacherId: null, classTeacherOf: null, subjectClasses: [], loading: true });

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: t } = await supabase.from("teachers").select("id, class_teacher_of").eq("user_id", user.id).maybeSingle();
      if (!t) { setData(d => ({ ...d, loading: false })); return; }
      let classTeacherOf = null;
      if (t.class_teacher_of) {
        const { data: c } = await supabase.from("classes").select("id,name,section").eq("id", t.class_teacher_of).maybeSingle();
        classTeacherOf = c ?? null;
      }
      const { data: tc } = await supabase.from("teacher_classes").select("class_id, subject, classes(id,name,section)").eq("teacher_id", t.id);
      const subjectClasses = (tc ?? []).map((r: any) => ({
        id: r.classes?.id, name: r.classes?.name, section: r.classes?.section, subject: r.subject,
      })).filter(x => x.id);
      setData({ teacherId: t.id, classTeacherOf, subjectClasses, loading: false });
    })();
  }, [user]);
  return data;
}

const Overview = () => {
  const a = useTeacherAssignments();
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Teacher Dashboard" subtitle="Your roles & quick actions" />
      <div className="grid grid-cols-2 gap-4 mb-6">
        <StatCard icon={<Users className="w-5 h-5" />} label="Class Teacher" value={a.classTeacherOf ? `${a.classTeacherOf.name}-${a.classTeacherOf.section}` : "—"} />
        <StatCard icon={<BookOpen className="w-5 h-5" />} label="Subject Classes" value={a.subjectClasses.length} tone="accent" />
      </div>

      {a.classTeacherOf && (
        <Card className="p-5 mb-4 cursor-pointer hover:shadow-elevated transition" onClick={() => navigate("/teacher/my-class")}>
          <div className="flex items-center justify-between">
            <div>
              <Badge className="mb-2 bg-primary/15 text-primary border-primary/30" variant="outline">Class Teacher Role</Badge>
              <h3 className="font-bold text-lg">My Class · {a.classTeacherOf.name}-{a.classTeacherOf.section}</h3>
              <p className="text-sm text-muted-foreground">Manage students, attendance, performance & leave approvals</p>
            </div>
            <Users className="w-8 h-8 text-primary" />
          </div>
        </Card>
      )}

      <Card className="p-5 cursor-pointer hover:shadow-elevated transition" onClick={() => navigate("/teacher/my-subjects")}>
        <div className="flex items-center justify-between">
          <div>
            <Badge className="mb-2 bg-accent/15 text-accent border-accent/30" variant="outline">Subject Teacher Role</Badge>
            <h3 className="font-bold text-lg">My Subjects · {a.subjectClasses.length} class{a.subjectClasses.length === 1 ? "" : "es"}</h3>
            <p className="text-sm text-muted-foreground">Mark subject attendance, upload marks, post class notices</p>
          </div>
          <BookOpen className="w-8 h-8 text-accent" />
        </div>
      </Card>
    </>
  );
};

const MyClass = () => {
  const { user } = useAuth();
  const a = useTeacherAssignments();
  const [students, setStudents] = useState<any[]>([]);
  const [leaves, setLeaves] = useState<any[]>([]);
  useEffect(() => {
    if (!a.classTeacherOf) return;
    (async () => {
      const { data: s } = await supabase.from("students").select("*").eq("class_id", a.classTeacherOf!.id).order("roll_number");
      setStudents(s ?? []);
      const { data: l } = await supabase.from("leave_requests").select("*").eq("class_id", a.classTeacherOf!.id).eq("status", "pending");
      setLeaves(l ?? []);
    })();
  }, [a.classTeacherOf]);

  if (a.loading) return null;
  if (!a.classTeacherOf) return (
    <Card className="p-8 text-center">
      <Users className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
      <p className="text-muted-foreground">You are not assigned as a class teacher.</p>
    </Card>
  );

  const review = async (id: string, status: "approved" | "rejected") => {
    const { error } = await supabase.from("leave_requests").update({ status, reviewed_by: user?.id, reviewed_at: new Date().toISOString() }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success(`Leave ${status}`);
    setLeaves(l => l.filter(x => x.id !== id));
  };

  return (
    <>
      <PageHeader title={`My Class · ${a.classTeacherOf.name}-${a.classTeacherOf.section}`} subtitle="Your class teacher responsibilities" />

      <div className="grid grid-cols-2 gap-4 mb-6">
        <StatCard icon={<Users className="w-5 h-5" />} label="Students" value={students.length} />
        <StatCard icon={<CalendarOff className="w-5 h-5" />} label="Pending leaves" value={leaves.length} tone="warning" />
      </div>

      {leaves.length > 0 && (
        <Card className="p-4 mb-4">
          <h3 className="font-semibold mb-3">Pending leave requests</h3>
          <div className="space-y-2">
            {leaves.map(l => (
              <div key={l.id} className="flex items-center justify-between border rounded-lg p-3">
                <div>
                  <div className="text-sm font-medium capitalize">{l.leave_type}</div>
                  <div className="text-xs text-muted-foreground">{l.from_date} → {l.to_date}</div>
                  {l.reason && <div className="text-xs mt-1">{l.reason}</div>}
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => review(l.id, "approved")}><Check className="w-4 h-4 text-accent" /></Button>
                  <Button size="sm" variant="outline" onClick={() => review(l.id, "rejected")}><X className="w-4 h-4 text-destructive" /></Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Students</h3>
        <div className="space-y-1 max-h-96 overflow-y-auto">
          {students.map(s => (
            <div key={s.id} className="flex items-center justify-between p-2 border-b last:border-0">
              <span className="text-sm">{s.full_name}</span>
              <span className="text-xs text-muted-foreground">Roll {s.roll_number || "-"}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
};

const MySubjects = () => {
  const a = useTeacherAssignments();
  if (a.loading) return null;
  if (a.subjectClasses.length === 0) return (
    <Card className="p-8 text-center">
      <BookOpen className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
      <p className="text-muted-foreground">No subject assignments yet.</p>
    </Card>
  );
  return (
    <>
      <PageHeader title="My Subjects" subtitle="Classes you teach as a subject teacher" />
      <div className="grid sm:grid-cols-2 gap-3">
        {a.subjectClasses.map(c => (
          <Card key={`${c.id}-${c.subject}`} className="p-4">
            <div className="flex items-start justify-between">
              <div>
                <div className="font-semibold">Class {c.name}-{c.section}</div>
                <div className="text-sm text-muted-foreground">{c.subject || "Subject"}</div>
              </div>
              <Badge variant="outline" className="bg-accent/15 text-accent border-accent/30">Subject</Badge>
            </div>
          </Card>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-4">Use Attendance, Exams, and Notices from the side menu — scoped automatically to your assigned classes.</p>
    </>
  );
};

const Attendance = () => {
  const { user } = useAuth();
  const a = useTeacherAssignments();
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<any[]>([]);
  const [marks, setMarks] = useState<Record<string, "present" | "absent" | "leave">>({});
  const [date] = useState(new Date().toISOString().split("T")[0]);
  const [isLocked, setIsLocked] = useState(false);
  const [saving, setSaving] = useState(false);

  const allClasses = [
    ...(a.classTeacherOf ? [{ id: a.classTeacherOf.id, label: `Class ${a.classTeacherOf.name}-${a.classTeacherOf.section} (Class Teacher)` }] : []),
    ...a.subjectClasses.filter(c => c.id !== a.classTeacherOf?.id).map(c => ({ id: c.id, label: `Class ${c.name}-${c.section}${c.subject ? ` · ${c.subject}` : ""}` })),
  ];

  useEffect(() => {
    if (!classId) { setStudents([]); setIsLocked(false); return; }
    (async () => {
      const { data } = await supabase.from("students").select("*").eq("class_id", classId).order("roll_number");
      setStudents(data ?? []);
      const { data: existing } = await supabase.from("attendance").select("student_id,status").eq("class_id", classId).eq("date", date);
      const m: Record<string, any> = {};
      existing?.forEach(r => m[r.student_id] = r.status);
      setMarks(m);
      const { data: lock } = await supabase.from("attendance_locks").select("class_id").eq("class_id", classId).eq("date", date).maybeSingle();
      setIsLocked(!!lock);
    })();
  }, [classId, date]);

  const setMark = (sid: string, status: "present" | "absent" | "leave") => {
    if (isLocked) return;
    setMarks(p => ({ ...p, [sid]: status }));
  };

  const save = async () => {
    if (isLocked) return toast.error("Attendance is locked. Contact admin to make changes.");
    const rows = Object.entries(marks).map(([student_id, status]) => ({ student_id, class_id: classId, date, status, marked_by: user?.id }));
    if (!rows.length) return toast.error("Mark at least one student");
    setSaving(true);
    const { error } = await supabase.from("attendance").upsert(rows, { onConflict: "student_id,date" });
    if (error) { setSaving(false); return toast.error(error.message); }
    await supabase.from("attendance_locks").insert({ class_id: classId, date, locked_by: user?.id });
    setIsLocked(true);
    setSaving(false);
    toast.success("Attendance saved and locked");
  };

  return (
    <>
      <PageHeader title="Mark Attendance" subtitle={new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })} />
      <Card className="p-4 mb-4 shadow-card">
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
          <SelectContent>{allClasses.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
        </Select>
      </Card>

      {isLocked && classId && (
        <Card className="p-4 mb-4 border-warning bg-warning/10">
          <div className="flex items-center gap-2 text-warning-foreground">
            <Check className="w-4 h-4" />
            <span className="text-sm font-medium">Attendance submitted and locked for today. Contact admin for any corrections.</span>
          </div>
        </Card>
      )}

      {classId && students.length === 0 && <p className="text-muted-foreground text-center py-8">No students in this class.</p>}

      <div className="space-y-2">
        {students.map(s => (
          <Card key={s.id} className={`p-3 flex items-center justify-between shadow-card ${isLocked ? "opacity-75" : ""}`}>
            <div className="min-w-0">
              <div className="font-medium truncate">{s.full_name}</div>
              <div className="text-xs text-muted-foreground">Roll {s.roll_number || "-"}</div>
            </div>
            <div className="flex gap-1">
              {([["present", Check, "bg-accent text-accent-foreground"], ["absent", X, "bg-destructive text-destructive-foreground"], ["leave", Coffee, "bg-warning text-warning-foreground"]] as const).map(([st, Icon, cls]) => (
                <button key={st} onClick={() => setMark(s.id, st)} disabled={isLocked}
                  className={`w-9 h-9 rounded-lg flex items-center justify-center transition-all ${isLocked ? "cursor-not-allowed" : ""} ${marks[s.id] === st ? cls : "bg-muted text-muted-foreground"}`}>
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {students.length > 0 && !isLocked && (
        <Button className="w-full mt-6 bg-gradient-primary text-primary-foreground" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Submit Attendance"}
        </Button>
      )}
    </>
  );
};

export default function TeacherDashboard() {
  return (
    <AppLayout nav={nav} title="Teacher">
      <Routes>
        <Route index element={<Overview />} />
        <Route path="my-class" element={<MyClass />} />
        <Route path="my-subjects" element={<MySubjects />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="homework" element={<HomeworkManagePage />} />
        <Route path="performance" element={<StudentPerformancePage />} />
        <Route path="exams" element={<ExamsPage />} />
        <Route path="timetable" element={<TeacherTimetablePage />} />
        <Route path="notices" element={<NoticesPage canPost />} />
        <Route path="reports" element={<TeacherReportsPage />} />
        <Route path="chat" element={<ChatPage userRole="teacher" />} />
        <Route path="leaves" element={<LeaveRequestsPage canReview applicantKind="teacher" />} />
        <Route path="profile" element={<TeacherProfilePage />} />
        <Route path="*" element={<Navigate to="/teacher" replace />} />
      </Routes>
    </AppLayout>
  );
}
