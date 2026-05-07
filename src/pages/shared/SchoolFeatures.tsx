import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { PageHeader, StatCard } from "@/components/ui-bits";
import {
  Users, GraduationCap, BookOpen, ClipboardCheck, CalendarDays, FileText,
  Activity, Settings, KeyRound, UserCheck, TrendingUp, Database, Wallet, User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

/* ============================================================
   USERS DIRECTORY (admin)
   ============================================================ */
export function UsersDirectory() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.rpc("admin_list_users_with_roles");
      setRows((data as any[]) ?? []);
      setLoading(false);
    })();
  }, []);
  const filtered = rows.filter(r => !q || r.email?.toLowerCase().includes(q.toLowerCase()) || r.phone?.includes(q));
  return (
    <>
      <PageHeader title="User Management" subtitle={`${rows.length} registered users`} />
      <div className="flex gap-3 mb-4">
        <Input placeholder="Search by email or phone…" value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {loading ? <p className="text-muted-foreground text-center py-8">Loading…</p> : (
        <div className="space-y-2">
          {filtered.map(u => (
            <Card key={u.user_id} className="p-4 flex items-center justify-between shadow-card">
              <div className="min-w-0">
                <div className="font-medium truncate">{u.email || u.phone}</div>
                <div className="text-xs text-muted-foreground">Joined {formatDistanceToNow(new Date(u.created_at), { addSuffix: true })}</div>
              </div>
              <div className="flex gap-1.5 flex-wrap justify-end">
                {u.roles.length === 0
                  ? <Badge variant="outline" className="text-muted-foreground">No role</Badge>
                  : u.roles.map((r: string) => <Badge key={r} variant="outline" className="capitalize">{r}</Badge>)}
              </div>
            </Card>
          ))}
          {filtered.length === 0 && <p className="text-muted-foreground text-center py-8">No users match.</p>}
        </div>
      )}
    </>
  );
}

/* ============================================================
   ATTENDANCE OVERVIEW (admin & principal)
   ============================================================ */
export function AttendanceOverview() {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [classes, setClasses] = useState<any[]>([]);
  const [att, setAtt] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("classes").select("*").order("name").then(({ data }) => setClasses(data ?? []));
    supabase.from("students").select("id,class_id").then(({ data }) => setStudents(data ?? []));
  }, []);
  useEffect(() => {
    supabase.from("attendance").select("*").eq("date", date).then(({ data }) => setAtt(data ?? []));
  }, [date]);

  const byClass = classes.map(c => {
    const total = students.filter(s => s.class_id === c.id).length;
    const records = att.filter(a => a.class_id === c.id);
    const present = records.filter(r => r.status === "present").length;
    const absent = records.filter(r => r.status === "absent").length;
    const leave = records.filter(r => r.status === "leave").length;
    const rate = total ? Math.round((present / total) * 100) : 0;
    return { ...c, total, present, absent, leave, rate, marked: records.length };
  });
  const totals = byClass.reduce((a, c) => ({
    total: a.total + c.total, present: a.present + c.present, absent: a.absent + c.absent,
  }), { total: 0, present: 0, absent: 0 });
  const overall = totals.total ? Math.round((totals.present / totals.total) * 100) : 0;

  return (
    <>
      <PageHeader title="Attendance Overview" subtitle="School-wide attendance for the selected date" />
      <Card className="p-4 mb-4 flex items-center gap-3">
        <Label className="shrink-0">Date</Label>
        <Input type="date" value={date} onChange={e => setDate(e.target.value)} className="max-w-xs" />
      </Card>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<UserCheck className="w-5 h-5" />} label="Present" value={totals.present} />
        <StatCard icon={<ClipboardCheck className="w-5 h-5" />} label="Absent" value={totals.absent} tone="warning" />
        <StatCard icon={<Users className="w-5 h-5" />} label="Total" value={totals.total} tone="secondary" />
        <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Rate" value={`${overall}%`} tone="accent" />
      </div>
      <div className="grid sm:grid-cols-2 gap-3">
        {byClass.map(c => (
          <Card key={c.id} className="p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold">Class {c.name}-{c.section}</div>
              <Badge variant="outline">{c.rate}%</Badge>
            </div>
            <div className="text-xs text-muted-foreground">
              Present {c.present} · Absent {c.absent} · Leave {c.leave} · of {c.total}
            </div>
          </Card>
        ))}
        {classes.length === 0 && <p className="text-muted-foreground col-span-full text-center py-8">No classes.</p>}
      </div>
    </>
  );
}

