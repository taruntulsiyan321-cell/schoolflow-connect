import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { FileText, Users, ClipboardCheck, TrendingUp, Download } from "lucide-react";

export default function TeacherReportsPage() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<any[]>([]);
  const [classId, setClassId] = useState("");
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(false);

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
      if (t.class_teacher_of) {
        const { data: c } = await supabase
          .from("classes")
          .select("id,name,section")
          .eq("id", t.class_teacher_of)
          .maybeSingle();
        if (c) classList.push({ ...c, label: `${c.name}-${c.section} (Class Teacher)` });
      }
      const { data: tc } = await supabase
        .from("teacher_classes")
        .select("class_id, subject, classes(id,name,section)")
        .eq("teacher_id", t.id);
      (tc ?? []).forEach((r: any) => {
        if (r.classes && !classList.find((x) => x.id === r.classes.id)) {
          classList.push({ ...r.classes, label: `${r.classes.name}-${r.classes.section}` });
        }
      });
      setClasses(classList);
      if (classList.length > 0) setClassId(classList[0].id);
    })();
  }, [user]);

  // Generate report
  useEffect(() => {
    if (!classId) return;
    setLoading(true);
    (async () => {
      // Students
      const { data: students } = await supabase
        .from("students")
        .select("id,full_name,roll_number")
        .eq("class_id", classId)
        .order("roll_number");
      const studs = students ?? [];
      const studentIds = studs.map((s) => s.id);

      if (studentIds.length === 0) {
        setReport({ totalStudents: 0, students: [] });
        setLoading(false);
        return;
      }

      // Attendance
      const { data: allAtt } = await supabase
        .from("attendance")
        .select("student_id,status")
        .in("student_id", studentIds);

      // Exams + marks
      const { data: exams } = await supabase
        .from("exams")
        .select("id,max_marks,name,subject")
        .eq("class_id", classId);
      const examIds = (exams ?? []).map((e) => e.id);
      const maxMap = new Map((exams ?? []).map((e) => [e.id, e.max_marks]));

      const { data: allMarks } = examIds.length > 0
        ? await supabase.from("marks").select("student_id,exam_id,marks_obtained").in("student_id", studentIds).in("exam_id", examIds)
        : { data: [] };

      // Fees
      const { data: allFees } = await supabase
        .from("fees")
        .select("student_id,amount,paid_amount,status")
        .in("student_id", studentIds);

      // Compute per-student
      const studentReport = studs.map((s) => {
        const att = (allAtt ?? []).filter((a) => a.student_id === s.id);
        const totalDays = att.length;
        const present = att.filter((a) => a.status === "present").length;
        const attPct = totalDays > 0 ? Math.round((present / totalDays) * 100) : 0;

        const marks = (allMarks ?? []).filter((m) => m.student_id === s.id);
        let avgPct = 0;
        if (marks.length > 0) {
          const totalP = marks.reduce((sum, m) => {
            const max = maxMap.get(m.exam_id) || 100;
            return sum + (Number(m.marks_obtained) / max) * 100;
          }, 0);
          avgPct = Math.round(totalP / marks.length);
        }

        const fees = (allFees ?? []).filter((f) => f.student_id === s.id);
        const feeDue = fees.reduce((sum, f) => sum + (Number(f.amount) - Number(f.paid_amount)), 0);

        return { ...s, attPct, avgPct, feeDue, totalDays, present, examCount: marks.length };
      });

      // Sort by avg marks for top/bottom
      const sorted = [...studentReport].sort((a, b) => b.avgPct - a.avgPct);
      const top3 = sorted.filter((s) => s.examCount > 0).slice(0, 3);
      const bottom3 = sorted.filter((s) => s.examCount > 0).slice(-3).reverse();

      const classAvgAtt = studentReport.length
        ? Math.round(studentReport.reduce((s, r) => s + r.attPct, 0) / studentReport.length)
        : 0;
      const classAvgMarks = studentReport.filter((s) => s.examCount > 0).length
        ? Math.round(
            studentReport.filter((s) => s.examCount > 0).reduce((s, r) => s + r.avgPct, 0) /
            studentReport.filter((s) => s.examCount > 0).length
          )
        : 0;
      const totalFeeDue = studentReport.reduce((s, r) => s + Math.max(0, r.feeDue), 0);

      setReport({
        totalStudents: studs.length,
        classAvgAtt,
        classAvgMarks,
        totalFeeDue,
        totalExams: exams?.length ?? 0,
        top3,
        bottom3,
        students: studentReport,
      });
      setLoading(false);
    })();
  }, [classId]);

  const exportCSV = () => {
    if (!report?.students?.length) return;
    const header = "Roll#,Name,Attendance%,Avg Marks%,Fee Due";
    const rows = report.students.map((s: any) =>
      [s.roll_number || "", s.full_name, s.attPct, s.avgPct, s.feeDue].join(",")
    );
    const csv = header + "\n" + rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `class-report-${classId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <PageHeader
        title="Class Reports"
        subtitle="Class and subject reports"
        action={
          report?.students?.length > 0 ? (
            <Button onClick={exportCSV} className="bg-gradient-primary text-primary-foreground">
              <Download className="w-4 h-4 mr-1" /> Export CSV
            </Button>
          ) : undefined
        }
      />

      <Card className="p-4 mb-4">
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

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Generating report…</p>
      ) : report ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <StatCard icon={<Users className="w-5 h-5" />} label="Students" value={report.totalStudents} />
            <StatCard icon={<ClipboardCheck className="w-5 h-5" />} label="Avg Attendance" value={`${report.classAvgAtt}%`} tone={report.classAvgAtt >= 75 ? "accent" : "warning"} />
            <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Avg Marks" value={`${report.classAvgMarks}%`} tone={report.classAvgMarks >= 50 ? "accent" : "warning"} />
            <StatCard icon={<FileText className="w-5 h-5" />} label="Exams" value={report.totalExams} tone="secondary" />
          </div>

          {/* Top performers */}
          {report.top3.length > 0 && (
            <Card className="p-4 mb-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                🏆 Top Performers
              </h3>
              <div className="space-y-2">
                {report.top3.map((s: any, i: number) => (
                  <div key={s.id} className="flex items-center justify-between p-2 rounded-lg bg-accent/5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-accent w-5">{i + 1}</span>
                      <span className="text-sm font-medium">{s.full_name}</span>
                    </div>
                    <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30">
                      {s.avgPct}%
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Bottom performers */}
          {report.bottom3.length > 0 && (
            <Card className="p-4 mb-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                ⚠️ Needs Attention
              </h3>
              <div className="space-y-2">
                {report.bottom3.map((s: any) => (
                  <div key={s.id} className="flex items-center justify-between p-2 rounded-lg bg-warning/5">
                    <span className="text-sm font-medium">{s.full_name}</span>
                    <div className="flex gap-2">
                      <Badge variant="outline" className={s.attPct < 75 ? "bg-destructive/10 text-destructive border-destructive/30" : ""}>
                        Att: {s.attPct}%
                      </Badge>
                      <Badge variant="outline" className={s.avgPct < 40 ? "bg-destructive/10 text-destructive border-destructive/30" : ""}>
                        Marks: {s.avgPct}%
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Full student list */}
          <h3 className="font-semibold mb-3">All Students</h3>
          <div className="space-y-2">
            {report.students.map((s: any) => (
              <Card key={s.id} className="p-3 flex items-center justify-between shadow-card">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{s.full_name}</div>
                  <div className="text-xs text-muted-foreground">Roll {s.roll_number || "—"}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Badge variant="outline" className={`text-xs ${s.attPct >= 75 ? "" : "bg-warning/10 text-warning border-warning/30"}`}>
                    {s.attPct}%
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {s.avgPct}%
                  </Badge>
                </div>
              </Card>
            ))}
          </div>

          {report.totalStudents === 0 && (
            <Card className="p-8 text-center">
              <Users className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No students in this class.</p>
            </Card>
          )}
        </>
      ) : null}
    </>
  );
}
