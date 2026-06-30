import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import "@/pages/teacher/teacher-premium.css";
import { BarChart3, Users, TrendingUp, TrendingDown, ClipboardCheck } from "lucide-react";

interface StudentPerf {
  id: string;
  full_name: string;
  roll_number: string | null;
  attendancePct: number;
  totalPresent: number;
  totalDays: number;
  avgMarks: number;
  totalExams: number;
  trend: "up" | "down" | "stable";
}

export default function StudentPerformancePage() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<StudentPerf[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  // Load teacher's classes
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data: t } = await supabase
        .from("teachers")
        .select("id, class_teacher_of")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!t) return;

      const classList: any[] = [];

      // Class teacher class
      if (t.class_teacher_of) {
        const { data: c } = await supabase
          .from("classes")
          .select("id,name,section")
          .eq("id", t.class_teacher_of)
          .maybeSingle();
        if (c) classList.push({ ...c, label: `${c.name}-${c.section} (Class Teacher)` });
      }

      // Subject classes
      const { data: tc } = await supabase
        .from("teacher_classes")
        .select("class_id, subject, classes(id,name,section)")
        .eq("teacher_id", t.id);
      (tc ?? []).forEach((r: any) => {
        if (r.classes && !classList.find((x) => x.id === r.classes.id)) {
          classList.push({
            ...r.classes,
            label: `${r.classes.name}-${r.classes.section}${r.subject ? ` · ${r.subject}` : ""}`,
          });
        }
      });

      setClasses(classList);
      if (classList.length > 0) setClassId(classList[0].id);
    })();
  }, [user]);

  // Load students & compute performance
  useEffect(() => {
    if (!classId) return;
    setLoading(true);
    (async () => {
      // Get students
      const { data: studs } = await supabase
        .from("students")
        .select("id,full_name,roll_number")
        .eq("class_id", classId)
        .order("roll_number");

      if (!studs || studs.length === 0) {
        setStudents([]);
        setLoading(false);
        return;
      }

      const studentIds = studs.map((s) => s.id);

      // Get attendance for all students
      const { data: allAtt } = await supabase
        .from("attendance")
        .select("student_id,status")
        .in("student_id", studentIds);

      // Get exams for this class
      const { data: exams } = await supabase
        .from("exams")
        .select("id,max_marks")
        .eq("class_id", classId);
      const examIds = (exams ?? []).map((e) => e.id);
      const maxMarksMap = new Map((exams ?? []).map((e) => [e.id, e.max_marks]));

      // Get marks
      const { data: allMarks } = examIds.length > 0
        ? await supabase
            .from("marks")
            .select("student_id,exam_id,marks_obtained")
            .in("student_id", studentIds)
            .in("exam_id", examIds)
        : { data: [] };

      // Compute per-student metrics
      const result: StudentPerf[] = studs.map((s) => {
        const att = (allAtt ?? []).filter((a) => a.student_id === s.id);
        const totalDays = att.length;
        const totalPresent = att.filter((a) => a.status === "present").length;
        const attendancePct = totalDays > 0 ? Math.round((totalPresent / totalDays) * 100) : 0;

        const marks = (allMarks ?? []).filter((m) => m.student_id === s.id);
        let avgMarks = 0;
        if (marks.length > 0) {
          const totalPct = marks.reduce((sum, m) => {
            const max = maxMarksMap.get(m.exam_id) || 100;
            return sum + (Number(m.marks_obtained) / max) * 100;
          }, 0);
          avgMarks = Math.round(totalPct / marks.length);
        }

        // Simple trend: compare first half vs second half of marks
        let trend: "up" | "down" | "stable" = "stable";
        if (marks.length >= 4) {
          const mid = Math.floor(marks.length / 2);
          const firstHalf = marks.slice(0, mid).reduce((s, m) => s + Number(m.marks_obtained), 0) / mid;
          const secondHalf = marks.slice(mid).reduce((s, m) => s + Number(m.marks_obtained), 0) / (marks.length - mid);
          if (secondHalf > firstHalf * 1.05) trend = "up";
          else if (secondHalf < firstHalf * 0.95) trend = "down";
        }

        return {
          id: s.id,
          full_name: s.full_name,
          roll_number: s.roll_number,
          attendancePct,
          totalPresent,
          totalDays,
          avgMarks,
          totalExams: marks.length,
          trend,
        };
      });

      setStudents(result);
      setLoading(false);
    })();
  }, [classId]);

  const filtered = students.filter(
    (s) => !search || s.full_name.toLowerCase().includes(search.toLowerCase())
  );

  const classAvgAttendance = students.length
    ? Math.round(students.reduce((s, st) => s + st.attendancePct, 0) / students.length)
    : 0;
  const classAvgMarks = students.length
    ? Math.round(students.reduce((s, st) => s + st.avgMarks, 0) / students.length)
    : 0;
  const atRiskCount = students.filter((s) => s.attendancePct < 75 || s.avgMarks < 50).length;
  const improvingCount = students.filter((s) => s.trend === "up").length;

  return (
    <div className="teacher-premium tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10 grid lg:grid-cols-[1.1fr_0.9fr] gap-5">
          <div>
            <div className="tp-kicker mb-4">Learner Performance Grid</div>
            <h1 className="tp-display text-3xl sm:text-4xl">Student Performance</h1>
            <p className="text-sm text-white/75 mt-2 max-w-xl">Attendance, marks, trend direction, and risk signals for every student in the selected class.</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white/12 border border-white/15 p-3 text-center">
              <p className="text-2xl font-bold">{students.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/60">Students</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-white/15 p-3 text-center">
              <p className="text-2xl font-bold">{atRiskCount}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/60">At risk</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-white/15 p-3 text-center">
              <p className="text-2xl font-bold">{improvingCount}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/60">Improving</p>
            </div>
          </div>
        </div>
      </section>

      <Card className="tp-card p-4">
        <Select value={classId} onValueChange={setClassId}>
          <SelectTrigger>
            <SelectValue placeholder="Select class" />
          </SelectTrigger>
          <SelectContent>
            {classes.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      {!classes.length && (
        <Card className="tp-card p-6 text-center text-sm text-muted-foreground">
          You are not assigned to any classes yet. Once classes are linked to your teacher profile, performance insights will appear here.
        </Card>
      )}

      {classId && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <PerfMetric icon={<ClipboardCheck className="w-5 h-5" />} label="Avg Attendance" value={`${classAvgAttendance}%`} sub={classAvgAttendance >= 75 ? "healthy" : "needs attention"} />
          <PerfMetric icon={<BarChart3 className="w-5 h-5" />} label="Avg Marks" value={`${classAvgMarks}%`} sub={classAvgMarks >= 50 ? "above support line" : "below support line"} />
          <PerfMetric icon={<TrendingDown className="w-5 h-5" />} label="Risk Flags" value={atRiskCount} sub="low attendance or marks" />
          <PerfMetric icon={<TrendingUp className="w-5 h-5" />} label="Improving" value={improvingCount} sub="positive trend" />
        </div>
      )}

      {students.length > 0 && (
        <Input
          placeholder="Search student…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
      )}

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Calculating performance…</p>
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {filtered.map((s) => (
            <Card key={s.id} className="tp-card p-4">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="font-semibold">{s.full_name}</div>
                  <div className="text-xs text-muted-foreground">
                    Roll {s.roll_number || "—"} · {s.totalExams} exam{s.totalExams === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {s.trend === "up" && <TrendingUp className="w-4 h-4 text-accent" />}
                  {s.trend === "down" && <TrendingDown className="w-4 h-4 text-destructive" />}
                  {s.trend === "stable" && <BarChart3 className="w-4 h-4 text-muted-foreground" />}
                  <span className="text-xs capitalize text-muted-foreground">{s.trend}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Attendance</span>
                    <span className={`font-medium ${s.attendancePct >= 75 ? "text-accent" : "text-warning"}`}>
                      {s.attendancePct}%
                    </span>
                  </div>
                  <Progress value={s.attendancePct} className="h-2" />
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    {s.totalPresent}/{s.totalDays} days
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Avg Marks</span>
                    <span className={`font-medium ${s.avgMarks >= 50 ? "text-accent" : "text-destructive"}`}>
                      {s.avgMarks}%
                    </span>
                  </div>
                  <Progress value={s.avgMarks} className="h-2" />
                  <div className="text-[10px] text-muted-foreground mt-0.5">
                    across {s.totalExams} exams
                  </div>
                </div>
              </div>
            </Card>
          ))}
          {filtered.length === 0 && classId && (
            <Card className="tp-card p-8 text-center lg:col-span-2">
              <Users className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">
                {students.length === 0 ? "No students in this class." : "No students match your search."}
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function PerfMetric({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub: string }) {
  return (
    <Card className="tp-metric">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="tp-label">{label}</p>
          <p className="text-2xl font-bold mt-2">{value}</p>
          <p className="text-xs text-muted-foreground mt-1">{sub}</p>
        </div>
        <div className="tp-icon">{icon}</div>
      </div>
    </Card>
  );
}