/* ============================================================
   REPORTS (admin & principal)
   ============================================================ */
export function ReportsPage() {
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const [s, t, c, e, n, f, l] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase.from("teachers").select("id", { count: "exact", head: true }),
        supabase.from("classes").select("id", { count: "exact", head: true }),
        supabase.from("exams").select("id", { count: "exact", head: true }),
        supabase.from("notices").select("id", { count: "exact", head: true }),
        supabase.from("fees").select("amount,paid_amount,status"),
        supabase.from("leave_requests").select("status"),
      ]);
      const fees = f.data ?? [];
      const totalDue = fees.reduce((a, r) => a + Number(r.amount), 0);
      const totalPaid = fees.reduce((a, r) => a + Number(r.paid_amount), 0);
      const leaves = l.data ?? [];
      setStats({
        students: s.count ?? 0, teachers: t.count ?? 0, classes: c.count ?? 0,
        exams: e.count ?? 0, notices: n.count ?? 0,
        feeCollected: totalPaid, feeOutstanding: Math.max(0, totalDue - totalPaid),
        pendingLeaves: leaves.filter(x => x.status === "pending").length,
      });
    })();
  }, []);

  const exportCSV = async () => {
    const { data } = await supabase.from("students").select("admission_number,full_name,roll_number,parent_mobile,classes(name,section)");
    const rows = (data ?? []).map((s: any) =>
      [s.admission_number, s.full_name, s.roll_number, s.parent_mobile, s.classes ? `${s.classes.name}-${s.classes.section}` : ""].join(","));
    const csv = "Admission#,Name,Roll#,Parent Mobile,Class\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "students.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  if (!stats) return <p className="text-muted-foreground text-center py-8">Loading…</p>;
  return (
    <>
      <PageHeader title="Reports" subtitle="Operational and academic snapshot"
        action={<Button onClick={exportCSV} className="bg-gradient-primary text-primary-foreground"><FileText className="w-4 h-4 mr-1" /> Export Students CSV</Button>} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<Users className="w-5 h-5" />} label="Students" value={stats.students} />
        <StatCard icon={<GraduationCap className="w-5 h-5" />} label="Teachers" value={stats.teachers} tone="secondary" />
        <StatCard icon={<BookOpen className="w-5 h-5" />} label="Classes" value={stats.classes} tone="accent" />
        <StatCard icon={<FileText className="w-5 h-5" />} label="Exams" value={stats.exams} tone="warning" />
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs uppercase text-muted-foreground">Fees collected</div>
          <div className="text-2xl font-bold text-accent">₹{stats.feeCollected}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase text-muted-foreground">Outstanding</div>
          <div className="text-2xl font-bold text-destructive">₹{stats.feeOutstanding}</div>
        </Card>
        <Card className="p-5">
          <div className="text-xs uppercase text-muted-foreground">Pending leaves</div>
          <div className="text-2xl font-bold text-warning">{stats.pendingLeaves}</div>
        </Card>
      </div>
    </>
  );
}

/* ============================================================
   TIMETABLE (display grid)
   ============================================================ */
