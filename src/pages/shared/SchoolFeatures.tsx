import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AttendanceService, AnalyticsService } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
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
  Lock, Unlock, History, Check, X, Coffee,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { classLabel } from "@/lib/utils";
import { toErrorMessage } from "@/lib/presentation";

/* ============================================================
   USERS DIRECTORY (admin)
   ============================================================ */
const ALL_ROLES = ["admin", "principal", "teacher", "student", "parent"] as const;
const ROLE_TONE: Record<string, string> = {
  admin: "bg-primary/10 text-primary border-primary/30",
  principal: "bg-accent/10 text-accent border-accent/30",
  teacher: "bg-secondary text-secondary-foreground",
  student: "bg-warning/10 text-warning border-warning/30",
  parent: "bg-muted text-muted-foreground",
};

export function UsersDirectory() {
  const [rows, setRows] = useState<any[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    const { data, error } = await supabase.rpc("admin_list_users_with_roles");
    if (error) toast.error(error.message);
    setRows((data as any[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const assign = async (u: any, role: string) => {
    if (!role || u.roles?.includes(role)) return;
    const identifier = u.email || u.phone;
    if (!identifier) return toast.error("User has no email or phone to identify.");
    setBusy(u.user_id);
    const { error } = await supabase.rpc("admin_assign_role", { _identifier: identifier, _role: role as any });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(`Granted ${role}`);
    setRows(prev => prev.map(r => r.user_id === u.user_id ? { ...r, roles: [...(r.roles ?? []), role] } : r));
  };

  const remove = async (u: any, role: string) => {
    setBusy(u.user_id);
    const { error } = await supabase.rpc("admin_remove_role", { _user_id: u.user_id, _role: role as any });
    setBusy(null);
    if (error) return toast.error(error.message);
    toast.success(`Removed ${role}`);
    setRows(prev => prev.map(r => r.user_id === u.user_id ? { ...r, roles: (r.roles ?? []).filter((x: string) => x !== role) } : r));
  };

  const filtered = rows.filter(r => !q || r.email?.toLowerCase().includes(q.toLowerCase()) || r.phone?.includes(q));
  return (
    <>
      <PageHeader title="User Management" subtitle={`${rows.length} registered users · assign or revoke roles`} />
      <div className="flex gap-3 mb-4">
        <Input placeholder="Search by email or phone..." value={q} onChange={e => setQ(e.target.value)} />
      </div>
      {loading ? <p className="text-muted-foreground text-center py-8">Loading...</p> : (
        <div className="space-y-2">
          {filtered.map(u => {
            const available = ALL_ROLES.filter(r => !(u.roles ?? []).includes(r));
            return (
              <Card key={u.user_id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-card">
                <div className="min-w-0">
                  <div className="font-medium truncate">{u.email || u.phone || "Unknown user"}</div>
                  <div className="text-xs text-muted-foreground">Joined {formatDistanceToNow(new Date(u.created_at), { addSuffix: true })}</div>
                </div>
                <div className="flex gap-1.5 flex-wrap items-center sm:justify-end">
                  {(u.roles ?? []).length === 0
                    ? <Badge variant="outline" className="text-muted-foreground">No role</Badge>
                    : u.roles.map((r: string) => (
                        <Badge key={r} variant="outline" className={`capitalize gap-1 ${ROLE_TONE[r] ?? ""}`}>
                          {r}
                          <button
                            onClick={() => remove(u, r)}
                            disabled={busy === u.user_id}
                            className="hover:text-destructive disabled:opacity-50"
                            title={`Remove ${r}`}
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                  {available.length > 0 && (
                    <Select value="" onValueChange={(v) => assign(u, v)} disabled={busy === u.user_id}>
                      <SelectTrigger className="h-7 w-[120px] text-xs"><SelectValue placeholder="+ Add role" /></SelectTrigger>
                      <SelectContent>
                        {available.map(r => <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </Card>
            );
          })}
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
  const { ctx, ready } = useAcademicContext();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [summary, setSummary] = useState<Awaited<
    ReturnType<typeof AttendanceService.summarizeSchoolDate>
  > | null>(null);
  const [schoolAvg, setSchoolAvg] = useState(0);
  const [editClass, setEditClass] = useState<{
    classId: string;
    className: string;
    section: string;
  } | null>(null);
  const [students, setStudents] = useState<{ id: string; fullName: string; rollNumber: string | null }[]>([]);
  const [editMarks, setEditMarks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    if (!ctx) return;
    setLoading(true);
    try {
      const [day, school] = await Promise.all([
        AttendanceService.summarizeSchoolDate(ctx, date),
        AnalyticsService.forSchool(ctx),
      ]);
      setSummary(day);
      setSchoolAvg(Math.round(school.avgAttendancePct));
    } catch (e) {
      toast.error(toErrorMessage(e, "Failed to load attendance"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!ready || !ctx) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, ctx, date]);

  const openEdit = async (c: {
    classId: string;
    className: string;
    section: string;
  }) => {
    if (!ctx) return;
    try {
      const [roster, records] = await Promise.all([
        AttendanceService.listClassStudents(ctx, c.classId),
        AttendanceService.listForClassDate(ctx, c.classId, date),
      ]);
      const m: Record<string, string> = {};
      roster.forEach((s) => {
        const rec = records.find((r) => r.studentId === s.id);
        m[s.id] = rec?.status ?? "present";
      });
      setStudents(
        roster.map((s) => ({
          id: s.id,
          fullName: s.fullName,
          rollNumber: s.rollNumber,
        })),
      );
      setEditMarks(m);
      setEditClass(c);
    } catch (e) {
      toast.error(toErrorMessage(e, "Failed to open editor"));
    }
  };

  const saveEdit = async () => {
    if (!ctx || !editClass) return toast.error("Sign in required");
    const rows = students.map((s) => ({
      studentId: s.id,
      classId: editClass.classId,
      date,
      status: (editMarks[s.id] ?? "present") as
        | "present"
        | "absent"
        | "leave"
        | "late"
        | "half_day",
    }));
    try {
      await AttendanceService.markBulk(ctx, rows);
      toast.success("Attendance updated via AttendanceService");
      setEditClass(null);
      await reload();
    } catch (err) {
      toast.error(toErrorMessage(err, "Failed to save attendance"));
    }
  };

  const unlock = async (classId: string) => {
    const { error } = await supabase
      .from("attendance_locks")
      .delete()
      .eq("class_id", classId)
      .eq("date", date);
    if (error) return toast.error(error.message);
    toast.success("Attendance unlocked for this class");
    await reload();
  };

  if (!ready) {
    return <p className="text-muted-foreground text-center py-12">Loading session…</p>;
  }

  return (
    <>
      <PageHeader
        title="Attendance Control"
        subtitle="Admin view via AttendanceService · AnalyticsService"
      />
      <Card className="p-4 mb-4 flex items-center gap-3">
        <Label className="shrink-0">Date</Label>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="max-w-xs" />
      </Card>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<UserCheck className="w-5 h-5" />} label="Present today" value={summary?.present ?? 0} />
        <StatCard
          icon={<ClipboardCheck className="w-5 h-5" />}
          label="Absent today"
          value={summary?.absent ?? 0}
          tone="warning"
        />
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Total students"
          value={summary?.totalStudents ?? 0}
          tone="secondary"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Day rate / Profile avg"
          value={`${summary?.overallDayRatePct ?? 0}% / ${schoolAvg}%`}
          tone="accent"
        />
      </div>

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Loading attendance summary...</p>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {(summary?.classes ?? []).map((c) => (
            <Card key={c.classId} className="p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">
                  {c.className}-{c.section}
                </div>
                <div className="flex items-center gap-2">
                  {c.locked ? (
                    <Badge variant="outline" className="gap-1">
                      <Lock className="w-3 h-3" />
                      Locked
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      Open
                    </Badge>
                  )}
                  <Badge variant="outline">{c.dayRatePct}%</Badge>
                </div>
              </div>
              <div className="text-xs text-muted-foreground mb-3">
                Present {c.present} · Absent {c.absent} · Late {c.late} · Half {c.halfDay} · of{" "}
                {c.totalStudents} · marked {c.marked}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 text-xs"
                  disabled={c.locked}
                  title={c.locked ? "Unlock this class/date first to edit attendance" : undefined}
                  onClick={() =>
                    void openEdit({
                      classId: c.classId,
                      className: c.className,
                      section: c.section,
                    })
                  }
                >
                  Edit Attendance
                </Button>
                {c.locked && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-xs"
                    onClick={() => void unlock(c.classId)}
                  >
                    <Unlock className="w-3 h-3 mr-1" />
                    Unlock
                  </Button>
                )}
              </div>
            </Card>
          ))}
          {(summary?.classes.length ?? 0) === 0 && (
            <p className="text-muted-foreground col-span-full text-center py-8">No classes.</p>
          )}
        </div>
      )}

      <Dialog open={!!editClass} onOpenChange={(v) => !v && setEditClass(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Edit Attendance · {editClass?.className}-{editClass?.section} · {date}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 my-2">
            {students.map((s) => (
              <div key={s.id} className="flex items-center justify-between p-2 border rounded-lg">
                <div>
                  <div className="text-sm font-medium">{s.fullName}</div>
                  <div className="text-xs text-muted-foreground">Roll {s.rollNumber ?? "—"}</div>
                </div>
                <Select
                  value={editMarks[s.id] ?? "present"}
                  onValueChange={(v) => setEditMarks((m) => ({ ...m, [s.id]: v }))}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["present", "absent", "late", "half_day", "leave"].map((st) => (
                      <SelectItem key={st} value={st} className="capitalize">
                        {st.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>
          <Button onClick={() => void saveEdit()}>Save via AttendanceService</Button>
        </DialogContent>
      </Dialog>
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
    const { data, error } = await supabase.from("students").select("admission_number,full_name,roll_number,parent_mobile,classes(name,section)");
    if (error) return toast.error("Failed to export students: " + error.message);
    const rows = (data ?? []).map((s: any) =>
      [s.admission_number, s.full_name, s.roll_number, s.parent_mobile, s.classes ? `${s.classes.name}-${s.classes.section}` : ""].join(","));
    const csv = "Admission#,Name,Roll#,Parent Mobile,Class\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "students.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  if (!stats) return <p className="text-muted-foreground text-center py-8">Loading...</p>;
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
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    supabase.from("classes").select("*").order("name").then(({ data }) => {
      setClasses(data ?? []);
      if (data?.[0]) setClassId(data[0].id);
    });
  }, []);

  useEffect(() => {
    if (!classId) return;
    setDirty(false);
    supabase.from("class_timetables").select("grid").eq("class_id", classId).maybeSingle()
      .then(({ data }) => setGrid((data?.grid as unknown as Record<string, string>) ?? {}));
  }, [classId]);

  const update = (d: string, p: string, v: string) => {
    setGrid((g) => ({ ...g, [`${d}-${p}`]: v }));
    setDirty(true);
  };

  const save = async () => {
    if (!classId) return;
    setSaving(true);
    const { error } = await supabase.from("class_timetables").upsert({
      class_id: classId, grid, updated_at: new Date().toISOString(),
    }, { onConflict: "class_id" });
    setSaving(false);
    if (error) return toast.error(error.message);
    setDirty(false);
    toast.success("Timetable saved for the class");
  };

  return (
    <>
      <PageHeader title={title} subtitle="Weekly class timetable — shared with the whole class" />
      <Card className="p-4 mb-4 flex items-center justify-between gap-3 flex-wrap">
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger className="max-w-xs"><SelectValue placeholder="Pick a class" /></SelectTrigger>
          <SelectContent>{classes.map(c => <SelectItem key={c.id} value={c.id}>{classLabel(c)}</SelectItem>)}</SelectContent>
        </Select>
        <Button onClick={save} disabled={saving || !dirty}>{saving ? "Saving..." : dirty ? "Save timetable" : "Saved"}</Button>
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
  const { user } = useAuth();
  const { ctx, ready } = useAcademicContext();
  const [settings, setSettings] = useState({
    schoolName: "Vidyalaya Public School", locale: "en-IN", currency: "INR",
    enableNotices: true, enableFees: true, enableLeaves: true,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!ready || !ctx.schoolId) return;
    (async () => {
      const { data, error } = await supabase.from("app_settings").select("*").eq("school_id", ctx.schoolId).maybeSingle();
      if (error) {
        // Fall back to any locally cached settings if the table is unavailable.
        const s = localStorage.getItem("app-settings");
        if (s) setSettings(JSON.parse(s));
      } else if (data) {
        const d = data;
        setSettings({
          schoolName: d.school_name ?? "Vidyalaya Public School",
          locale: d.locale ?? "en-IN",
          currency: d.currency ?? "INR",
          enableNotices: d.enable_notices ?? true,
          enableFees: d.enable_fees ?? true,
          enableLeaves: d.enable_leaves ?? true,
        });
      }
      setLoading(false);
    })();
  }, [ready, ctx.schoolId]);

  const save = async () => {
    if (!ctx.schoolId) return;
    setSaving(true);
    const { error } = await supabase.from("app_settings").upsert(
      {
        school_id: ctx.schoolId,
        school_name: settings.schoolName,
        locale: settings.locale,
        currency: settings.currency,
        enable_notices: settings.enableNotices,
        enable_fees: settings.enableFees,
        enable_leaves: settings.enableLeaves,
        updated_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      },
      { onConflict: "school_id" },
    );
    setSaving(false);
    if (error) return toast.error(error.message);
    localStorage.setItem("app-settings", JSON.stringify(settings));
    toast.success("Settings saved");
  };

  return (
    <>
      <PageHeader title="App Settings" subtitle="Branding, locale and modules — shared across the school" />
      <Card className="p-5 max-w-2xl space-y-4">
        <div><Label>School name</Label><Input value={settings.schoolName} disabled={loading} onChange={e => setSettings({ ...settings, schoolName: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Locale</Label><Input value={settings.locale} disabled={loading} onChange={e => setSettings({ ...settings, locale: e.target.value })} /></div>
          <div><Label>Currency</Label><Input value={settings.currency} disabled={loading} onChange={e => setSettings({ ...settings, currency: e.target.value })} /></div>
        </div>
        <div className="space-y-2">
          {[
            ["enableNotices", "Notices module"],
            ["enableFees", "Fees module"],
            ["enableLeaves", "Leave module"],
          ].map(([k, label]) => (
            <div key={k} className="flex items-center justify-between p-3 rounded-lg bg-muted">
              <Label>{label}</Label>
              <Switch checked={(settings as any)[k]} disabled={loading} onCheckedChange={v => setSettings({ ...settings, [k]: v })} />
            </div>
          ))}
        </div>
        <Button onClick={save} disabled={loading || saving} className="bg-gradient-primary text-primary-foreground">
          {saving ? "Saving..." : "Save settings"}
        </Button>
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
            <div className="text-xs opacity-80">Supabase · live</div>
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
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("*").eq("id", user.id).maybeSingle().then(({ data }) => {
      setProfile(data);
      setName(data?.full_name ?? "");
      setPhone(data?.phone ?? user.phone ?? "");
    });
  }, [user]);
  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from("profiles").update({ full_name: name, phone: phone || null }).eq("id", user.id);
    setSaving(false);
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
        <div><Label>Phone</Label><Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Contact number" /></div>
        <Button onClick={save} disabled={saving} className="bg-gradient-primary text-primary-foreground">{saving ? "Saving..." : "Save"}</Button>
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
      const { data: classes, error: classesError } = await supabase.from("classes").select("*").order("name");
      if (classesError) return toast.error("Failed to load classes: " + classesError.message);
      const { data: students, error: studentsError } = await supabase.from("students").select("class_id");
      if (studentsError) toast.error("Failed to load class sizes: " + studentsError.message);
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
  const { ctx, ready } = useAcademicContext();
  const today = new Date().toISOString().slice(0, 10);
  const [rows, setRows] = useState<
    { className: string; section: string; present: number; total: number; dayRatePct: number }[]
  >([]);
  useEffect(() => {
    if (!ready || !ctx) return;
    void AttendanceService.summarizeSchoolDate(ctx, today)
      .then((day) =>
        setRows(
          day.classes.map((c) => ({
            className: c.className,
            section: c.section,
            present: c.present,
            total: c.totalStudents,
            dayRatePct: c.dayRatePct,
          })),
        ),
      )
      .catch(() => setRows([]));
  }, [ready, ctx, today]);
  return (
    <>
      <PageHeader title="Present Students" subtitle={`AttendanceService · ${today}`} />
      <div className="space-y-2">
        {rows.map((r) => (
          <Card key={`${r.className}-${r.section}`} className="p-3 flex items-center justify-between">
            <div>
              <div className="font-medium">
                {r.className}-{r.section}
              </div>
              <div className="text-xs text-muted-foreground">
                Present {r.present} of {r.total}
              </div>
            </div>
            <Badge variant="outline">{r.dayRatePct}%</Badge>
          </Card>
        ))}
        {rows.length === 0 && (
          <p className="text-muted-foreground text-center py-8">No class summaries for today.</p>
        )}
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
      const { data: exams, error: examsError } = await supabase.from("exams").select("id,class_id,max_marks,classes(name,section)");
      if (examsError) return toast.error("Failed to load exams: " + examsError.message);
      const { data: marks, error: marksError } = await supabase.from("marks").select("exam_id,marks_obtained");
      if (marksError) return toast.error("Failed to load marks: " + marksError.message);
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
  if (!stats) return <p className="text-muted-foreground text-center py-8">Loading...</p>;
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
  const { ctx, ready } = useAcademicContext();
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    if (!ready || !ctx.schoolId) return;
    supabase
      .from("audit_logs")
      .select("*")
      .eq("school_id", ctx.schoolId)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => setRows(data ?? []));
  }, [ready, ctx.schoolId]);
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
