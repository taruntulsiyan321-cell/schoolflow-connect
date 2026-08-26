import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AcademicProfileService } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";
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
  const { ctx, ready } = useAcademicContext();
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState("");
  const [students, setStudents] = useState<StudentPerf[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");

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

  // Load students & compute performance (attendance from Academic Engine profiles)
  useEffect(() => {
    if (!classId || !ready || !ctx) return;
    setLoading(true);
    (async () => {
      const { data: studs } = await supabase
        .from("students_current")
        .select("id,full_name,roll_number")
        .eq("class_id", classId)
        .order("roll_number");

      if (!studs || studs.length === 0) {
        setStudents([]);
        setLoading(false);
        return;
      }

      const studentIds = studs.map((s) => s.id);
      const profiles = await AcademicProfileService.listForClass(ctx, classId, { limit: 200 });
      const profileByStudent = new Map(profiles.map((p) => [p.studentId, p]));

      const { data: exams } = await supabase
        .from("exams")
        .select("id,max_marks")
        .eq("class_id", classId);
      const examIds = (exams ?? []).map((e) => e.id);
      const maxMarksMap = new Map((exams ?? []).map((e) => [e.id, e.max_marks]));

      const { data: allMarks } = examIds.length > 0
        ? await supabase
            .from("marks")
            .select("student_id,exam_id,marks_obtained")
            .in("student_id", studentIds)
            .in("exam_id", examIds)
        : { data: [] };

      const result: StudentPerf[] = studs.map((s) => {
        const academic = profileByStudent.get(s.id);
        const attendancePct = Math.round(academic?.attendancePct ?? 0);
        const totalDays = academic?.attendanceTotal ?? 0;
        const totalPresent = academic?.attendancePresent ?? 0;

        const marks = (allMarks ?? []).filter((m) => m.student_id === s.id);
        let avgMarks = Math.round(academic?.examsAvgPct ?? 0);
        if (!academic && marks.length > 0) {
          const totalPct = marks.reduce((sum, m) => {
            const max = maxMarksMap.get(m.exam_id) || 100;
            return sum + (Number(m.marks_obtained) / max) * 100;
          }, 0);
          avgMarks = Math.round(totalPct / marks.length);
        }

        let trend: "up" | "down" | "stable" = "stable";
        if (marks.length >= 4) {
          const mid = Math.floor(marks.length / 2);
          const firstHalf = marks.slice(0, mid).reduce((acc, m) => acc + Number(m.marks_obtained), 0) / mid;
          const secondHalf = marks.slice(mid).reduce((acc, m) => acc + Number(m.marks_obtained), 0) / (marks.length - mid);
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
          totalExams: academic?.examsRecorded ?? marks.length,
          trend,
        };
      });

      setStudents(result);
      setSelectedId((current) => current || result[0]?.id || "");
      setLoading(false);
    })();
  }, [classId, ready, ctx]);

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
  const selected = students.find((student) => student.id === selectedId) ?? filtered[0] ?? students[0];
  const selectedRisk =
    selected && (selected.attendancePct < 75 || selected.avgMarks < 50 || selected.trend === "down");

  return (
    <div className="teacher-premium tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10 grid lg:grid-cols-[1.1fr_0.9fr] gap-5">
          <div>
            <div className="tp-kicker mb-4">Learner Performance Grid</div>
            <h1 className="tp-display text-3xl sm:text-4xl">Student Performance</h1>
            <p className="text-sm text-foreground/75 mt-2 max-w-xl">Attendance, marks, trend direction, and risk signals for every student in the selected class.</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-2xl bg-white/12 border border-border p-3 text-center">
              <p className="text-2xl font-bold">{students.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-foreground/60">Students</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-border p-3 text-center">
              <p className="text-2xl font-bold">{atRiskCount}</p>
              <p className="text-[10px] uppercase tracking-wider text-foreground/60">At risk</p>
            </div>
            <div className="rounded-2xl bg-white/12 border border-border p-3 text-center">
              <p className="text-2xl font-bold">{improvingCount}</p>
              <p className="text-[10px] uppercase tracking-wider text-foreground/60">Improving</p>
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

      {selected && (
        <Card className="tp-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
            <div>
              <p className="tp-label">One-minute academic profile</p>
              <h2 className="tp-display text-2xl mt-1">{selected.full_name}</h2>
              <p className="text-sm text-muted-foreground">Roll {selected.roll_number || "—"} · {selected.totalExams} exam{selected.totalExams === 1 ? "" : "s"} tracked</p>
            </div>
            <Badge variant={selectedRisk ? "destructive" : "outline"} className="rounded-full">
              {selectedRisk ? "Needs intervention" : "On track"}
            </Badge>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div className="tp-row">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="tp-label">Accuracy</span>
                <b>{selected.avgMarks}%</b>
              </div>
              <div className="tp-progress"><span style={{ width: `${Math.max(4, selected.avgMarks)}%` }} /></div>
              <p className="text-xs text-muted-foreground mt-2">{selected.avgMarks >= 70 ? "Strong exam readiness." : selected.avgMarks >= 50 ? "Needs targeted concept practice." : "Assign recovery before next assessment."}</p>
            </div>
            <div className="tp-row">
              <div className="flex items-center justify-between text-xs mb-2">
                <span className="tp-label">Consistency</span>
                <b>{selected.attendancePct}%</b>
              </div>
              <div className="tp-progress"><span style={{ width: `${Math.max(4, selected.attendancePct)}%` }} /></div>
              <p className="text-xs text-muted-foreground mt-2">{selected.totalDays ? `${selected.totalPresent}/${selected.totalDays} days present.` : "Attendance data is still building."}</p>
            </div>
            <div className="tp-row">
              <span className="tp-label">Mistake pattern</span>
              <p className="font-semibold mt-2">{selected.avgMarks < 50 ? "Core concept gaps" : selected.trend === "down" ? "Accuracy declining" : "Stable performance"}</p>
              <p className="text-xs text-muted-foreground mt-2">Teacher note: review weak concepts, assign a focused set, then check improvement after the next attempt.</p>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-3 mt-4">
            <div className="tp-row"><b>Recovery progress:</b> {selected.avgMarks >= 60 ? "Healthy" : "Pending support"}</div>
            <div className="tp-row"><b>Battleground performance:</b> {selected.trend === "up" ? "Improving speed" : "Needs monitoring"}</div>
            <div className="tp-row"><b>Next action:</b> {selectedRisk ? "Schedule intervention" : "Give stretch practice"}</div>
          </div>
        </Card>
      )}

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Calculating performance…</p>
      ) : (
        <div className="grid lg:grid-cols-2 gap-3">
          {filtered.map((s) => (
            <Card key={s.id} className={`tp-card p-4 cursor-pointer ${selected?.id === s.id ? "ring-2 ring-primary/30" : ""}`} onClick={() => setSelectedId(s.id)}>
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
