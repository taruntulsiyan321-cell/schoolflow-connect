import { useEffect, useState } from "react";
import { Sparkles, Brain, Target, Lightbulb, Lock } from "lucide-react";
import { Card, SectionHead } from "./shared";
import { AttendanceService, type AssignedClass, type ClassStudentRow } from "@/academic";
import { useAcademicContext } from "@/academic/hooks/useAcademicContext";

/**
 * UI/UX preview only — deliberately not wired to a real backend call.
 * The real version needs the same student-panel insight pipeline the
 * student-facing coach already uses (mastery, mistakes, recovery, revision
 * plans), aggregated per-class for a teacher's diagnostic view — that
 * integration isn't built yet. Scoped by explicit product decision: ship
 * the screen now, wire the function once the student-panel data layer is
 * ready to be consumed this way.
 */
export default function TeacherAICoach() {
  const { ctx, ready } = useAcademicContext();
  const [classes, setClasses] = useState<AssignedClass[]>([]);
  const [classId, setClassId] = useState<string>("");
  const [students, setStudents] = useState<ClassStudentRow[]>([]);
  const [studentId, setStudentId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!ready || !ctx) return;
    (async () => {
      try {
        const list = await AttendanceService.listAssignedClasses(ctx);
        setClasses(list);
        setClassId(list[0]?.id ?? "");
      } finally {
        setLoading(false);
      }
    })();
  }, [ready, ctx]);

  useEffect(() => {
    if (!ready || !ctx || !classId) {
      setStudents([]);
      setStudentId("");
      return;
    }
    (async () => {
      const rows = await AttendanceService.listClassStudents(ctx, classId);
      setStudents(rows);
      setStudentId(rows[0]?.id ?? "");
    })();
  }, [ready, ctx, classId]);

  const selectedStudent = students.find((s) => s.id === studentId);

  return (
    <div className="space-y-4">
      <SectionHead
        title="AI Academic Coach"
        subtitle="Per-student diagnostic insights for classroom intervention"
      />

      <Card className="p-4 flex items-start gap-3 border-[#3b5bdb]/30 bg-[#3b5bdb]/5">
        <Sparkles className="w-4 h-4 text-[#3b5bdb] shrink-0 mt-0.5" />
        <div className="text-xs text-[#a5b0d8] leading-relaxed">
          <span className="font-bold text-foreground">Coming soon.</span> This will generate the same
          kind of AI coaching report students already see for themselves — diagnosis, focus
          areas, recommendations — but built from your class&apos;s student-panel data so you can
          act on it in the classroom. It needs that data pipeline wired in first, so the report
          below is a preview, not live output yet.
        </div>
      </Card>

      {loading ? (
        <div className="text-xs text-muted-foreground py-8 text-center">Loading your classes…</div>
      ) : classes.length === 0 ? (
        <div className="text-xs text-muted-foreground py-8 text-center">No assigned classes found.</div>
      ) : (
        <Card className="p-4 flex flex-wrap items-center gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor="ai-coach-class" className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
              Class
            </label>
            <select
              id="ai-coach-class"
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              className="bg-card border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50"
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}-{c.section}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="ai-coach-student" className="text-[9px] font-bold text-muted-foreground uppercase tracking-wider">
              Student
            </label>
            <select
              id="ai-coach-student"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              disabled={students.length === 0}
              className="bg-card border border-border rounded-xl px-3 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 disabled:opacity-50"
            >
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                  {s.rollNumber ? ` · Roll ${s.rollNumber}` : ""}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            disabled
            title="Coming soon — requires the student-panel insight pipeline to be connected first"
            className="ml-auto flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold text-muted-foreground bg-muted border border-border cursor-not-allowed"
          >
            <Lock className="w-3.5 h-3.5" /> Generate Coaching Report
          </button>
        </Card>
      )}

      {/* Preview of the eventual report shape — explicitly labeled as an example */}
      <Card className="p-5 sm:p-6 opacity-60">
        <div className="flex items-center gap-2 mb-4">
          <span className="w-7 h-7 rounded-full bg-[#3b5bdb]/15 flex items-center justify-center">
            <Brain className="w-3.5 h-3.5 text-[#3b5bdb]" />
          </span>
          <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
            Example preview{selectedStudent ? ` — ${selectedStudent.fullName}` : ""}
          </div>
        </div>
        <div className="space-y-3">
          <p className="text-sm font-bold text-foreground">
            Strong grasp of algebra, needs focused work on trigonometric identities
          </p>
          <div className="flex items-start gap-2 text-xs text-[#c8c8d4]">
            <Lightbulb className="w-3.5 h-3.5 text-[#3b5bdb] shrink-0 mt-0.5" />
            Consistently accurate on linear equations; accuracy drops sharply on identity-proof
            questions — likely a formula-recall gap, not a conceptual one.
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["Trigonometric identities", "Formula recall"].map((f) => (
              <span key={f} className="text-[10px] px-2 py-1 rounded-full bg-[#c08a3a]/15 text-[#c08a3a] font-medium">
                {f}
              </span>
            ))}
          </div>
          <div className="flex items-start gap-2 text-xs text-[#c8c8d4] border-t border-border/70 pt-3">
            <Target className="w-3.5 h-3.5 text-[#4aa87a] shrink-0 mt-0.5" />
            Assign a short identity-drill DPP before the next trigonometry class.
          </div>
        </div>
      </Card>
    </div>
  );
}