const PERIODS = ["1", "2", "3", "4", "Lunch", "5", "6", "7"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export function TimetablePage({ title = "Timetable" }: { title?: string }) {
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState<string>("");
  const [grid, setGrid] = useState<Record<string, string>>({});

  useEffect(() => {
    supabase.from("classes").select("*").order("name").then(({ data }) => {
      setClasses(data ?? []);
      if (data?.[0]) setClassId(data[0].id);
    });
  }, []);

  useEffect(() => {
    if (!classId) return;
    const stored = localStorage.getItem(`tt-${classId}`);
    setGrid(stored ? JSON.parse(stored) : {});
  }, [classId]);

  const update = (d: string, p: string, v: string) => {
    const next = { ...grid, [`${d}-${p}`]: v };
    setGrid(next);
    if (classId) localStorage.setItem(`tt-${classId}`, JSON.stringify(next));
  };

  return (
    <>
      <PageHeader title={title} subtitle="Weekly class timetable (saved locally for preview)" />
      <Card className="p-4 mb-4">
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger className="max-w-xs"><SelectValue placeholder="Pick a class" /></SelectTrigger>
          <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>Class {c.name}-{c.section}</SelectItem>)}</SelectContent>
        </Select>
      </Card>
      {classId && (
        <Card className="p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr><th className="text-left p-2">Day</th>{PERIODS.map(p => <th key={p} className="p-2">P{p}</th>)}</tr>
            </thead>
            <tbody>
              {DAYS.map(d => (
                <tr key={d} className="border-t border-border">
                  <td className="p-2 font-medium">{d}</td>
                  {PERIODS.map(p => (
                    <td key={p} className="p-1">
                      <Input className="h-8 text-xs min-w-[80px]"
                        placeholder={p === "Lunch" ? "—" : "Subject"}
                        value={grid[`${d}-${p}`] || ""}
                        onChange={e => update(d, p, e.target.value)} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

/* ============================================================
   PERMISSIONS (read-only matrix)
   ============================================================ */
export function PermissionsMatrix() {
  const ROLES = ["admin", "principal", "teacher", "student", "parent"];
  const PERMS = [
    { key: "Manage Users", admin: true, principal: false, teacher: false, student: false, parent: false },
    { key: "Assign Roles", admin: true, principal: false, teacher: false, student: false, parent: false },
    { key: "Manage Classes", admin: true, principal: true, teacher: false, student: false, parent: false },
    { key: "Manage Fees", admin: true, principal: true, teacher: false, student: false, parent: false },
    { key: "Mark Attendance", admin: true, principal: true, teacher: true, student: false, parent: false },
    { key: "Post Notices", admin: true, principal: true, teacher: false, student: false, parent: false },
    { key: "Approve Leaves", admin: true, principal: true, teacher: true, student: false, parent: false },
    { key: "Upload Marks", admin: true, principal: true, teacher: true, student: false, parent: false },
    { key: "View Marks", admin: true, principal: true, teacher: true, student: true, parent: true },
    { key: "Apply Leave", admin: false, principal: false, teacher: true, student: true, parent: false },
  ];
  return (
    <>
      <PageHeader title="Permissions" subtitle="What each role can do across the system" />
      <Card className="p-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr><th className="text-left p-2">Capability</th>{ROLES.map(r => <th key={r} className="p-2 capitalize">{r}</th>)}</tr>
          </thead>
          <tbody>
            {PERMS.map(p => (
              <tr key={p.key} className="border-t border-border">
                <td className="p-2 font-medium">{p.key}</td>
                {ROLES.map(r => (
                  <td key={r} className="p-2 text-center">
                    {(p as any)[r] ? <span className="inline-block w-2 h-2 rounded-full bg-accent" /> : <span className="inline-block w-2 h-2 rounded-full bg-muted" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

/* ============================================================
   APP SETTINGS (local storage)
   ============================================================ */
export function AppSettingsPage() {
  const [settings, setSettings] = useState({
    schoolName: "Vidyalaya Public School", locale: "en-IN", currency: "INR",
    enableNotices: true, enableFees: true, enableLeaves: true,
  });
  useEffect(() => {
    const s = localStorage.getItem("app-settings");
    if (s) setSettings(JSON.parse(s));
  }, []);
  const save = () => {
    localStorage.setItem("app-settings", JSON.stringify(settings));
    toast.success("Settings saved");
  };
  return (
    <>
      <PageHeader title="App Settings" subtitle="Branding, locale and modules" />
      <Card className="p-5 max-w-2xl space-y-4">
        <div><Label>School name</Label><Input value={settings.schoolName} onChange={e => setSettings({ ...settings, schoolName: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Locale</Label><Input value={settings.locale} onChange={e => setSettings({ ...settings, locale: e.target.value })} /></div>
          <div><Label>Currency</Label><Input value={settings.currency} onChange={e => setSettings({ ...settings, currency: e.target.value })} /></div>
        </div>
        <div className="space-y-2">
          {[
            ["enableNotices", "Notices module"],
            ["enableFees", "Fees module"],
            ["enableLeaves", "Leave module"],
          ].map(([k, label]) => (
            <div key={k} className="flex items-center justify-between p-3 rounded-lg bg-muted">
              <Label>{label}</Label>
              <Switch checked={(settings as any)[k]} onCheckedChange={v => setSettings({ ...settings, [k]: v })} />
            </div>
          ))}
        </div>
        <Button onClick={save} className="bg-gradient-primary text-primary-foreground">Save settings</Button>
      </Card>
    </>
  );
}

/* ============================================================
   SYSTEM HEALTH (admin)
   ============================================================ */
export function SystemPage() {
  const [counts, setCounts] = useState<any>({});
  useEffect(() => {
    (async () => {
      const tables = ["students", "teachers", "classes", "fees", "exams", "marks", "attendance", "notices", "leave_requests", "user_roles"];
      const out: any = {};
      await Promise.all(tables.map(async t => {
        const { count } = await supabase.from(t as any).select("id", { count: "exact", head: true });
        out[t] = count ?? 0;
      }));
      setCounts(out);
    })();
  }, []);
  return (
    <>
      <PageHeader title="System" subtitle="Backend health & dataset counts" />
      <Card className="p-5 mb-4 bg-gradient-primary text-primary-foreground">
        <div className="flex items-center gap-3">
          <Database className="w-6 h-6" />
          <div>
            <div className="font-semibold">Database connected</div>
            <div className="text-xs opacity-80">Lovable Cloud · live</div>
          </div>
        </div>
      </Card>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {Object.entries(counts).map(([k, v]) => (
          <Card key={k} className="p-4 text-center">
            <div className="text-xs uppercase text-muted-foreground">{k}</div>
            <div className="text-2xl font-bold">{v as number}</div>
          </Card>
        ))}
      </div>
    </>
  );
}

/* ============================================================
   PROFILE (current user)
   ============================================================ */
export function ProfilePage() {
  const { user, role } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [name, setName] = useState("");
  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle().then(({ data }) => {
      setProfile(data); setName(data?.full_name ?? "");
    });
  }, [user]);
  const save = async () => {
    if (!user) return;
    const { error } = await supabase.from("profiles").update({ full_name: name }).eq("id", user.id);
    if (error) return toast.error(error.message);
    toast.success("Profile updated");
  };
  return (
    <>
      <PageHeader title="My Profile" subtitle="Your personal information" />
      <Card className="p-5 max-w-xl space-y-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gradient-primary text-primary-foreground flex items-center justify-center text-2xl font-bold">
            {(name || user?.email || "?")[0].toUpperCase()}
          </div>
          <div>
            <div className="font-semibold">{user?.email}</div>
            <Badge variant="outline" className="capitalize mt-1">{role ?? "guest"}</Badge>
          </div>
        </div>
        <div><Label>Full name</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
        <div><Label>Email</Label><Input value={user?.email ?? ""} disabled /></div>
        <div><Label>Phone</Label><Input value={profile?.phone ?? user?.phone ?? ""} disabled /></div>
        <Button onClick={save} className="bg-gradient-primary text-primary-foreground">Save</Button>
      </Card>
    </>
  );
}

/* ============================================================
   PRINCIPAL: ALL CLASSES (read-only)
   ============================================================ */
export function ClassesReadOnly() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data: classes } = await supabase.from("classes").select("*").order("name");
      const { data: students } = await supabase.from("students").select("class_id");
      const counts = new Map<string, number>();
      students?.forEach(s => s.class_id && counts.set(s.class_id, (counts.get(s.class_id) ?? 0) + 1));
      setRows((classes ?? []).map(c => ({ ...c, count: counts.get(c.id) ?? 0 })));
    })();
  }, []);
  return (
    <>
      <PageHeader title="All Classes" subtitle={`${rows.length} classes in the school`} />
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {rows.map(c => (
          <Card key={c.id} className="p-4">
            <div className="font-bold text-lg">Class {c.name}</div>
            <div className="text-xs text-muted-foreground">Section {c.section}</div>
            <div className="mt-2 text-sm"><span className="font-semibold text-primary">{c.count}</span> students</div>
          </Card>
        ))}
        {rows.length === 0 && <p className="col-span-full text-center text-muted-foreground py-8">No classes yet.</p>}
      </div>
    </>
  );
}

/* ============================================================
   PRINCIPAL: STUDENTS DIRECTORY (read-only)
   ============================================================ */
export function StudentsDirectory() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    supabase.from("students").select("*, classes(name,section)").order("full_name").then(({ data }) => setRows(data ?? []));
  }, []);
  const filtered = rows.filter(r => !q || r.full_name?.toLowerCase().includes(q.toLowerCase()) || r.admission_number?.includes(q));
  return (
    <>
      <PageHeader title="All Students" subtitle={`${rows.length} enrolled across the school`} />
      <Input placeholder="Search by name or admission #" value={q} onChange={e => setQ(e.target.value)} className="mb-4 max-w-md" />
      <div className="space-y-2">
        {filtered.map(r => (
          <Card key={r.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-semibold">{r.full_name}</div>
              <div className="text-xs text-muted-foreground">Adm# {r.admission_number} · {r.classes ? `Class ${r.classes.name}-${r.classes.section}` : "Unassigned"}</div>
            </div>
            <Badge variant="outline">{r.parent_mobile || "—"}</Badge>
          </Card>
        ))}
        {filtered.length === 0 && <p className="text-muted-foreground text-center py-8">No students.</p>}
      </div>
    </>
  );
}

/* ============================================================
   PRINCIPAL: PRESENT TODAY
   ============================================================ */
export function PresentToday() {
  const today = new Date().toISOString().slice(0, 10);
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("attendance").select("status, students(full_name, admission_number, classes(name,section))").eq("date", today).eq("status", "present")
      .then(({ data }) => setRows(data ?? []));
  }, [today]);
  return (
    <>
      <PageHeader title="Present Students" subtitle={`Live snapshot · ${today}`} />
      <div className="space-y-2">
        {rows.map((r, i) => (
          <Card key={i} className="p-3 flex items-center justify-between">
            <div>
              <div className="font-medium">{r.students?.full_name}</div>
              <div className="text-xs text-muted-foreground">Adm# {r.students?.admission_number}</div>
            </div>
            {r.students?.classes && <Badge variant="outline">Class {r.students.classes.name}-{r.students.classes.section}</Badge>}
          </Card>
        ))}
        {rows.length === 0 && <p className="text-muted-foreground text-center py-8">No present records yet today.</p>}
      </div>
    </>
  );
}

/* ============================================================
   PRINCIPAL: TEACHERS LIST
   ============================================================ */
export function TeachersDirectory() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("teachers").select("*, class_teacher:classes!class_teacher_of(name,section)").order("full_name")
      .then(({ data }) => setRows(data ?? []));
  }, []);
  return (
    <>
      <PageHeader title="Teachers" subtitle={`${rows.length} teaching staff`} />
      <div className="space-y-2">
        {rows.map(r => (
          <Card key={r.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-semibold">{r.full_name}</div>
              <div className="text-xs text-muted-foreground">
                {r.subject || "—"} · {r.mobile || "no mobile"}
                {r.class_teacher && <> · Class teacher of {r.class_teacher.name}-{r.class_teacher.section}</>}
              </div>
            </div>
            {r.is_class_teacher && <Badge>Class Teacher</Badge>}
          </Card>
        ))}
        {rows.length === 0 && <p className="text-muted-foreground text-center py-8">No teachers.</p>}
      </div>
    </>
  );
}

/* ============================================================
   PRINCIPAL: PERFORMANCE (avg marks per class)
   ============================================================ */
export function PerformancePage() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data: exams } = await supabase.from("exams").select("id,class_id,max_marks,classes(name,section)");
      const { data: marks } = await supabase.from("marks").select("exam_id,marks_obtained");
      const byClass: Record<string, { total: number; out: number; name: string }> = {};
      exams?.forEach(e => {
        const examMarks = marks?.filter(m => m.exam_id === e.id) ?? [];
        examMarks.forEach(m => {
          const k = e.class_id;
          if (!byClass[k]) byClass[k] = { total: 0, out: 0, name: e.classes ? `${e.classes.name}-${e.classes.section}` : "—" };
          byClass[k].total += Number(m.marks_obtained);
          byClass[k].out += Number(e.max_marks);
        });
      });
      setRows(Object.entries(byClass).map(([id, v]) => ({ id, ...v, pct: v.out ? Math.round((v.total / v.out) * 100) : 0 })));
    })();
  }, []);
  return (
    <>
      <PageHeader title="Performance Metrics" subtitle="Average exam scores per class" />
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map(r => (
          <Card key={r.id} className="p-4">
            <div className="font-semibold">Class {r.name}</div>
            <div className="text-3xl font-bold text-primary mt-1">{r.pct}%</div>
            <div className="text-xs text-muted-foreground">avg score across exams</div>
          </Card>
        ))}
        {rows.length === 0 && <p className="col-span-full text-muted-foreground text-center py-8">No marks yet.</p>}
      </div>
    </>
  );
}

