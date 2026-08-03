import { useEffect, useMemo, useState } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  AcademicProfileService,
  AnalyticsService,
  AttendanceService,
  AuditReadService,
  useAcademicLive,
} from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
import { localDateKey } from "@/lib/localDate";
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

/**
 * Principal class detail — attendance & analytics from Academic Engine only.
 * No manual attendance % aggregation from raw attendance rows for profile rates.
 */
export default function PrincipalClassDetail() {
  const { classId } = useParams<{ classId: string }>();
  const { ctx, ready, settled } = useAcademicContext();
  const liveVersion = useAcademicLive(["attendance", "marks", "examination", "profile"]);

  const [klass, setKlass] = useState<Klass | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [todayPresent, setTodayPresent] = useState(0);
  const [todayAbsent, setTodayAbsent] = useState(0);
  const [todayMarked, setTodayMarked] = useState(0);
  const [avgAttendancePct, setAvgAttendancePct] = useState(0);
  const [profileRows, setProfileRows] = useState<
    { studentId: string; attendancePct: number; examsAvgPct: number }[]
  >([]);
  const [feed, setFeed] = useState<{ title: string; created_at: string }[]>([]);
  const [auditHint, setAuditHint] = useState(0);
  const [classTeacher, setClassTeacher] = useState<{ full_name: string; mobile: string | null } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!settled) return;
    if (!ready || !ctx || !classId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const today = localDateKey();

        const [k, s, ct, analytics, profiles, todayAtt] = await Promise.all([
          supabase.from("classes").select("*").eq("id", classId).eq("school_id", ctx.schoolId).maybeSingle(),
          supabase
            .from("students")
            .select("id, full_name, roll_number, admission_number")
            .eq("class_id", classId)
            .eq("school_id", ctx.schoolId)
            .order("roll_number", { nullsFirst: false }),
          supabase
            .from("teachers")
            .select("full_name, mobile")
            .eq("class_teacher_of", classId)
            .eq("school_id", ctx.schoolId)
            .maybeSingle(),
          AnalyticsService.forClass(ctx, classId),
          AcademicProfileService.listForClass(ctx, classId, { limit: 200 }),
          AttendanceService.listForClassDate(ctx, classId, today),
        ]);

        if (cancelled) return;

        setKlass(k.data ?? null);
        setStudents((s.data ?? []) as Student[]);
        setClassTeacher(ct.data ?? null);
        setAvgAttendancePct(Math.round(analytics.avgAttendancePct));
        setProfileRows(
          profiles.map((p) => ({
            studentId: p.studentId,
            attendancePct: Math.round(p.attendancePct),
            examsAvgPct: Math.round(p.examsAvgPct),
          })),
        );

        setTodayMarked(todayAtt.length);
        setTodayPresent(todayAtt.filter((r) => r.status === "present" || r.status === "late").length);
        setTodayAbsent(todayAtt.filter((r) => r.status === "absent").length);

        const { data: feedRows } = await supabase
          .from("school_activity_feed")
          .select("action, created_at, entity_type, metadata")
          .eq("school_id", ctx.schoolId)
          .eq("entity_type", "attendance")
          .order("created_at", { ascending: false })
          .limit(40);
        const classFeed = ((feedRows ?? []) as {
          action: string;
          created_at: string;
          metadata: { class_id?: string } | null;
        }[])
          .filter((row) => row.metadata?.class_id === classId)
          .slice(0, 12)
          .map((row) => ({ title: row.action, created_at: row.created_at }));
        if (!cancelled) setFeed(classFeed);

        try {
          const recent = await AuditReadService.recent(ctx);
          if (!cancelled) {
            setAuditHint(
              recent.filter((a) => {
                if (a.entityType !== "attendance") return false;
                const meta = a.metadata as { class_id?: string } | null;
                return meta?.class_id === classId;
              }).length,
            );
          }
        } catch {
          if (!cancelled) setAuditHint(0);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load class");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settled, classId, ctx, ready, liveVersion]);

  const total = students.length;
  const attendanceRate = total
    ? Math.round((todayPresent / total) * 100)
    : Math.round(avgAttendancePct);

  const distribution = useMemo(() => {
    const buckets = [
      { range: "0-40", count: 0 },
      { range: "40-60", count: 0 },
      { range: "60-75", count: 0 },
      { range: "75-90", count: 0 },
      { range: "90-100", count: 0 },
    ];
    profileRows.forEach(({ examsAvgPct }) => {
      if (!examsAvgPct && examsAvgPct !== 0) return;
      const i =
        examsAvgPct < 40 ? 0 : examsAvgPct < 60 ? 1 : examsAvgPct < 75 ? 2 : examsAvgPct < 90 ? 3 : 4;
      buckets[i].count += 1;
    });
    return buckets;
  }, [profileRows]);

  const attTrend = useMemo(() => {
    // Class avg from profiles is the engine source; show as single-point readiness until daily rollups exist in AnalyticsService.
    return [{ date: "Class avg", rate: avgAttendancePct }];
  }, [avgAttendancePct]);

  if (!classId) return <Navigate to="/principal/classes" replace />;
  if (loading) return <p className="text-muted-foreground text-center py-12">Loading class…</p>;
  if (error) {
    return (
      <p className="text-destructive text-center py-12">Failed to load class: {error}</p>
    );
  }
  if (!klass) return <Navigate to="/principal/classes" replace />;

  return (
    <>
      <div className="mb-3">
        <Link
          to="/principal/classes"
          className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="w-4 h-4 mr-1" /> Back to classes
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
          value={todayPresent}
          tone="secondary"
        />
        <StatCard
          icon={<UserX className="w-5 h-5" />}
          label="Absent Today"
          value={todayAbsent}
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
            <div className="font-semibold">{classTeacher?.full_name ?? "Not assigned"}</div>
            {classTeacher?.mobile && (
              <div className="text-xs text-muted-foreground">{classTeacher.mobile}</div>
            )}
          </div>
        </div>
        <div className="text-xs text-muted-foreground">
          Engine class avg attendance: <strong>{avgAttendancePct}%</strong>
          {auditHint > 0 ? ` · ${auditHint} recent attendance audits` : ""}
        </div>
        {todayMarked === 0 && (
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
          <TabsTrigger value="feed">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="students">
          <Card className="p-0 overflow-hidden">
            {students.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">No students in this class.</p>
            ) : (
              <div className="divide-y">
                {students.map((st) => {
                  const profile = profileRows.find((p) => p.studentId === st.id);
                  return (
                    <div key={st.id} className="flex items-center justify-between px-4 py-3 gap-3">
                      <div className="min-w-0">
                        <div className="font-medium truncate">{st.full_name}</div>
                        <div className="text-xs text-muted-foreground">
                          Roll {st.roll_number ?? "—"} · {st.admission_number}
                        </div>
                      </div>
                      <div className="text-sm font-semibold tabular-nums">
                        {profile ? `${profile.attendancePct}%` : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="academics">
          <Card className="p-5">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distribution}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="range" />
                  <YAxis allowDecimals={false} />
                  <RTooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Exam average distribution from AcademicProfileService (engine).
            </p>
          </Card>
        </TabsContent>

        <TabsContent value="analytics">
          <Card className="p-5">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={attTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="date" />
                  <YAxis domain={[0, 100]} />
                  <RTooltip />
                  <Line type="monotone" dataKey="rate" stroke="hsl(var(--primary))" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Class attendance from AnalyticsService.forClass → Academic Engine profiles.
            </p>
          </Card>
        </TabsContent>

        <TabsContent value="feed">
          <Card className="p-0 overflow-hidden">
            {feed.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No attendance activity feed items yet.
              </p>
            ) : (
              <div className="divide-y">
                {feed.map((f, i) => (
                  <div key={`${f.created_at}-${i}`} className="px-4 py-3">
                    <div className="text-sm font-medium">{f.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(f.created_at).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
