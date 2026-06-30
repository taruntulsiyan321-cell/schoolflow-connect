import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Users, ClipboardCheck, TrendingUp, Download, Trophy, AlertTriangle, Target, Brain, CheckCircle2, Clock, Lightbulb } from "lucide-react";
import "@/pages/teacher/teacher-premium.css";

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

      const { data: masteryRows } = await supabase
        .from("concept_mastery")
        .select("student_id,subject,chapter,concept,mastery_score,mistake_count,total_attempts,correct_attempts")
        .in("student_id", studentIds);

      const { data: recoveryRows } = await supabase
        .from("recovery_assignments")
        .select("student_id,subject,chapter,concept,severity,status,question_count,questions_completed,questions_correct")
        .in("student_id", studentIds);

      const { data: hwRows } = await supabase
        .from("homework")
        .select("id")
        .eq("class_id", classId);
      const hwIds = (hwRows ?? []).map((h) => h.id);
      const { data: homeworkSubs } = hwIds.length
        ? await supabase.from("homework_submissions").select("homework_id,student_id,status,grade").in("homework_id", hwIds)
        : { data: [] };

      const { data: battles } = await supabase
        .from("battles")
        .select("id")
        .eq("class_id", classId);
      const battleIds = (battles ?? []).map((b) => b.id);
      const { data: battleParts } = battleIds.length
        ? await supabase.from("battle_participants").select("student_id,score,correct_count,answered_count,total_time_ms,rank,finished_at").in("battle_id", battleIds)
        : { data: [] };

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
        const mastery = (masteryRows ?? []).filter((m) => m.student_id === s.id);
        const avgMastery = mastery.length
          ? Math.round(mastery.reduce((sum, m) => sum + Number(m.mastery_score ?? 0), 0) / mastery.length)
          : 0;
        const weakConcepts = mastery.filter((m) => Number(m.mastery_score ?? 0) < 60);
        const strongConcepts = mastery.filter((m) => Number(m.mastery_score ?? 0) >= 80);
        const recovery = (recoveryRows ?? []).filter((r) => r.student_id === s.id);
        const pendingRecovery = recovery.filter((r) => r.status !== "completed").length;
        const completedRecovery = recovery.filter((r) => r.status === "completed").length;
        const subs = (homeworkSubs ?? []).filter((h) => h.student_id === s.id);
        const homeworkCompletion = hwIds.length ? Math.round((subs.filter((h) => h.status !== "pending").length / hwIds.length) * 100) : 0;
        const bp = (battleParts ?? []).filter((p) => p.student_id === s.id);
        const battleAccuracy = bp.length
          ? Math.round((bp.reduce((sum, p) => sum + Number(p.correct_count ?? 0), 0) / Math.max(1, bp.reduce((sum, p) => sum + Number(p.answered_count ?? 0), 0))) * 100)
          : 0;
        const riskScore =
          (attPct < 75 ? 1 : 0) +
          (avgPct < 50 ? 1 : 0) +
          (avgMastery > 0 && avgMastery < 55 ? 1 : 0) +
          (pendingRecovery > 0 ? 1 : 0) +
          (homeworkCompletion > 0 && homeworkCompletion < 70 ? 1 : 0);

        return {
          ...s,
          attPct,
          avgPct,
          feeDue,
          totalDays,
          present,
          examCount: marks.length,
          avgMastery,
          weakConcepts,
          strongConcepts,
          pendingRecovery,
          completedRecovery,
          homeworkCompletion,
          battleAccuracy,
          riskScore,
        };
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
      const avgMastery = studentReport.filter((s) => s.avgMastery > 0).length
        ? Math.round(studentReport.filter((s) => s.avgMastery > 0).reduce((s, r) => s + r.avgMastery, 0) / studentReport.filter((s) => s.avgMastery > 0).length)
        : 0;
      const recoveryTotal = recoveryRows?.length ?? 0;
      const recoveryCompleted = (recoveryRows ?? []).filter((r) => r.status === "completed").length;
      const recoveryRate = recoveryTotal ? Math.round((recoveryCompleted / recoveryTotal) * 100) : 0;
      const homeworkCompletion = hwIds.length && studentIds.length
        ? Math.round(((homeworkSubs ?? []).filter((h) => h.status !== "pending").length / (hwIds.length * studentIds.length)) * 100)
        : 0;
      const avgBattleAccuracy = studentReport.filter((s) => s.battleAccuracy > 0).length
        ? Math.round(studentReport.filter((s) => s.battleAccuracy > 0).reduce((s, r) => s + r.battleAccuracy, 0) / studentReport.filter((s) => s.battleAccuracy > 0).length)
        : 0;
      const atRisk = studentReport.filter((s) => s.riskScore >= 2).sort((a, b) => b.riskScore - a.riskScore).slice(0, 5);
      const ready = studentReport.filter((s) => s.avgPct >= 70 && s.attPct >= 75 && (s.avgMastery === 0 || s.avgMastery >= 70)).slice(0, 5);
      const weakConceptMap = new Map<string, { label: string; subject: string; students: number; avg: number }>();
      (masteryRows ?? []).forEach((m) => {
        if (Number(m.mastery_score ?? 0) >= 65) return;
        const key = `${m.subject}-${m.concept}`;
        const prev = weakConceptMap.get(key) ?? { label: m.concept, subject: m.subject, students: 0, avg: 0 };
        prev.students += 1;
        prev.avg += Number(m.mastery_score ?? 0);
        weakConceptMap.set(key, prev);
      });
      const weakConcepts = [...weakConceptMap.values()]
        .map((item) => ({ ...item, avg: Math.round(item.avg / Math.max(1, item.students)) }))
        .sort((a, b) => b.students - a.students || a.avg - b.avg)
        .slice(0, 6);
      const examReadiness = Math.max(35, Math.min(96, Math.round((classAvgMarks + classAvgAtt + (avgMastery || classAvgMarks) + recoveryRate) / 4)));

      setReport({
        totalStudents: studs.length,
        classAvgAtt,
        classAvgMarks,
        totalFeeDue,
        totalExams: exams?.length ?? 0,
        avgMastery,
        recoveryRate,
        homeworkCompletion,
        avgBattleAccuracy,
        examReadiness,
        recoveryTotal,
        atRisk,
        ready,
        weakConcepts,
        top3,
        bottom3,
        students: studentReport,
      });
      setLoading(false);
    })();
  }, [classId]);

  const exportCSV = () => {
    if (!report?.students?.length) return;
    const header = "Roll#,Name,Attendance%,Avg Marks%,Mastery%,Recovery Pending,Homework%,Battle Accuracy%,Risk Score,Fee Due";
    const rows = report.students.map((s: any) =>
      [s.roll_number || "", s.full_name, s.attPct, s.avgPct, s.avgMastery, s.pendingRecovery, s.homeworkCompletion, s.battleAccuracy, s.riskScore, s.feeDue].join(",")
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
    <div className="teacher-premium tp-shell space-y-5">
      <section className="tp-hero">
        <div className="relative z-10 flex flex-wrap items-end justify-between gap-5">
          <div>
            <div className="tp-kicker mb-4">Academic Report Center</div>
            <h1 className="tp-display text-3xl sm:text-4xl">Reports that explain what to do next.</h1>
            <p className="text-sm text-white/75 mt-2 max-w-2xl">Class, student, recovery, practice, improvement, and readiness signals in one premium teacher report.</p>
          </div>
          {report?.students?.length > 0 && (
            <Button onClick={exportCSV} className="bg-white text-emerald-950 hover:bg-white/90">
              <Download className="w-4 h-4 mr-1" /> Export CSV
            </Button>
          )}
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
          You are not assigned to any classes yet. Once classes are linked to your teacher profile, reports will appear here.
        </Card>
      )}

      {loading ? (
        <p className="text-muted-foreground text-center py-8">Generating report…</p>
      ) : report ? (
        <>
          <div className="grid sm:grid-cols-2 xl:grid-cols-6 gap-4">
            <ReportMetric icon={<Users className="w-5 h-5" />} label="Students" value={report.totalStudents} sub="class strength" />
            <ReportMetric icon={<ClipboardCheck className="w-5 h-5" />} label="Attendance" value={`${report.classAvgAtt}%`} sub="average presence" />
            <ReportMetric icon={<TrendingUp className="w-5 h-5" />} label="Marks" value={`${report.classAvgMarks}%`} sub="exam average" />
            <ReportMetric icon={<Brain className="w-5 h-5" />} label="Mastery" value={`${report.avgMastery}%`} sub="concept average" />
            <ReportMetric icon={<Target className="w-5 h-5" />} label="Recovery" value={`${report.recoveryRate}%`} sub={`${report.recoveryTotal} assigned`} />
            <ReportMetric icon={<CheckCircle2 className="w-5 h-5" />} label="Readiness" value={`${report.examReadiness}%`} sub="exam signal" />
          </div>

          <div className="grid xl:grid-cols-[1.1fr_0.9fr] gap-4">
            <Card className="tp-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="tp-label">Executive summary</p>
                  <h3 className="tp-display text-xl mt-1">Academic health snapshot</h3>
                </div>
                <Badge variant="outline" className="rounded-full">{report.totalExams} exams this term</Badge>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="tp-row"><b>Homework completion:</b> {report.homeworkCompletion}%</div>
                <div className="tp-row"><b>Battle accuracy:</b> {report.avgBattleAccuracy}%</div>
                <div className="tp-row"><b>Fee due:</b> ₹{report.totalFeeDue}</div>
                <div className="tp-row"><b>At-risk learners:</b> {report.atRisk.length}</div>
              </div>
            </Card>

            <Card className="tp-card p-5">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-5 h-5 text-primary" />
                <h3 className="tp-display text-xl">Recommended action</h3>
              </div>
              <div className="space-y-2">
                <div className="tp-row">Reteach the top weak concept before the next assessment.</div>
                <div className="tp-row">Assign recovery to students with risk score 2 or above.</div>
                <div className="tp-row">Celebrate ready students with stretch questions or battleground leadership.</div>
              </div>
            </Card>
          </div>

          <div className="grid lg:grid-cols-3 gap-4">
            <Card className="tp-card p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warning" /> Early warning
              </h3>
              <div className="space-y-2">
                {report.atRisk.map((s: any) => (
                  <div key={s.id} className="tp-row">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm">{s.full_name}</span>
                      <Badge variant="destructive" className="rounded-full">Risk {s.riskScore}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">Att {s.attPct}% · Marks {s.avgPct}% · Mastery {s.avgMastery}% · Recovery {s.pendingRecovery}</p>
                  </div>
                ))}
                {report.atRisk.length === 0 && <p className="text-sm text-muted-foreground">No major risk flags.</p>}
              </div>
            </Card>

            <Card className="tp-card tp-gold-card p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-amber-700" /> Ready for challenge
              </h3>
              <div className="space-y-2">
                {report.ready.map((s: any) => (
                  <div key={s.id} className="tp-row flex items-center justify-between">
                    <span className="font-semibold text-sm">{s.full_name}</span>
                    <Badge variant="outline" className="rounded-full bg-accent/10 text-accent">{s.avgPct}%</Badge>
                  </div>
                ))}
                {report.ready.length === 0 && <p className="text-sm text-muted-foreground">Challenge-ready students will appear as scores improve.</p>}
              </div>
            </Card>

            <Card className="tp-card p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Brain className="w-4 h-4 text-primary" /> Weak concepts
              </h3>
              <div className="space-y-2">
                {report.weakConcepts.map((concept: any) => (
                  <div key={`${concept.subject}-${concept.label}`} className="tp-row">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm">{concept.label}</span>
                      <span className="text-xs font-bold text-warning">{concept.students} students</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{concept.subject} · avg mastery {concept.avg}%</p>
                  </div>
                ))}
                {report.weakConcepts.length === 0 && <p className="text-sm text-muted-foreground">No concept mastery gaps found yet.</p>}
              </div>
            </Card>
          </div>

          {/* Top performers */}
          {report.top3.length > 0 && (
            <Card className="tp-card p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Trophy className="w-4 h-4 text-primary" /> Top Performers
              </h3>
              <div className="space-y-2">
                {report.top3.map((s: any, i: number) => (
                  <div key={s.id} className="tp-row flex items-center justify-between">
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
            <Card className="tp-card p-5">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-warning" /> Needs Attention
              </h3>
              <div className="space-y-2">
                {report.bottom3.map((s: any) => (
                  <div key={s.id} className="tp-row flex items-center justify-between">
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
          <h3 className="tp-display text-xl">All Students</h3>
          <div className="grid lg:grid-cols-2 gap-3">
            {report.students.map((s: any) => (
              <Card key={s.id} className="tp-card p-4">
                <div className="flex items-center justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{s.full_name}</div>
                  <div className="text-xs text-muted-foreground">Roll {s.roll_number || "—"} · Risk score {s.riskScore}</div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Badge variant="outline" className={`text-xs ${s.attPct >= 75 ? "" : "bg-warning/10 text-warning border-warning/30"}`}>
                    Att {s.attPct}%
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    Marks {s.avgPct}%
                  </Badge>
                </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="rounded-lg bg-muted/40 p-2">Mastery <b>{s.avgMastery}%</b></div>
                  <div className="rounded-lg bg-muted/40 p-2">HW <b>{s.homeworkCompletion}%</b></div>
                  <div className="rounded-lg bg-muted/40 p-2">Battle <b>{s.battleAccuracy}%</b></div>
                </div>
              </Card>
            ))}
          </div>

          {report.totalStudents === 0 && (
            <Card className="tp-card p-8 text-center">
              <Users className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
              <p className="text-muted-foreground">No students in this class.</p>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}

function ReportMetric({ icon, label, value, sub }: { icon: ReactNode; label: string; value: ReactNode; sub: string }) {
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