/* ============================================================
   PRINCIPAL: FEES OVERVIEW
   ============================================================ */
export function FeesOverview() {
  const [stats, setStats] = useState<any>(null);
  useEffect(() => {
    supabase.from("fees").select("amount,paid_amount,status").then(({ data }) => {
      const f = data ?? [];
      const totalDue = f.reduce((a, r) => a + Number(r.amount), 0);
      const totalPaid = f.reduce((a, r) => a + Number(r.paid_amount), 0);
      setStats({
        totalDue, totalPaid, outstanding: Math.max(0, totalDue - totalPaid),
        paid: f.filter(r => r.status === "paid").length,
        partial: f.filter(r => r.status === "partial").length,
        unpaid: f.filter(r => r.status === "unpaid").length,
        records: f.length,
      });
    });
  }, []);
  if (!stats) return <p className="text-muted-foreground text-center py-8">Loading…</p>;
  const rate = stats.totalDue ? Math.round((stats.totalPaid / stats.totalDue) * 100) : 0;
  return (
    <>
      <PageHeader title="Fees Overview" subtitle="School-wide fee collection summary" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
        <StatCard icon={<Wallet className="w-5 h-5" />} label="Collected" value={`₹${stats.totalPaid}`} tone="accent" />
        <StatCard icon={<Wallet className="w-5 h-5" />} label="Outstanding" value={`₹${stats.outstanding}`} tone="warning" />
        <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Collection rate" value={`${rate}%`} />
        <StatCard icon={<FileText className="w-5 h-5" />} label="Records" value={stats.records} tone="secondary" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-4 text-center"><div className="text-2xl font-bold text-accent">{stats.paid}</div><div className="text-xs text-muted-foreground">Paid</div></Card>
        <Card className="p-4 text-center"><div className="text-2xl font-bold text-warning">{stats.partial}</div><div className="text-xs text-muted-foreground">Partial</div></Card>
        <Card className="p-4 text-center"><div className="text-2xl font-bold text-destructive">{stats.unpaid}</div><div className="text-xs text-muted-foreground">Unpaid</div></Card>
      </div>
    </>
  );
}

/* ============================================================
   PRINCIPAL: ACTIVITY LOG
   ============================================================ */
export function ActivityLogPage() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(100).then(({ data }) => setRows(data ?? []));
  }, []);
  return (
    <>
      <PageHeader title="Activity Logs" subtitle="Recent administrative actions" />
      <div className="space-y-2">
        {rows.map(r => (
          <Card key={r.id} className="p-4 flex items-center justify-between">
            <div>
              <div className="font-medium">{r.action}</div>
              <div className="text-xs text-muted-foreground">{r.entity || "system"} · {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</div>
            </div>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </Card>
        ))}
        {rows.length === 0 && (
          <Card className="p-8 text-center text-muted-foreground">
            <Activity className="w-6 h-6 mx-auto mb-2 opacity-50" />
            No activity recorded yet.
          </Card>
        )}
      </div>
    </>
  );
}
