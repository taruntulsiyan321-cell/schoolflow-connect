import { useEffect, useState, type ReactNode } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LayoutDashboard, ClipboardCheck, Bell, FileText, Check, X, Coffee, BookOpen, Users, CalendarOff, NotebookPen, BarChart3, CalendarDays, MessageSquare, User, Target, Sword, Database, TrendingUp, HelpCircle } from "lucide-react";
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
import { toast } from "sonner";
import NoticesPage from "./shared/NoticesPage";
import ExamsPage from "./shared/ExamsPage";
import LeaveRequestsPage from "./shared/LeaveRequestsPage";
import TeacherBattleground from "./teacher/TeacherBattleground";
import BattleMonitor from "./teacher/BattleMonitor";
import BattleTeacherReport from "./teacher/BattleTeacherReport";
import QuestionBankPage from "./shared/QuestionBankPage";
import ClassInsights from "./teacher/ClassInsights";
import { CommunityDoubtPortal } from "@/components/community/CommunityDoubtPortal";
import "./teacher/teacher-premium.css";

const nav = [
  { to: "/teacher", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: "/teacher/my-class", label: "My Classes", icon: <Users className="w-4 h-4" /> },
  { to: "/teacher/attendance", label: "Attendance", icon: <ClipboardCheck className="w-4 h-4" /> },
  { to: "/teacher/homework", label: "Homework", icon: <NotebookPen className="w-4 h-4" /> },
  { to: "/teacher/dpp", label: "Daily Practice", icon: <Target className="w-4 h-4" /> },
  { to: "/teacher/battleground", label: "Battleground", icon: <Sword className="w-4 h-4" /> },
  { to: "/teacher/question-bank", label: "Question Bank", icon: <Database className="w-4 h-4" /> },
  { to: "/teacher/performance", label: "Performance", icon: <BarChart3 className="w-4 h-4" /> },
  { to: "/teacher/insights", label: "Class insights", icon: <TrendingUp className="w-4 h-4" /> },
  { to: "/teacher/doubts", label: "Doubt Portal", icon: <HelpCircle className="w-4 h-4" /> },
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
    teacherName: string | null;
    primarySubject: string | null;
    classTeacherOf: { id: string; name: string; section: string } | null;
    subjectClasses: { id: string; name: string; section: string; subject: string | null }[];
    loading: boolean;
  }>({ teacherId: null, teacherName: null, primarySubject: null, classTeacherOf: null, subjectClasses: [], loading: true });

  useEffect(() => {
    (async () => {
      if (!user) return;
      const { data: t } = await supabase.from("teachers").select("id, full_name, subject, class_teacher_of").eq("user_id", user.id).maybeSingle();
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
      setData({ teacherId: t.id, teacherName: t.full_name ?? null, primarySubject: t.subject ?? null, classTeacherOf, subjectClasses, loading: false });
    })();
  }, [user]);
  return data;
}

