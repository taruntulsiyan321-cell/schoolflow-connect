import { useEffect, useMemo, useState } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Users,
  UserCheck,
  UserX,
  Percent,
  GraduationCap,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RTooltip,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";

type Klass = { id: string; name: string; section: string; academic_year: string | null };
type Student = { id: string; full_name: string; roll_number: string | null; admission_number: string };
type AttRow = { student_id: string; status: string; date: string };
type Mark = { student_id: string; marks_obtained: number; exam_id: string };

export default function PrincipalClassDetail() {
  const { classId } = useParams<{ classId: string }>();
  if (!classId) return <Navigate to="/principal/classes" replace />;

  const [klass, setKlass] = useState<Klass | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [todayAtt, setTodayAtt] = useState<AttRow[]>([]);
  const [trend, setTrend] = useState<{ date: string; rate: number }[]>([]);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [classTeacher, setClassTeacher] = useState<{ full_name: string; mobile: string | null } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const today = new Date().toISOString().split("T")[0];
      const since = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000)
        .toISOString()
        .split("T")[0];

      const [k, s, attT, attR, ct, mk] = await Promise.all([
        supabase.from("classes").select("*").eq("id", classId).maybeSingle(),
        supabase
          .from("students")
          .select("id, full_name, roll_number, admission_number")
          .eq("class_id", classId)
          .order("roll_number", { nullsFirst: false }),
        supabase.from("attendance").select("student_id,status,date").eq("class_id", classId).eq("date", today),
        supabase.from("attendance").select("student_id,status,date").eq("class_id", classId).gte("date", since),
        supabase
          .from("teachers")
          .select("full_name, mobile")
          .eq("class_teacher_of", classId)
          .maybeSingle(),
        supabase.from("marks").select("student_id, marks_obtained, exam_id"),
      ]);

      setKlass(k.data ?? null);
      setStudents((s.data ?? []) as Student[]);
      setTodayAtt((attT.data ?? []) as AttRow[]);
      setClassTeacher(ct.data ?? null);

      const studentIdSet = new Set((s.data ?? []).map((x: any) => x.id));
      setMarks(((mk.data ?? []) as Mark[]).filter((m) => studentIdSet.has(m.student_id)));

      // build daily attendance % trend (last 30 days)
      const byDate: Record<string, { p: number; t: number }> = {};
      ((attR.data ?? []) as AttRow[]).forEach((r) => {
        const d = r.date;
        byDate[d] = byDate[d] ?? { p: 0, t: 0 };
        byDate[d].t += 1;
        if (r.status === "present") byDate[d].p += 1;
      });
      const trendArr = Object.entries(byDate)
        .map(([date, v]) => ({ date, rate: v.t ? Math.round((v.p / v.t) * 100) : 0 }))
        .sort((a, b) => a.date.localeCompare(b.date));
      setTrend(trendArr);

      setLoading(false);
    })();
  }, [classId]);

  const present = todayAtt.filter((r) => r.status === "present").length;
  const absent = todayAtt.filter((r) => r.status === "absent").length;
  const total = students.length;
  const attendanceRate = todayAtt.length ? Math.round((present / todayAtt.length) * 100) : 0;

  const marksByStudent = useMemo(() => {
    const m: Record<string, { sum: number; n: number }> = {};
    marks.forEach((row) => {
      m[row.student_id] = m[row.student_id] ?? { sum: 0, n: 0 };
      m[row.student_id].sum += Number(row.marks_obtained);
      m[row.student_id].n += 1;
    });
    return m;
  }, [marks]);

  const distribution = useMemo(() => {
    const buckets = [
      { range: "0-40", count: 0 },
      { range: "40-60", count: 0 },
      { range: "60-75", count: 0 },
      { range: "75-90", count: 0 },
      { range: "90-100", count: 0 },
    ];
    Object.values(marksByStudent).forEach(({ sum, n }) => {
      if (!n) return;
      const avg = sum / n;
      const i = avg < 40 ? 0 : avg < 60 ? 1 : avg < 75 ? 2 : avg < 90 ? 3 : 4;
      buckets[i].count += 1;
    });
    return buckets;
  }, [marksByStudent]);

  if (loading) return <p className="text-muted-foreground text-center py-12">Loading class…</p>;
  if (!klass) return <Navigate to="/principal/classes" replace />;

  return (
    <>
      <div className="mb-3">
        <Link
          to="/principal/classes"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="w-4 h-4 mr-1" /> Back to all classes
        </Link>
      </div>

      <PageHeader
        title={`Class ${klass.name} · Section ${klass.section}`}
        subtitle={klass.academic_year ?? "Current academic year"}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<Users className="w-5 h-5" />} label="Total Students" value={total} />
        <StatCard
          icon={<UserCheck className="w-5 h-5" />}
          label="Present Today"
          value={present}
          tone="secondary"
        />
        <StatCard
          icon={<UserX className="w-5 h-5" />}
          label="Absent Today"
          value={absent}
          tone="warning"
        />
        <StatCard
          icon={<Percent className="w-5 h-5" />}
          label="Attendance %"
          value={`${attendanceRate}%`}
          tone="accent"
        />
      </div>

      <Card className="p-5 mb-6 flex flex-wrap items-center gap-4 justify-between">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-gradient-primary text-primary-foreground flex items-center justify-center shadow-elevated">
            <GraduationCap className="w-5 h-5" />
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide">Class Teacher</div>
            <div className="font-semibold">
              {classTeacher?.full_name ?? "Not assigned"}
            </div>
            {classTeacher?.mobile && (
              <div className="text-xs text-muted-foreground">{classTeacher.mobile}</div>
            )}
          </div>
        </div>
        {todayAtt.length === 0 && (
          <div className="text-xs px-3 py-1.5 rounded-md bg-warning/10 text-warning">
            Attendance not marked yet today
          </div>
        )}
      </Card>

      <Tabs defaultValue="students" className="space-y-4">
        <TabsList>
          <TabsTrigger value="students">Students</TabsTrigger>
          <TabsTrigger value="academics">Academics</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="students">
          <Card className="p-0 overflow-hidden">
            {students.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No students enrolled in this class yet.
              </p>
            ) : (
              <ul className="divide-y">
                {students.map((s) => {
                  const today = todayAtt.find((a) => a.student_id === s.id);
                  const m = marksByStudent[s.id];
                  const avg = m && m.n ? Math.round(m.sum / m.n) : null;
                  return (
                    <li key={s.id}>
                      <Link
                        to={`/principal/students/${s.id}`}
                        className="flex items-center justify-between px-5 py-3 hover:bg-accent/50 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="font-medium truncate">{s.full_name}</div>
                          <div className="text-xs text-muted-foreground">
                            Roll {s.roll_number || "-"} · Adm# {s.admission_number}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {avg !== null && (
                            <span className="text-xs px-2 py-1 rounded-md bg-accent text-accent-foreground">
                              Avg {avg}
                            </span>
                          )}
                          <span
                            className={`text-xs px-2 py-1 rounded-md ${
                              today?.status === "present"
                                ? "bg-secondary/15 text-secondary"
                                : today?.status === "absent"
                                ? "bg-destructive/15 text-destructive"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {today?.status ?? "—"}
                          </span>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="academics">
          <Card className="p-5">
            <h3 className="font-semibold mb-4">Per-student average marks</h3>
            {Object.keys(marksByStudent).length === 0 ? (
              <p className="text-muted-foreground text-sm">No marks recorded yet.</p>
            ) : (
              <ul className="divide-y">
                {students.map((s) => {
                  const m = marksByStudent[s.id];
                  const avg = m && m.n ? Math.round(m.sum / m.n) : null;
                  if (avg === null) return null;
                  return (
                    <li
                      key={s.id}
                      className="py-2.5 flex items-center justify-between text-sm"
                    >
                      <span className="truncate">{s.full_name}</span>
                      <span className="font-semibold">{avg}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <Card className="p-5">
            <h3 className="font-semibold mb-4">Attendance trend (last 30 days)</h3>
            {trend.length === 0 ? (
              <p className="text-muted-foreground text-sm">Not enough data yet.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} domain={[0, 100]} />
                    <RTooltip />
                    <Line type="monotone" dataKey="rate" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold mb-4">Marks distribution</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distribution}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="range" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <RTooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