function TeacherMetric({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub?: string }) {
  return (
    <Card className="tp-metric">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tp-label">{label}</p>
          <p className="text-2xl font-bold tabular-nums mt-2 truncate">{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
        </div>
        <div className="tp-icon">{icon}</div>
      </div>
    </Card>
  );
}

const Overview = () => {
  const a = useTeacherAssignments();
  const navigate = useNavigate();
  const totalRoles = (a.classTeacherOf ? 1 : 0) + a.subjectClasses.length;
  const uniqueSubjects = new Set(a.subjectClasses.map((c) => c.subject).filter(Boolean)).size || (a.primarySubject ? 1 : 0);
  return (
    <div className="tp-shell space-y-6">
      <section className="tp-hero">
        <div className="relative z-10 grid lg:grid-cols-[1.15fr_0.85fr] gap-6">
          <div>
            <div className="tp-kicker mb-4">Wisdom Campus · Teacher Command Center</div>
            <p className="text-sm text-white/70">Welcome back, {a.teacherName?.split(" ")[0] || "Teacher"}</p>
            <h1 className="tp-display text-3xl sm:text-5xl mt-1">Teach smarter today.</h1>
            <p className="text-sm text-white/75 mt-4 max-w-xl">
              Your classes, practice, attendance, battlegrounds, doubts, and intervention signals are now organized like a premium academic cockpit.
            </p>
            <div className="flex flex-wrap gap-2 mt-5">
              <Button className="bg-white text-emerald-950 hover:bg-white/90" onClick={() => navigate("/teacher/insights")}>Open class insights</Button>
              <Button variant="outline" className="border-white/30 text-white hover:bg-white/10" onClick={() => navigate("/teacher/dpp")}>Create DPP</Button>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-1 gap-3">
            <div className="rounded-2xl bg-white/12 border border-white/15 p-4 backdrop-blur">
              <p className="text-[10px] uppercase tracking-wider text-white/60 font-bold">Class teacher</p>
              <p className="text-2xl font-bold mt-1">{a.classTeacherOf ? `${a.classTeacherOf.name}-${a.classTeacherOf.section}` : "Not assigned"}</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-white/15 p-4 backdrop-blur">
              <p className="text-[10px] uppercase tracking-wider text-white/60 font-bold">Subject footprint</p>
              <p className="text-2xl font-bold mt-1">{a.subjectClasses.length} classes · {uniqueSubjects} subject{uniqueSubjects === 1 ? "" : "s"}</p>
            </div>
          </div>
        </div>
      </section>

      <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <TeacherMetric icon={<Users className="w-5 h-5" />} label="Class Teacher" value={a.classTeacherOf ? `${a.classTeacherOf.name}-${a.classTeacherOf.section}` : "—"} sub="pastoral ownership" />
        <TeacherMetric icon={<BookOpen className="w-5 h-5" />} label="Subject Classes" value={a.subjectClasses.length} sub="active teaching groups" />
        <TeacherMetric icon={<Target className="w-5 h-5" />} label="Teaching Roles" value={totalRoles} sub="assigned responsibilities" />
        <TeacherMetric icon={<TrendingUp className="w-5 h-5" />} label="Insight Engine" value="Live" sub="class signals ready" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {a.classTeacherOf && (
        <Card className="tp-card p-5 cursor-pointer" onClick={() => navigate("/teacher/my-class")}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Badge className="mb-2 rounded-full bg-primary/15 text-primary border-primary/30" variant="outline">Class Teacher Role</Badge>
              <h3 className="font-bold text-lg">My Class · {a.classTeacherOf.name}-{a.classTeacherOf.section}</h3>
              <p className="text-sm text-muted-foreground">Manage students, attendance, performance & leave approvals</p>
            </div>
            <div className="tp-icon"><Users className="w-5 h-5" /></div>
          </div>
        </Card>
        )}

        <Card className="tp-card tp-gold-card p-5 cursor-pointer" onClick={() => navigate("/teacher/my-subjects")}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <Badge className="mb-2 rounded-full bg-accent/15 text-accent border-accent/30" variant="outline">Subject Teacher Role</Badge>
            <h3 className="font-bold text-lg">My Subjects · {a.subjectClasses.length} class{a.subjectClasses.length === 1 ? "" : "es"}</h3>
            <p className="text-sm text-muted-foreground">Mark subject attendance, upload marks, post class notices</p>
          </div>
          <div className="tp-icon bg-amber-100 text-amber-800"><BookOpen className="w-5 h-5" /></div>
        </div>
      </Card>
      </div>

      <Card className="tp-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <p className="tp-label">Today&apos;s teaching priorities</p>
            <h3 className="tp-display text-xl mt-1">High-leverage actions</h3>
          </div>
          <span className="tp-chip">Insight rich</span>
        </div>
        <div className="grid md:grid-cols-4 gap-3">
          {[
            { label: "Review at-risk students", route: "/teacher/insights", icon: TrendingUp },
            { label: "Publish practice", route: "/teacher/dpp", icon: Target },
            { label: "Answer doubts", route: "/teacher/doubts", icon: HelpCircle },
            { label: "Host live battle", route: "/teacher/battleground", icon: Sword },
          ].map((action) => {
            const Icon = action.icon;
            return (
              <button key={action.label} type="button" onClick={() => navigate(action.route)} className="tp-action text-left hover:border-primary/30 transition-colors">
                <div className="tp-icon mb-3"><Icon className="w-4 h-4" /></div>
                <p className="font-semibold text-sm">{action.label}</p>
              </button>
            );
          })}
        </div>
      </Card>
    </div>
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

  if (a.loading) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground text-sm">Loading your class…</p>
      </Card>
    );
  }
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
    <div className="tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="tp-kicker mb-4">Class Teacher Cockpit</div>
            <h1 className="tp-display text-3xl sm:text-4xl">Class {a.classTeacherOf.name}-{a.classTeacherOf.section}</h1>
            <p className="text-sm text-white/75 mt-2">Students, leaves, attendance signals, and class care in one premium workspace.</p>
          </div>
          <div className="rounded-2xl bg-white/12 border border-white/15 p-4 text-right">
            <p className="text-[10px] uppercase tracking-wider text-white/60 font-bold">Class health</p>
            <p className="text-3xl font-bold">{Math.max(0, 100 - leaves.length * 8)}%</p>
          </div>
        </div>
      </section>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <TeacherMetric icon={<Users className="w-5 h-5" />} label="Students" value={students.length} sub="in this class" />
        <TeacherMetric icon={<CalendarOff className="w-5 h-5" />} label="Pending leaves" value={leaves.length} sub="need review" />
        <TeacherMetric icon={<ClipboardCheck className="w-5 h-5" />} label="Attendance" value="Daily" sub="mark and lock" />
        <TeacherMetric icon={<BarChart3 className="w-5 h-5" />} label="Performance" value="Tracked" sub="class signals" />
      </div>

      {leaves.length > 0 && (
        <Card className="tp-card p-5">
          <h3 className="tp-display text-xl mb-3">Pending leave requests</h3>
          <div className="space-y-2">
            {leaves.map(l => (
              <div key={l.id} className="tp-row flex items-center justify-between gap-3">
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

      <Card className="tp-card p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="tp-display text-xl">Students</h3>
          <span className="tp-chip">{students.length} learners</span>
        </div>
        <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
          {students.map(s => (
            <div key={s.id} className="tp-row flex items-center justify-between">
              <span className="text-sm font-medium">{s.full_name}</span>
              <span className="text-xs text-muted-foreground">Roll {s.roll_number || "-"}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

const MySubjects = () => {
  const a = useTeacherAssignments();
  if (a.loading) {
    return (
      <Card className="p-8 text-center">
        <p className="text-muted-foreground text-sm">Loading your subject assignments…</p>
      </Card>
    );
  }
  if (a.subjectClasses.length === 0) return (
    <Card className="p-8 text-center">
      <BookOpen className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
      <p className="text-muted-foreground">No subject assignments yet.</p>
    </Card>
  );
  return (
    <div className="tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10">
          <div className="tp-kicker mb-4">Subject Studio</div>
          <h1 className="tp-display text-3xl sm:text-4xl">My Subjects</h1>
          <p className="text-sm text-white/75 mt-2">Every teaching group you own, styled for fast class planning and follow-up.</p>
        </div>
      </section>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {a.subjectClasses.map(c => (
          <Card key={`${c.id}-${c.subject}`} className="tp-card p-5">
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
    </div>
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
    <div className="tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="tp-kicker mb-4">Daily Attendance</div>
            <h1 className="tp-display text-3xl sm:text-4xl">Mark Attendance</h1>
            <p className="text-sm text-white/75 mt-2">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</p>
          </div>
          <div className="rounded-2xl bg-white/12 border border-white/15 p-4">
            <p className="text-[10px] uppercase tracking-wider text-white/60 font-bold">Selected</p>
            <p className="text-2xl font-bold">{students.length}</p>
          </div>
        </div>
      </section>
      <Card className="tp-card p-4">
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger><SelectValue placeholder="Select class" /></SelectTrigger>
          <SelectContent>{allClasses.map(c => <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>)}</SelectContent>
        </Select>
      </Card>

      {isLocked && classId && (
        <Card className="tp-card tp-gold-card p-4">
          <div className="flex items-center gap-2 text-warning-foreground">
            <Check className="w-4 h-4" />
            <span className="text-sm font-medium">Attendance submitted and locked for today. Contact admin for any corrections.</span>
          </div>
        </Card>
      )}

      {classId && students.length === 0 && <p className="text-muted-foreground text-center py-8">No students in this class.</p>}

      <div className="space-y-2">
        {students.map(s => (
          <Card key={s.id} className={`tp-card p-3 flex items-center justify-between ${isLocked ? "opacity-75" : ""}`}>
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
    </div>
  );
};

export default function TeacherDashboard() {
  return (
    <AppLayout nav={nav} title="Teacher">
      <div className="teacher-premium">
        <Routes>
        <Route index element={<Overview />} />
        <Route path="my-class" element={<MyClass />} />
        <Route path="my-subjects" element={<MySubjects />} />
        <Route path="attendance" element={<Attendance />} />
        <Route path="homework" element={<HomeworkManagePage />} />
        <Route path="performance" element={<StudentPerformancePage />} />
        <Route path="insights" element={<ClassInsights />} />
        <Route path="doubts" element={<CommunityDoubtPortal mode="teacher" />} />
        <Route path="exams" element={<ExamsPage />} />
        <Route path="timetable" element={<TeacherTimetablePage />} />
        <Route path="notices" element={<NoticesPage canPost />} />
        <Route path="reports" element={<TeacherReportsPage />} />
        <Route path="chat" element={<ChatPage userRole="teacher" />} />
        {/* Teachers submit their own leave requests; approvals happen via class teacher / principal views */}
        <Route path="leaves" element={<LeaveRequestsPage applicantKind="teacher" />} />
        <Route path="profile" element={<TeacherProfilePage />} />
        <Route path="dpp" element={<DppList />} />
        <Route path="dpp/:id" element={<DppEditor />} />
        <Route path="dpp/:id/analytics" element={<DppAnalytics />} />
        <Route path="battleground" element={<TeacherBattleground />} />
        <Route path="battleground/monitor/:id" element={<BattleMonitor />} />
        <Route path="battleground/monitor/:battleId/report/:participantId" element={<BattleTeacherReport />} />
        <Route path="question-bank" element={<QuestionBankPage />} />
        <Route path="*" element={<Navigate to="/teacher" replace />} />
        </Routes>
      </div>
    </AppLayout>
  );
}
